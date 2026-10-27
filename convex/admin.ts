import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getStaffUser, requireStaff } from "./lib/staff";
import { getVerificationBlockers } from "../lib/organization-verification";

const LIST_LIMIT = 100;
const DOCUMENTS_LIMIT = 50;
const HISTORY_LIMIT = 30;
const MAX_NOTE_LENGTH = 1000;
const MIN_REJECTION_REASON_LENGTH = 10;

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

function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new ConvexError(`Keep notes under ${MAX_NOTE_LENGTH} characters.`);
  }
  return trimmed;
}

async function logAction(
  ctx: MutationCtx,
  entry: Omit<Doc<"adminAuditLog">, "_id" | "_creationTime" | "createdAt">,
) {
  await ctx.db.insert("adminAuditLog", { ...entry, createdAt: Date.now() });
}

// Whether the signed-in user is staff. The /admin layout calls this to decide
// between rendering the admin area and a 404.
export const getStaffAccess = query({
  args: {},
  handler: async (ctx) => {
    const staff = await getStaffUser(ctx);
    return staff ? { role: staff.role, name: staff.displayName } : null;
  },
});

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

    const [owner, documents, history] = await Promise.all([
      ctx.db.get(org.createdBy),
      listDocuments(ctx, org._id),
      ctx.db
        .query("adminAuditLog")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", org._id),
        )
        .order("desc")
        .take(HISTORY_LIMIT),
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
        org.verificationStatus === "PENDING_REVIEW" && blockers.length === 0,
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
      throw new ConvexError("This organization is no longer waiting for review.");
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
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new ConvexError("Organization not found.");
    if (org.verificationStatus !== "PENDING_REVIEW") {
      throw new ConvexError("This organization is no longer waiting for review.");
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

    const now = Date.now();
    await ctx.db.patch(org._id, {
      verificationStatus: "VERIFIED",
      verifiedAt: now,
      verifiedBy: staff._id,
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

export const rejectOrganization = mutation({
  args: { organizationId: v.id("organizations"), reason: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new ConvexError("Organization not found.");
    if (org.verificationStatus !== "PENDING_REVIEW") {
      throw new ConvexError("This organization is no longer waiting for review.");
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

// There is deliberately no public way to grant a role. Bootstrap the first
// admin (and later staff) from the CLI:
//   npx convex run admin:setUserRole '{"email":"you@example.com","role":"ADMIN"}'
export const setUserRole = internalMutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("USER"),
      v.literal("MODERATOR"),
      v.literal("ADMIN"),
    ),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new ConvexError(`No user found with email ${email}.`);

    await ctx.db.patch(user._id, { role: args.role, updatedAt: Date.now() });
    return { email, role: args.role };
  },
});
