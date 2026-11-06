import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isCountryCode } from "../lib/countries";
import {
  eddRecordProblem,
  isEddOutstanding,
  RISK_LEVEL_LABELS,
} from "../lib/risk";
import { MAX_EXPECTED_AMOUNT_KES } from "../lib/validations/kyc";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getKycTier } from "./lib/kycTier";
import { requireMlro } from "./lib/mlro";
import {
  assessmentPatch,
  cleanEddRecord,
  createRiskProfile,
  describeRating,
  getRiskProfile,
  reassessProfile,
} from "./lib/riskProfile";
import {
  eddRecordValidator,
  pepOutcomeValidator,
  riskLevelValidator,
} from "./lib/riskValidators";

// What the MLRO can do to an individual fundraiser's risk profile (AML policy
// 4.3, 7, 8): rate someone approved before risk was rated, overrule the
// rating, require enhanced due diligence, and record it. Every function is
// the MLRO's alone, and none can be used on the MLRO's own record. Each one is
// aimed at a person through one of their verification submissions, the way the
// review screen reaches them, and is written to the audit log against it.

async function loadSubject(
  ctx: MutationCtx,
  mlro: Doc<"users">,
  submissionId: Id<"kycSubmissions">,
) {
  const submission = await ctx.db.get(submissionId);
  if (!submission) throw new ConvexError("Verification not found.");
  if (submission.userId === mlro._id) {
    throw new ConvexError("You can't change the risk rating on your own record.");
  }
  return submission;
}

async function loadProfile(
  ctx: MutationCtx,
  mlro: Doc<"users">,
  submissionId: Id<"kycSubmissions">,
) {
  const submission = await loadSubject(ctx, mlro, submissionId);
  const profile = await getRiskProfile(ctx, submission.userId);
  if (!profile) throw new ConvexError("This person hasn't been rated yet.");
  return { submission, profile };
}

function requireReason(value: string, what: string): string {
  const reason = cleanNote(value);
  if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
    throw new ConvexError(`${what} (at least 10 characters).`);
  }
  return reason;
}

// For someone whose Level 1 was approved before risk was rated. The MLRO says
// what the applicant would have declared, and the rest follows the same path as
// an approval.
export const rateCustomer = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    residenceCountry: v.string(),
    expectedAmountKes: v.number(),
    pepOutcome: pepOutcomeValidator,
    behaviour: riskLevelValidator,
    edd: v.optional(eddRecordValidator),
  },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const submission = await loadSubject(ctx, mlro, args.submissionId);

    if (submission.requestedTier !== 1 || submission.status !== "APPROVED") {
      throw new ConvexError("Only an approved Level 1 verification can be rated.");
    }
    if (await getRiskProfile(ctx, submission.userId)) {
      throw new ConvexError("This person has already been rated.");
    }

    const residenceCountry = args.residenceCountry.trim().toUpperCase();
    if (!isCountryCode(residenceCountry)) {
      throw new ConvexError("Choose the country they live in.");
    }
    if (
      !Number.isInteger(args.expectedAmountKes) ||
      args.expectedAmountKes < 1 ||
      args.expectedAmountKes > MAX_EXPECTED_AMOUNT_KES
    ) {
      throw new ConvexError("Enter the amount they expect to raise, in whole shillings.");
    }

    await createRiskProfile(ctx, {
      staff: mlro,
      userId: submission.userId,
      kycSubmissionId: submission._id,
      residenceCountry,
      expectedAmountKes: args.expectedAmountKes,
      pepOutcome: args.pepOutcome,
      behaviour: args.behaviour,
      tier: await getKycTier(ctx, submission.userId),
      edd: args.edd,
    });
  },
});

// Policy 4.3 says the highest factor sets the rating. The MLRO can still set
// it higher or lower after looking at the whole picture, and says why. A PEP
// is always High (policy 7.2).
export const overrideRiskRating = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    rating: riskLevelValidator,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const { submission, profile } = await loadProfile(
      ctx,
      mlro,
      args.submissionId,
    );
    const reason = requireReason(args.reason, "Say why you are changing the rating");

    if (profile.pepOutcome === "PEP" && args.rating !== "HIGH") {
      throw new ConvexError("A PEP is always High risk.");
    }
    if (args.rating === profile.rating) {
      throw new ConvexError(`They are already rated ${RISK_LEVEL_LABELS[args.rating]}.`);
    }

    const tier = await getKycTier(ctx, submission.userId);
    const assessment = reassessProfile(profile, tier, {
      overrideRating: args.rating,
    });
    await ctx.db.patch(profile._id, {
      ...assessmentPatch(profile, assessment, mlro._id, Date.now()),
      overrideRating: args.rating,
      overrideReason: reason,
    });

    await logAction(ctx, {
      actorId: mlro._id,
      action: "RISK_OVERRIDDEN",
      kycSubmissionId: submission._id,
      statusBefore: profile.rating,
      statusAfter: assessment.rating,
      note: `${reason} ${describeRating(assessment)}`,
    });
  },
});

// Policy 8.1: the MLRO can require enhanced due diligence whatever the rating
// says. Payouts stop until it is recorded.
export const flagForEdd = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const { submission, profile } = await loadProfile(
      ctx,
      mlro,
      args.submissionId,
    );
    const reason = requireReason(args.reason, "Say why they need enhanced due diligence");

    if (profile.mlroFlagged) {
      throw new ConvexError("They are already flagged for enhanced due diligence.");
    }

    const tier = await getKycTier(ctx, submission.userId);
    const assessment = reassessProfile(profile, tier, { mlroFlagged: true });
    await ctx.db.patch(profile._id, {
      ...assessmentPatch(profile, assessment, mlro._id, Date.now()),
      mlroFlagged: true,
    });

    await logAction(ctx, {
      actorId: mlro._id,
      action: "EDD_FLAGGED",
      kycSubmissionId: submission._id,
      statusBefore: profile.rating,
      statusAfter: assessment.rating,
      note: reason,
    });
  },
});

// Policy 7.2 and 8.2: the MLRO's approval, with where the funds come from and,
// for a PEP, where their wealth comes from. Until this is recorded the
// customer can't be paid.
export const recordEdd = mutation({
  args: {
    submissionId: v.id("kycSubmissions"),
    edd: eddRecordValidator,
  },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const { submission, profile } = await loadProfile(
      ctx,
      mlro,
      args.submissionId,
    );

    if (!isEddOutstanding(profile)) {
      throw new ConvexError("There is no enhanced due diligence waiting to be recorded.");
    }

    const isPep = profile.pepOutcome === "PEP";
    const record = cleanEddRecord(args.edd, isPep);
    // Same rule the helper applies, kept here so the message names this step.
    const problem = eddRecordProblem({ ...record, isPep });
    if (problem) throw new ConvexError(problem);

    await ctx.db.patch(profile._id, {
      eddCompletedAt: Date.now(),
      eddCompletedBy: mlro._id,
      sourceOfFunds: record.sourceOfFunds,
      sourceOfWealth: record.sourceOfWealth,
      eddNote: record.note,
    });

    await logAction(ctx, {
      actorId: mlro._id,
      action: "EDD_RECORDED",
      kycSubmissionId: submission._id,
      note: record.note,
    });
  },
});
