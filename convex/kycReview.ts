import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  KYC_REVIEW_CHECK_LABELS,
  REQUIRED_KYC_REVIEW_CHECKS,
} from "../lib/kyc";
import { assessRisk, isEddOutstanding } from "../lib/risk";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getApprovedKycSubmissions, highestKycTier } from "./lib/kycTier";
import {
  kycReviewCheckValidator,
  kycSubmissionStatusValidator,
} from "./lib/kycValidators";
import { isMlro } from "./lib/mlro";
import {
  assessmentPatch,
  createRiskProfile,
  describeRating,
  getRiskProfile,
  readDeclarations,
  reassessProfile,
} from "./lib/riskProfile";
import {
  eddRecordValidator,
  pepOutcomeValidator,
  riskLevelValidator,
} from "./lib/riskValidators";
import { getStaffUser, requireStaff } from "./lib/staff";

// Staff side of individual verification (AML policy 5.3, 5.4, 7, 8). Nothing
// here is reachable by the applicant: the queries return nothing to anyone who
// isn't staff, and a signed file URL is only ever produced in getKycForReview.
// An applicant who needs enhanced due diligence (a PEP, a non-resident, high
// risk) can only be approved by the MLRO; other reviewers pass it on with
// escalateKyc. The applicant is never told (policy 12.3).

const LIST_LIMIT = 100;
const DOCUMENTS_LIMIT = 20;
const HISTORY_LIMIT = 30;
const SHARED_LIMIT = 10;

type SharedMatch = {
  submissionId: Id<"kycSubmissions">;
  userId: Id<"users">;
  matchedOn: "ID_NUMBER" | "PHONE_NUMBER";
  status: Doc<"kycSubmissions">["status"];
  requestedTier: Doc<"kycSubmissions">["requestedTier"];
  submittedAt: number;
};

const ALL_STATUSES = ["APPROVED", "PENDING_REVIEW", "REJECTED"] as const;

// The same ID or the same phone number on a different account (policy 10: one
// number, ID or account behind several fundraisers is a red flag). Only
// reviewers see this; the applicant is never told (policy 12.3).
async function findSharedIdentifiers(
  ctx: QueryCtx | MutationCtx,
  submission: Doc<"kycSubmissions">,
): Promise<SharedMatch[]> {
  const matches: SharedMatch[] = [];
  const add = (
    rows: Doc<"kycSubmissions">[],
    matchedOn: SharedMatch["matchedOn"],
  ) => {
    for (const row of rows) {
      if (row.userId === submission.userId) continue;
      matches.push({
        submissionId: row._id,
        userId: row.userId,
        matchedOn,
        status: row.status,
        requestedTier: row.requestedTier,
        submittedAt: row.submittedAt,
      });
    }
  };

  const { idType, idNumber, phoneNumber } = submission;
  for (const status of ALL_STATUSES) {
    if (idType && idNumber) {
      add(
        await ctx.db
          .query("kycSubmissions")
          .withIndex("by_idType_and_idNumber_and_status", (q) =>
            q.eq("idType", idType).eq("idNumber", idNumber).eq("status", status),
          )
          .take(SHARED_LIMIT),
        "ID_NUMBER",
      );
    }
    if (phoneNumber) {
      add(
        await ctx.db
          .query("kycSubmissions")
          .withIndex("by_phoneNumber_and_status", (q) =>
            q.eq("phoneNumber", phoneNumber).eq("status", status),
          )
          .take(SHARED_LIMIT),
        "PHONE_NUMBER",
      );
    }
  }
  return matches;
}

function previewNeedsMlro(submission: Doc<"kycSubmissions">): boolean {
  if (submission.requestedTier !== 1) return false;
  const declared = readDeclarations(submission);
  if (!declared) return false;
  return assessRisk({
    expectedAmountKes: declared.expectedAmountKes,
    residenceCountry: declared.residenceCountry,
    pepOutcome: declared.pepDeclared ? "PEP" : "NOT_PEP",
    behaviour: "LOW",
    tier: 1,
  }).requiresEdd;
}

export const listKycForReview = query({
  args: { status: kycSubmissionStatusValidator },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    // Waiting applications oldest first so nobody is left queueing; decided
    // ones newest first.
    const submissions = await ctx.db
      .query("kycSubmissions")
      .withIndex("by_status_and_submittedAt", (q) => q.eq("status", args.status))
      .order(args.status === "PENDING_REVIEW" ? "asc" : "desc")
      .take(LIST_LIMIT);

    return await Promise.all(
      submissions.map(async (submission) => {
        const [applicant, documents] = await Promise.all([
          ctx.db.get(submission.userId),
          ctx.db
            .query("kycDocuments")
            .withIndex("by_submissionId", (q) =>
              q.eq("submissionId", submission._id),
            )
            .take(DOCUMENTS_LIMIT),
        ]);

        return {
          _id: submission._id,
          requestedTier: submission.requestedTier,
          status: submission.status,
          submittedAt: submission.submittedAt,
          reviewedAt: submission.reviewedAt ?? null,
          applicantName:
            submission.legalName ?? applicant?.displayName ?? "Unknown",
          documentCount: documents.length,
          escalated: submission.escalatedAt !== undefined,
          // From what they declared alone: a reviewer's own findings can still
          // add to this.
          needsMlro: previewNeedsMlro(submission),
        };
      }),
    );
  },
});

export const getKycForReview = query({
  // A string, not v.id(): the value comes straight from the URL, and an
  // invalid one should read as "not found" rather than throw.
  args: { submissionId: v.string() },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return null;

    const submissionId = ctx.db.normalizeId("kycSubmissions", args.submissionId);
    if (!submissionId) return null;

    const submission = await ctx.db.get(submissionId);
    if (!submission) return null;

    const [applicant, documents, history, approved, shared, riskProfile] =
      await Promise.all([
        ctx.db.get(submission.userId),
        ctx.db
          .query("kycDocuments")
          .withIndex("by_submissionId", (q) =>
            q.eq("submissionId", submission._id),
          )
          .take(DOCUMENTS_LIMIT),
        ctx.db
          .query("adminAuditLog")
          .withIndex("by_kycSubmissionId", (q) =>
            q.eq("kycSubmissionId", submission._id),
          )
          .order("desc")
          .take(HISTORY_LIMIT),
        getApprovedKycSubmissions(ctx, submission.userId),
        findSharedIdentifiers(ctx, submission),
        getRiskProfile(ctx, submission.userId),
      ]);

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

    // The identity a Tier 2 application builds on, so the reviewer can check
    // the KRA PIN and the payout account belong to the same person.
    const tierOne = approved.find((s) => s.requestedTier === 1);

    const isOwnApplication = staff._id === submission.userId;
    const duplicateApprovedId = shared.some(
      (m) => m.matchedOn === "ID_NUMBER" && m.status === "APPROVED",
    );
    let decisionBlocked: string | null = null;
    if (isOwnApplication) {
      decisionBlocked = "You can't review your own verification.";
    } else if (submission.requestedTier === 1 && duplicateApprovedId) {
      decisionBlocked =
        "This ID is already verified on another account. It can't be approved.";
    }

    const declarations =
      submission.requestedTier === 1 ? readDeclarations(submission) : null;
    // An application made before the declarations were asked can't be rated, so
    // it can only be rejected, asking the applicant to apply again.
    const approveBlocked =
      submission.requestedTier === 1 && declarations === null
        ? "This application was made before we asked where the applicant lives, what they expect to raise and whether they are a PEP. Reject it and ask them to apply again."
        : null;

    const viewerIsMlro = isMlro(staff);
    const profileSubject = riskProfile
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
        }
      : null;

    return {
      _id: submission._id,
      status: submission.status,
      requestedTier: submission.requestedTier,
      submittedAt: submission.submittedAt,
      escalatedAt: submission.escalatedAt ?? null,
      viewerIsMlro,
      // What they are verified to now, which the rating is worked out at.
      kycTier: highestKycTier(approved),
      declarations,
      riskProfile: profileSubject,
      // The MLRO can rate someone approved before risk was rated, and change
      // anyone's rating, but not their own.
      canManageRisk: viewerIsMlro && !isOwnApplication,
      canRate:
        viewerIsMlro &&
        !isOwnApplication &&
        riskProfile === null &&
        submission.status === "APPROVED" &&
        submission.requestedTier === 1,
      reviewedAt: submission.reviewedAt ?? null,
      reviewedByName: await nameOf(submission.reviewedBy),
      rejectionReason: submission.rejectionReason ?? null,
      confirmedChecks: submission.confirmedChecks ?? [],
      applicant: applicant
        ? { name: applicant.displayName, email: applicant.email }
        : null,
      details: {
        legalName: submission.legalName ?? null,
        idType: submission.idType ?? null,
        idNumber: submission.idNumber ?? null,
        phoneNumber: submission.phoneNumber ?? null,
        campaignPurpose: submission.campaignPurpose ?? null,
        kraPin: submission.kraPin ?? null,
      },
      identityOnFile:
        submission.requestedTier === 2 && tierOne
          ? {
              legalName: tierOne.legalName ?? null,
              idType: tierOne.idType ?? null,
              idNumber: tierOne.idNumber ?? null,
              phoneNumber: tierOne.phoneNumber ?? null,
            }
          : null,
      documents: await Promise.all(
        documents.map(async (doc) => ({
          _id: doc._id,
          documentType: doc.documentType,
          fileName: doc.fileName,
          contentType: doc.contentType,
          size: doc.size,
          url: await ctx.storage.getUrl(doc.storageId),
        })),
      ),
      requiredChecks: REQUIRED_KYC_REVIEW_CHECKS[submission.requestedTier],
      sharedIdentifiers: await Promise.all(
        shared.map(async (match) => ({
          submissionId: match.submissionId,
          matchedOn: match.matchedOn,
          status: match.status,
          requestedTier: match.requestedTier,
          submittedAt: match.submittedAt,
          userName: await nameOf(match.userId),
        })),
      ),
      canDecide:
        submission.status === "PENDING_REVIEW" && decisionBlocked === null,
      decisionBlocked,
      approveBlocked,
      history: await Promise.all(
        history.map(async (entry) => ({
          _id: entry._id,
          action: entry.action,
          statusBefore: entry.statusBefore ?? null,
          statusAfter: entry.statusAfter ?? null,
          note: entry.note ?? null,
          createdAt: entry.createdAt,
          actorName: await nameOf(entry.actorId),
        })),
      ),
    };
  },
});

async function loadPendingSubmission(
  ctx: MutationCtx,
  submissionId: Id<"kycSubmissions">,
  staff: Doc<"users">,
) {
  const submission = await ctx.db.get(submissionId);
  if (!submission) throw new ConvexError("Verification not found.");
  if (submission.status !== "PENDING_REVIEW") {
    throw new ConvexError("This verification is no longer waiting for review.");
  }
  // Someone with staff access can still apply to be verified. They must not be
  // the one to approve it.
  if (submission.userId === staff._id) {
    throw new ConvexError("You can't review your own verification.");
  }
  return submission;
}

export const approveKyc = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    // What the reviewer confirmed against the documents. Every check the tier
    // asks for has to be among them, and is stored with the approval.
    confirmedChecks: v.array(kycReviewCheckValidator),
    // Level 1 only: what the reviewer found when screening, which with what the
    // applicant declared sets the risk rating (policy 4.3, 7.1).
    pepOutcome: v.optional(pepOutcomeValidator),
    behaviour: v.optional(riskLevelValidator),
    // Level 1 only, and only the MLRO's: the enhanced due diligence record
    // (policy 7.2, 8.2), needed when the rating calls for it.
    edd: v.optional(eddRecordValidator),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const submission = await loadPendingSubmission(
      ctx,
      args.submissionId,
      staff,
    );

    const required = REQUIRED_KYC_REVIEW_CHECKS[submission.requestedTier];
    const unconfirmed = required.filter(
      (check) => !args.confirmedChecks.includes(check),
    );
    if (unconfirmed.length > 0) {
      throw new ConvexError(
        `Confirm each check before approving: ${unconfirmed
          .map((check) => KYC_REVIEW_CHECK_LABELS[check])
          .join("; ")}.`,
      );
    }

    if (submission.requestedTier === 2) {
      const tier = highestKycTier(
        await getApprovedKycSubmissions(ctx, submission.userId),
      );
      if (tier < 1) {
        throw new ConvexError(
          "Identity verification (Tier 1) has to be approved first.",
        );
      }

      // Level 2 means they expect to be paid more, which can raise the rating
      // (never lower it) and so how soon they are reviewed again.
      const profile = await getRiskProfile(ctx, submission.userId);
      if (profile) {
        const assessment = reassessProfile(profile, 2);
        if (assessment.rating !== profile.rating) {
          await ctx.db.patch(
            profile._id,
            assessmentPatch(profile, assessment, staff._id, Date.now()),
          );
          await logAction(ctx, {
            actorId: staff._id,
            action: "RISK_RATED",
            kycSubmissionId: submission._id,
            statusBefore: profile.rating,
            statusAfter: assessment.rating,
            note: describeRating(assessment),
          });
        }
      }
    } else {
      const shared = await findSharedIdentifiers(ctx, submission);
      if (
        shared.some((m) => m.matchedOn === "ID_NUMBER" && m.status === "APPROVED")
      ) {
        throw new ConvexError(
          "This ID is already verified on another account. It can't be approved.",
        );
      }

      const declared = readDeclarations(submission);
      if (!declared) {
        throw new ConvexError(
          "This application doesn't say where the applicant lives, what they expect to raise or whether they are a PEP. Reject it and ask them to apply again.",
        );
      }
      if (!args.pepOutcome || !args.behaviour) {
        throw new ConvexError(
          "Record the PEP screening result and what you saw of the applicant's behaviour.",
        );
      }
      // Someone who says they are a PEP is one. Only the MLRO deals with that,
      // and by recording EDD, not by clearing the declaration.
      if (declared.pepDeclared && args.pepOutcome === "NOT_PEP") {
        throw new ConvexError(
          "The applicant said they are a PEP, so the screening result has to say so.",
        );
      }

      await createRiskProfile(ctx, {
        staff,
        userId: submission.userId,
        kycSubmissionId: submission._id,
        residenceCountry: declared.residenceCountry,
        expectedAmountKes: declared.expectedAmountKes,
        pepOutcome: args.pepOutcome,
        behaviour: args.behaviour,
        tier: 1,
        edd: args.edd,
      });
    }

    await ctx.db.patch(submission._id, {
      status: "APPROVED",
      reviewedBy: staff._id,
      reviewedAt: Date.now(),
      confirmedChecks: [...required],
      rejectionReason: undefined,
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "KYC_APPROVED",
      kycSubmissionId: submission._id,
      statusBefore: submission.status,
      statusAfter: "APPROVED",
      note: `Tier ${submission.requestedTier}`,
    });
  },
});

// A reviewer who can't approve an application, because it needs the MLRO (a
// PEP, a non-resident, high risk) or because something about it worries them,
// passes it on. Nothing changes for the applicant, whose application stays
// "being reviewed" (policy 12.3).
export const escalateKyc = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const submission = await loadPendingSubmission(
      ctx,
      args.submissionId,
      staff,
    );

    const note = cleanNote(args.note);
    if (!note || note.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Tell the MLRO why (at least 10 characters).",
      );
    }
    if (submission.escalatedAt !== undefined) {
      throw new ConvexError("This has already been passed to the MLRO.");
    }

    await ctx.db.patch(submission._id, { escalatedAt: Date.now() });

    await logAction(ctx, {
      actorId: staff._id,
      action: "KYC_ESCALATED",
      kycSubmissionId: submission._id,
      note,
    });
  },
});

export const rejectKyc = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    // Shown to the applicant, so it says what to fix and nothing else.
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const submission = await loadPendingSubmission(
      ctx,
      args.submissionId,
      staff,
    );

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Give the applicant a reason (at least 10 characters).",
      );
    }

    await ctx.db.patch(submission._id, {
      status: "REJECTED",
      reviewedBy: staff._id,
      reviewedAt: Date.now(),
      rejectionReason: reason,
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "KYC_REJECTED",
      kycSubmissionId: submission._id,
      statusBefore: submission.status,
      statusAfter: "REJECTED",
      note: reason,
    });
  },
});
