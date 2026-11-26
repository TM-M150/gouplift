import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getStaffStatus,
  getStaffUser,
  requireAdmin,
  requireStaff,
} from "./lib/staff";
import { authComponent } from "./auth";
import { recordAlert } from "./lib/systemAlerts";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getActivePayoutHold } from "./lib/payoutEligibility";
import { placePayoutHoldFor } from "./lib/payoutHold";
import { availableBalance } from "../lib/payouts";
import { SYSTEM_ALERTS } from "../lib/system-alerts";
import {
  STAFF_BLOCK_MESSAGES,
  staffAccessBlock,
  staffEmailRule,
  type StaffAccessBlock,
  type StaffEmailRule,
} from "../lib/staff-access";
import {
  getVerificationBlockers,
  ORGANIZATION_REVIEW_CHECK_LABELS,
  ORGANIZATION_REVIEW_CHECKS,
} from "../lib/organization-verification";
import { assessOrganizationRisk, isEddOutstanding } from "../lib/risk";
import { hasNoIdentifiedOwner, ownershipProblem } from "../lib/beneficial-ownership";
import { DAY_MS, EAT_OFFSET_MS } from "@/lib/time";
import { organizationReviewCheckValidator } from "./lib/beneficialOwnerValidators";
import { isMlro } from "./lib/mlro";
import {
  anyPepDeclared,
  createOrganizationRiskProfile,
  getOrganizationRiskProfile,
  listBeneficialOwners,
  ownersLockedReason,
  readOrganizationDeclarations,
} from "./lib/organizationRisk";
import { eddRecordValidator, pepOutcomeValidator, riskLevelValidator } from "./lib/riskValidators";

const LIST_LIMIT = 100;
const DOCUMENTS_LIMIT = 50;
const HISTORY_LIMIT = 30;
const QUEUE_CAP = 100;
const TOTALS_CAP = 500;
const SERIES_CAP = 2000;
const MAX_DAYS = 90;

const reviewableStatusValidator = v.union(
  v.literal("PENDING_REVIEW"),
  v.literal("VERIFIED"),
  v.literal("REJECTED"),
);

async function listDocuments(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  return await ctx.db
    .query("organizationDocuments")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId),
    )
    .take(DOCUMENTS_LIMIT);
}

const roleValidator = v.union(
  v.literal("USER"),
  v.literal("MODERATOR"),
  v.literal("ADMIN"),
);
const staffRoleValidator = v.union(v.literal("MODERATOR"), v.literal("ADMIN"));
const staffBlockValidator = v.union(
  v.literal("EMAIL_NOT_CONFIRMED"),
  v.literal("EMAIL_DOMAIN_NOT_ALLOWED"),
);

// Where the signed-in person stands with the admin area. The /admin layout
// calls this to choose between the admin area, a notice saying what is stopping
// a staff member, and sending everyone else away.
export const getStaffAccess = query({
  args: {},
  returns: v.union(
    v.object({ state: v.literal("NOT_STAFF") }),
    v.object({
      state: v.literal("BLOCKED"),
      role: staffRoleValidator,
      block: staffBlockValidator,
      message: v.string(),
    }),
    v.object({
      state: v.literal("ALLOWED"),
      role: staffRoleValidator,
      name: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const status = await getStaffStatus(ctx);
    if (status.state === "BLOCKED") {
      return { ...status, message: STAFF_BLOCK_MESSAGES[status.block] };
    }
    return status;
  },
});

async function previewOrganizationNeedsMlro(
  ctx: QueryCtx | MutationCtx,
  org: Doc<"organizations">,
): Promise<boolean> {
  const declared = readOrganizationDeclarations(org);
  if (!declared) return false;
  const owners = await listBeneficialOwners(ctx, org._id);
  return assessOrganizationRisk({
    expectedAmountKes: declared.expectedAmountKes,
    residenceCountry: declared.registeredCountry,
    pepOutcome: anyPepDeclared(declared, owners) ? "PEP" : "NOT_PEP",
    behaviour: "LOW",
    complexStructure: false,
    highRiskSector: false,
    noOwnerIdentified: hasNoIdentifiedOwner(owners),
  }).requiresEdd;
}

export const listOrganizationsForReview = query({
  args: { status: reviewableStatusValidator },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    // Waiting orgs oldest first so nobody is left queueing; decided ones newest first.
    const organizations = await ctx.db
      .query("organizations")
      .withIndex("by_verificationStatus", (q) =>
        q.eq("verificationStatus", args.status),
      )
      .order(args.status === "PENDING_REVIEW" ? "asc" : "desc")
      .take(LIST_LIMIT);

    return await Promise.all(
      organizations.map(async (org) => {
        const [owner, documents] = await Promise.all([
          ctx.db.get(org.createdBy),
          listDocuments(ctx, org._id),
        ]);

        return {
          _id: org._id,
          name: org.name,
          slug: org.slug,
          organizationType: org.organizationType ?? null,
          registrationNumber: org.registrationNumber ?? null,
          submittedAt: org.verificationSubmittedAt ?? org.createdAt,
          ownerName: owner?.displayName ?? null,
          documentCount: documents.length,
          approvedCount: documents.filter((d) => d.reviewStatus === "APPROVED")
            .length,
          replacementCount: documents.filter(
            (d) => d.reviewStatus === "REJECTED",
          ).length,
          escalated: org.escalatedAt !== undefined,
          // From what it declared alone: a reviewer's own findings can still
          // add to this.
          needsMlro:
            args.status === "PENDING_REVIEW" &&
            (await previewOrganizationNeedsMlro(ctx, org)),
        };
      }),
    );
  },
});

export const getOrganizationForReview = query({
  // A string, not v.id(): the value comes straight from the URL, and an
  // invalid one should read as "not found" rather than throw.
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return null;

    const organizationId = ctx.db.normalizeId(
      "organizations",
      args.organizationId,
    );
    if (!organizationId) return null;

    const org = await ctx.db.get(organizationId);
    if (!org) return null;

    const [owner, documents, history, beneficialOwners, riskProfile] =
      await Promise.all([
        ctx.db.get(org.createdBy),
        listDocuments(ctx, org._id),
        ctx.db
          .query("adminAuditLog")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", org._id),
          )
          .order("desc")
          .take(HISTORY_LIMIT),
        listBeneficialOwners(ctx, org._id),
        getOrganizationRiskProfile(ctx, org._id),
      ]);

    // Reviewer / actor names, looked up once per person.
    const names = new Map<Id<"users">, string>();
    const nameOf = async (userId: Id<"users"> | undefined) => {
      if (!userId) return null;
      const cached = names.get(userId);
      if (cached) return cached;
      const user = await ctx.db.get(userId);
      const name = user?.displayName ?? "Unknown";
      names.set(userId, name);
      return name;
    };

    // The file URLs are only ever produced here, behind the staff check.
    const reviewDocuments = await Promise.all(
      documents.map(async (doc) => ({
        _id: doc._id,
        documentType: doc.documentType,
        fileName: doc.fileName,
        contentType: doc.contentType,
        size: doc.size,
        reviewStatus: doc.reviewStatus,
        reviewNote: doc.reviewNote ?? null,
        reviewedAt: doc.reviewedAt ?? null,
        reviewedByName: await nameOf(doc.reviewedBy),
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    );

    const reviewHistory = await Promise.all(
      history.map(async (entry) => ({
        _id: entry._id,
        action: entry.action,
        documentId: entry.documentId ?? null,
        statusBefore: entry.statusBefore ?? null,
        statusAfter: entry.statusAfter ?? null,
        note: entry.note ?? null,
        createdAt: entry.createdAt,
        actorName: await nameOf(entry.actorId),
      })),
    );

    const blockers = org.organizationType
      ? getVerificationBlockers(org.organizationType, documents).map(
          (slot) => slot.label,
        )
      : ["The organization type is missing"];

    const declarations = readOrganizationDeclarations(org);
    const isOwnOrganization = org.createdBy === staff._id;
    // Reasons it can't be verified that no one can fix from the review page.
    const verifyBlocked = isOwnOrganization
      ? "You can't review an organization you created."
      : declarations === null
        ? "This application was made before we asked where the organization is registered, what it expects to raise and who owns it. Reject it and ask the owner to apply again."
        : null;
    const viewerIsMlro = isMlro(staff);

    return {
      _id: org._id,
      name: org.name,
      slug: org.slug,
      description: org.description ?? null,
      website: org.website ?? null,
      contactEmail: org.contactEmail ?? null,
      contactPhone: org.contactPhone ?? null,
      registrationNumber: org.registrationNumber ?? null,
      organizationType: org.organizationType ?? null,
      verificationStatus: org.verificationStatus,
      submittedAt: org.verificationSubmittedAt ?? org.createdAt,
      verifiedAt: org.verifiedAt ?? null,
      rejectionReason: org.rejectionReason ?? null,
      owner: owner
        ? {
            name: owner.displayName,
            email: owner.email,
            phone: owner.phoneNumber ?? null,
          }
        : null,
      documents: reviewDocuments,
      blockers,
      canVerify:
        org.verificationStatus === "PENDING_REVIEW" &&
        blockers.length === 0 &&
        verifyBlocked === null,
      verifyBlocked,
      escalatedAt: org.escalatedAt ?? null,
      viewerIsMlro,
      declarations,
      anyPepDeclared: anyPepDeclared(declarations, beneficialOwners),
      // Staff only: this is the one place the register's ID numbers are shown.
      owners: beneficialOwners.map((o) => ({
        _id: o._id,
        fullName: o.fullName,
        idType: o.idType,
        idNumber: o.idNumber,
        basis: o.basis,
        ownershipPercent: o.ownershipPercent ?? null,
        role: o.role ?? null,
        residenceCountry: o.residenceCountry,
        pepDeclared: o.pepDeclared,
      })),
      ownersProblem: ownershipProblem(beneficialOwners),
      ownersLocked: ownersLockedReason(org, staff, riskProfile !== null),
      requiredChecks: ORGANIZATION_REVIEW_CHECKS,
      confirmedChecks: org.confirmedChecks ?? [],
      riskProfile: riskProfile
        ? {
            rating: riskProfile.rating,
            computedRating: riskProfile.computedRating,
            factors: riskProfile.factors,
            eddReasons: riskProfile.eddReasons,
            eddOutstanding: isEddOutstanding(riskProfile),
            pepOutcome: riskProfile.pepOutcome,
            behaviour: riskProfile.behaviour,
            residenceCountry: riskProfile.residenceCountry,
            expectedAmountKes: riskProfile.expectedAmountKes,
            mlroFlagged: riskProfile.mlroFlagged,
            overrideRating: riskProfile.overrideRating ?? null,
            overrideReason: riskProfile.overrideReason ?? null,
            ratedAt: riskProfile.ratedAt,
            ratedByName: await nameOf(riskProfile.ratedBy),
            nextReviewDue: riskProfile.nextReviewDue,
            eddCompletedAt: riskProfile.eddCompletedAt ?? null,
            eddCompletedByName: await nameOf(riskProfile.eddCompletedBy),
            sourceOfFunds: riskProfile.sourceOfFunds ?? null,
            sourceOfWealth: riskProfile.sourceOfWealth ?? null,
            eddNote: riskProfile.eddNote ?? null,
            complexStructure: riskProfile.complexStructure,
            highRiskSector: riskProfile.highRiskSector,
            noOwnerIdentified: riskProfile.noOwnerIdentified,
          }
        : null,
      // The MLRO can change any rating, but not that of their own organization.
      canManageRisk: viewerIsMlro && !isOwnOrganization,
      canRate:
        viewerIsMlro &&
        !isOwnOrganization &&
        riskProfile === null &&
        org.verificationStatus === "VERIFIED",
      history: reviewHistory,
    };
  },
});

export const reviewDocument = mutation({
  args: {
    documentId: v.id("organizationDocuments"),
    // PENDING is "undo": put a document back to unreviewed after a mis-click.
    decision: v.union(
      v.literal("PENDING"),
      v.literal("APPROVED"),
      v.literal("REJECTED"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new ConvexError("Document not found.");

    const org = await ctx.db.get(doc.organizationId);
    if (!org) throw new ConvexError("Organization not found.");
    if (org.verificationStatus !== "PENDING_REVIEW") {
      throw new ConvexError(
        "This organization is no longer waiting for review.",
      );
    }

    const note = cleanNote(args.note);
    if (args.decision === "REJECTED" && !note) {
      throw new ConvexError("Explain what needs to be replaced.");
    }

    const reviewed = args.decision !== "PENDING";
    await ctx.db.patch(doc._id, {
      reviewStatus: args.decision,
      reviewNote: args.decision === "REJECTED" ? note : undefined,
      reviewedAt: reviewed ? Date.now() : undefined,
      reviewedBy: reviewed ? staff._id : undefined,
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "DOCUMENT_REVIEWED",
      organizationId: org._id,
      documentId: doc._id,
      statusBefore: doc.reviewStatus,
      statusAfter: args.decision,
      note: args.decision === "REJECTED" ? note : undefined,
    });
  },
});

export const verifyOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    // What the reviewer confirmed beyond the documents. Every check has to be
    // among them, and they are stored with the verification.
    confirmedChecks: v.array(organizationReviewCheckValidator),
    // What the reviewer found when screening (policy 4.3, 6, 7.1), which with
    // what the organization declared sets its risk rating.
    pepOutcome: pepOutcomeValidator,
    behaviour: riskLevelValidator,
    complexStructure: v.boolean(),
    highRiskSector: v.boolean(),
    // Only the MLRO's: the enhanced due diligence record (policy 7.2, 8.2),
    // needed when the rating calls for it.
    edd: v.optional(eddRecordValidator),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new ConvexError("Organization not found.");
    if (org.verificationStatus !== "PENDING_REVIEW") {
      throw new ConvexError(
        "This organization is no longer waiting for review.",
      );
    }
    // Someone with staff access can still register an organization. They must
    // not be the one to verify it.
    if (org.createdBy === staff._id) {
      throw new ConvexError("You can't review an organization you created.");
    }
    if (!org.organizationType) {
      throw new ConvexError("This organization has no type set.");
    }

    const documents = await listDocuments(ctx, org._id);
    const blockers = getVerificationBlockers(org.organizationType, documents);
    if (blockers.length > 0) {
      throw new ConvexError(
        `Approve these documents first: ${blockers.map((slot) => slot.label).join(", ")}.`,
      );
    }

    const unconfirmed = ORGANIZATION_REVIEW_CHECKS.filter(
      (check) => !args.confirmedChecks.includes(check),
    );
    if (unconfirmed.length > 0) {
      throw new ConvexError(
        `Confirm each check before verifying: ${unconfirmed
          .map((check) => ORGANIZATION_REVIEW_CHECK_LABELS[check])
          .join("; ")}.`,
      );
    }

    const declared = readOrganizationDeclarations(org);
    if (!declared) {
      throw new ConvexError(
        "This application doesn't say where the organization is registered, what it expects to raise or who owns it. Reject it and ask the owner to apply again.",
      );
    }
    // Someone it names as a PEP is one. Only the MLRO deals with that, and by
    // recording EDD, not by clearing the declaration.
    const owners = await listBeneficialOwners(ctx, org._id);
    if (anyPepDeclared(declared, owners) && args.pepOutcome === "NOT_PEP") {
      throw new ConvexError(
        "The organization named someone who holds a senior public position, so the screening result has to say so.",
      );
    }

    // Checks the register (policy 6) and the rating, and needs the MLRO and an
    // EDD record if the rating calls for them.
    await createOrganizationRiskProfile(ctx, {
      staff,
      organizationId: org._id,
      registeredCountry: declared.registeredCountry,
      expectedAmountKes: declared.expectedAmountKes,
      pepOutcome: args.pepOutcome,
      behaviour: args.behaviour,
      complexStructure: args.complexStructure,
      highRiskSector: args.highRiskSector,
      edd: args.edd,
    });

    const now = Date.now();
    await ctx.db.patch(org._id, {
      verificationStatus: "VERIFIED",
      verifiedAt: now,
      verifiedBy: staff._id,
      confirmedChecks: [...ORGANIZATION_REVIEW_CHECKS],
      rejectionReason: undefined,
      updatedAt: now,
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "ORGANIZATION_VERIFIED",
      organizationId: org._id,
      statusBefore: org.verificationStatus,
      statusAfter: "VERIFIED",
    });
  },
});

// A reviewer who can't verify an organization, because it needs the MLRO (a
// PEP, a non-resident, high risk) or because something about it worries them,
// passes it on. Nothing changes for the owner, whose application stays "being
// reviewed" (policy 12.3).
export const escalateOrganization = mutation({
  args: { organizationId: v.id("organizations"), note: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new ConvexError("Organization not found.");
    if (org.verificationStatus !== "PENDING_REVIEW") {
      throw new ConvexError(
        "This organization is no longer waiting for review.",
      );
    }
    if (org.createdBy === staff._id) {
      throw new ConvexError("You can't review an organization you created.");
    }

    const note = cleanNote(args.note);
    if (!note || note.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError("Tell the MLRO why (at least 10 characters).");
    }
    if (org.escalatedAt !== undefined) {
      throw new ConvexError("This has already been passed to the MLRO.");
    }

    await ctx.db.patch(org._id, { escalatedAt: Date.now() });

    await logAction(ctx, {
      actorId: staff._id,
      action: "ORGANIZATION_ESCALATED",
      organizationId: org._id,
      note,
    });
  },
});

export const rejectOrganization = mutation({
  args: { organizationId: v.id("organizations"), reason: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new ConvexError("Organization not found.");
    if (org.verificationStatus !== "PENDING_REVIEW") {
      throw new ConvexError(
        "This organization is no longer waiting for review.",
      );
    }

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Give the owner a reason for the rejection (at least 10 characters).",
      );
    }

    await ctx.db.patch(org._id, {
      verificationStatus: "REJECTED",
      rejectionReason: reason,
      updatedAt: Date.now(),
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "ORGANIZATION_REJECTED",
      organizationId: org._id,
      statusBefore: org.verificationStatus,
      statusAfter: "REJECTED",
      note: reason,
    });
  },
});

// Holding payouts (policy 3.3, 8.2). Any staff member can stop money moving;
// only an admin can let it go again, so a hold can't be undone by the same
// person who may have been pressured to place it, and a moderator can't
// quietly clear one.
export const placePayoutHold = mutation({
  args: { fundraiserId: v.id("fundraisers"), reason: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) throw new ConvexError("Fundraiser not found.");

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Record why payouts are being held (at least 10 characters).",
      );
    }

    if (await getActivePayoutHold(ctx, fundraiser._id)) {
      throw new ConvexError("Payouts for this fundraiser are already on hold.");
    }

    await placePayoutHoldFor(ctx, {
      fundraiserId: fundraiser._id,
      staffId: staff._id,
      reason,
    });
  },
});

export const releasePayoutHold = mutation({
  args: { fundraiserId: v.id("fundraisers"), note: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const hold = await getActivePayoutHold(ctx, args.fundraiserId);
    if (!hold) {
      throw new ConvexError("Payouts for this fundraiser aren't on hold.");
    }

    const note = cleanNote(args.note);
    if (!note || note.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Record why the hold is being lifted (at least 10 characters).",
      );
    }

    await ctx.db.patch(hold._id, {
      status: "RELEASED",
      releasedBy: admin._id,
      releasedAt: Date.now(),
      releaseNote: note,
    });

    await logAction(ctx, {
      actorId: admin._id,
      action: "PAYOUT_HOLD_RELEASED",
      fundraiserId: args.fundraiserId,
      statusBefore: "ON_HOLD",
      statusAfter: "NO_HOLD",
      note,
    });
  },
});

// Why a role can't be GIVEN to an account, in words for the person at the
// command line.
function grantRefusal(block: StaffAccessBlock, rule: StaffEmailRule): string {
  if (block === "EMAIL_NOT_CONFIRMED") {
    return "their email address isn't confirmed yet. Ask them to confirm it (they are asked to after signing in), then run this again.";
  }
  return rule.domains.length > 0
    ? `STAFF_EMAIL_DOMAINS only allows addresses at ${rule.domains.join(", ")}. Use their company account.`
    : "STAFF_EMAIL_DOMAINS is set but holds no usable domain, so nobody can be given a staff role. Correct it (for example to gouplift.co.ke) or remove it.";
}

// There is deliberately no public way to grant a role. Bootstrap the first
// admin (and later staff) from the CLI:
//   npx convex run admin:setUserRole '{"email":"you@example.com","role":"ADMIN"}'
// A staff role can only be given to an account whose email is confirmed and, once
// STAFF_EMAIL_DOMAINS is set, is a company address. Taking a role away
// ("USER") always works. Every change is kept in staffRoleChanges and raises a
// STAFF_ROLE_CHANGED alert.
export const setUserRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  returns: v.object({
    email: v.string(),
    role: roleValidator,
    changed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new ConvexError(`No user found with email ${email}.`);

    // The sign-in service's record is the source of truth for whether the
    // address was confirmed. No record counts as not confirmed.
    const authUser = await authComponent.getAnyUserById(ctx, user.authUserId);
    const emailConfirmed = authUser?.emailVerified === true;

    if (args.role !== "USER") {
      const rule = staffEmailRule(process.env.STAFF_EMAIL_DOMAINS);
      const block = staffAccessBlock({
        email: authUser?.email || user.email,
        emailConfirmed,
        rule,
      });
      if (block) {
        throw new ConvexError(
          `Can't make ${email} ${args.role}: ${grantRefusal(block, rule)}`,
        );
      }
    }

    if (user.role === args.role) {
      return { email, role: args.role, changed: false };
    }

    const now = Date.now();
    await ctx.db.patch(user._id, { role: args.role, updatedAt: now });
    await ctx.db.insert("staffRoleChanges", {
      userId: user._id,
      email,
      roleBefore: user.role,
      roleAfter: args.role,
      emailConfirmed,
      changedAt: now,
    });
    await recordAlert(ctx, {
      kind: "STAFF_ROLE_CHANGED",
      reference: user._id,
      detail: `${user.displayName}: ${user.role} to ${args.role}`,
    });
    return { email, role: args.role, changed: true };
  },
});

const STAFF_LIST_CAP = 50;

// Run this BEFORE turning the company-email rule on (or changing it), so nobody
// finds out by being locked out:
//   npx convex run admin:listStaff
//       who is staff, and whether they can sign in to the admin area now
//   npx convex run admin:listStaff '{"domains":"gouplift.co.ke"}'
//       the same, as it WOULD be with that setting
// `anAdminCanStillSignIn` must be true before the setting is changed.
export const listStaff = internalQuery({
  args: { domains: v.optional(v.string()) },
  returns: v.object({
    rule: v.object({ enforced: v.boolean(), domains: v.array(v.string()) }),
    anAdminCanStillSignIn: v.boolean(),
    truncated: v.boolean(),
    staff: v.array(
      v.object({
        email: v.string(),
        name: v.string(),
        role: staffRoleValidator,
        emailConfirmed: v.boolean(),
        access: v.union(v.literal("OK"), staffBlockValidator),
        lastChangedAt: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const rule = staffEmailRule(
      args.domains ?? process.env.STAFF_EMAIL_DOMAINS,
    );
    const staff: Array<{
      email: string;
      name: string;
      role: "ADMIN" | "MODERATOR";
      emailConfirmed: boolean;
      access: "OK" | StaffAccessBlock;
      lastChangedAt: number | null;
    }> = [];
    let truncated = false;

    for (const role of ["ADMIN", "MODERATOR"] as const) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", role))
        .take(STAFF_LIST_CAP + 1);
      if (rows.length > STAFF_LIST_CAP) truncated = true;

      for (const user of rows.slice(0, STAFF_LIST_CAP)) {
        const authUser = await authComponent.getAnyUserById(
          ctx,
          user.authUserId,
        );
        const email = authUser?.email || user.email;
        const emailConfirmed = authUser?.emailVerified === true;
        const last = await ctx.db
          .query("staffRoleChanges")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .order("desc")
          .first();
        staff.push({
          email,
          name: user.displayName,
          role,
          emailConfirmed,
          access: staffAccessBlock({ email, emailConfirmed, rule }) ?? "OK",
          lastChangedAt: last?.changedAt ?? null,
        });
      }
    }

    return {
      rule,
      anAdminCanStillSignIn: staff.some(
        (member) => member.role === "ADMIN" && member.access === "OK",
      ),
      truncated,
      staff,
    };
  },
});

const money = (n: number) => Math.round(n * 100) / 100;

// Callers fetch cap + 1 rows so "exactly cap" and "more than cap" differ.
function tally(rows: unknown[], cap: number) {
  return { count: Math.min(rows.length, cap), capped: rows.length > cap };
}

function sumOf<T>(rows: T[], cap: number, pick: (row: T) => number) {
  return money(rows.slice(0, cap).reduce((total, row) => total + pick(row), 0));
}

export const getAttentionCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);

    const [orgs, fundraisers, reports, alerts] = await Promise.all([
      ctx.db
        .query("organizations")
        .withIndex("by_verificationStatus", (q) =>
          q.eq("verificationStatus", "PENDING_REVIEW"),
        )
        .take(QUEUE_CAP + 1),
      ctx.db
        .query("fundraisers")
        .withIndex("by_status", (q) => q.eq("status", "PENDING_REVIEW"))
        .take(QUEUE_CAP + 1),
      // Open reports on fundraisers; several on one fundraiser count once.
      ctx.db
        .query("fundraiserReports")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "OPEN"))
        .take(QUEUE_CAP + 1),
      // Open problems with payments (see systemAlerts.ts).
      ctx.db
        .query("systemAlerts")
        .withIndex("by_status_and_lastSeenAt", (q) => q.eq("status", "OPEN"))
        .take(QUEUE_CAP + 1),
    ]);

    return {
      orgsAwaitingVerification: tally(orgs, QUEUE_CAP),
      fundraisersAwaitingReview: tally(fundraisers, QUEUE_CAP),
      fundraisersReported: {
        count: Math.min(
          new Set(reports.map((report) => report.fundraiserId)).size,
          QUEUE_CAP,
        ),
        capped: reports.length > QUEUE_CAP,
      },
      systemAlerts: {
        ...tally(alerts, QUEUE_CAP),
        // The ones that mean money may have gone unrecorded.
        errors: alerts
          .slice(0, QUEUE_CAP)
          .filter((alert) => SYSTEM_ALERTS[alert.kind].severity === "ERROR")
          .length,
      },
    };
  },
});

export const getPlatformTotals = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);

    const [users, active, completed, balances] = await Promise.all([
      ctx.db.query("users").take(TOTALS_CAP + 1),
      ctx.db
        .query("fundraisers")
        .withIndex("by_status", (q) => q.eq("status", "ACTIVE"))
        .take(TOTALS_CAP + 1),
      ctx.db
        .query("donations")
        .withIndex("by_status", (q) => q.eq("status", "COMPLETED"))
        .take(TOTALS_CAP + 1),
      // What fundraisers could withdraw right now, from the running balances.
      ctx.db.query("fundraiserBalances").take(TOTALS_CAP + 1),
    ]);
    const owed = balances
      .slice(0, TOTALS_CAP)
      .map((row) => availableBalance(row))
      .filter((amount) => amount > 0);

    return {
      cap: TOTALS_CAP,
      users: tally(users, TOTALS_CAP),
      activeFundraisers: tally(active, TOTALS_CAP),
      completedDonations: {
        ...tally(completed, TOTALS_CAP),
        grossVolume: sumOf(completed, TOTALS_CAP, (d) => d.grossAmount),
        platformFees: sumOf(completed, TOTALS_CAP, (d) => d.platformFeeAmount),
      },
      // Fundraisers with money they could withdraw, and how much in total.
      pendingPayouts: {
        count: owed.length,
        capped: balances.length > TOTALS_CAP,
        netOwed: money(owed.reduce((total, amount) => total + amount, 0)),
      },
    };
  },
});

export const getPlatformDonationSeries = query({
  // The client passes the start of today so the query never reads the clock,
  // which keeps its result cacheable.
  args: { startOfToday: v.number(), days: v.number() },
  handler: async (ctx, args) => {
    await requireStaff(ctx);

    const days = Math.min(Math.max(Math.floor(args.days), 1), MAX_DAYS);
    const firstDayStart = args.startOfToday - (days - 1) * DAY_MS;

    // Newest first, so if the cap is hit the oldest days are the ones cut.
    const rows = await ctx.db
      .query("donations")
      .withIndex("by_status", (q) =>
        q.eq("status", "COMPLETED").gte("_creationTime", firstDayStart),
      )
      .order("desc")
      .take(SERIES_CAP + 1);

    const truncated = rows.length > SERIES_CAP;

    const series = Array.from({ length: days }, (_, i) => ({
      // Label each bucket with its East Africa calendar date.
      date: new Date(firstDayStart + i * DAY_MS + EAT_OFFSET_MS)
        .toISOString()
        .slice(0, 10),
      netAmount: 0,
      platformFeeAmount: 0,
      grossAmount: 0,
      donationCount: 0,
    }));

    for (const donation of rows.slice(0, SERIES_CAP)) {
      const when = donation.completedAt ?? donation._creationTime;
      const i = Math.floor((when - firstDayStart) / DAY_MS);
      if (i < 0 || i >= days) continue;

      series[i].netAmount += donation.netAmount;
      series[i].platformFeeAmount += donation.platformFeeAmount;
      series[i].grossAmount += donation.grossAmount;
      series[i].donationCount += 1;
    }

    return {
      truncated,
      days: series.map((d) => ({
        ...d,
        netAmount: money(d.netAmount),
        platformFeeAmount: money(d.platformFeeAmount),
        grossAmount: money(d.grossAmount),
      })),
    };
  },
});
