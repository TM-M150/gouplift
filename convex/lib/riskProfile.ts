import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { KycTier, RequestableKycTier } from "../../lib/kyc";
import {
  assessRisk,
  EDD_REASON_LABELS,
  eddRecordProblem,
  hasNewEddReason,
  nextReviewDue,
  RISK_LEVEL_LABELS,
  type PepOutcome,
  type RiskAssessment,
  type RiskLevel,
} from "../../lib/risk";
import { cleanNote, logAction } from "./adminAudit";
import { isMlro } from "./mlro";

// The customer risk profile of an individual fundraiser (AML policy 4.3, 7, 8):
// how it is made from a Level 1 approval, and how it is worked out again when
// the MLRO changes something or a higher level is approved. The rules
// themselves are in lib/risk.ts; this is only the part that touches the
// database.

export async function getRiskProfile(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"customerRiskProfiles"> | null> {
  return await ctx.db
    .query("customerRiskProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

/** The tier risk is rated at: Level 2 raises the expected value, Level 1 and 0 don't. */
export function ratingTier(tier: KycTier): RequestableKycTier {
  return tier >= 2 ? 2 : 1;
}

/** What a Level 1 applicant declared, or null for an application made before it was asked. */
export function readDeclarations(
  submission: Pick<
    Doc<"kycSubmissions">,
    | "residenceCountry"
    | "expectedAmountKes"
    | "expectedTimeline"
    | "pepDeclared"
    | "pepDetails"
    | "prohibitedActivitiesAcknowledged"
  >,
) {
  if (
    submission.residenceCountry === undefined ||
    submission.expectedAmountKes === undefined ||
    submission.pepDeclared === undefined
  ) {
    return null;
  }
  return {
    residenceCountry: submission.residenceCountry,
    expectedAmountKes: submission.expectedAmountKes,
    expectedTimeline: submission.expectedTimeline ?? null,
    pepDeclared: submission.pepDeclared,
    pepDetails: submission.pepDetails ?? null,
    prohibitedActivitiesAcknowledged:
      submission.prohibitedActivitiesAcknowledged ?? false,
  };
}

/** Works the stored rating out again from the profile's own inputs. */
export function reassessProfile(
  profile: Pick<
    Doc<"customerRiskProfiles">,
    | "expectedAmountKes"
    | "residenceCountry"
    | "pepOutcome"
    | "behaviour"
    | "mlroFlagged"
    | "overrideRating"
  >,
  tier: KycTier,
  changes: { mlroFlagged?: boolean; overrideRating?: RiskLevel } = {},
): RiskAssessment {
  return assessRisk({
    expectedAmountKes: profile.expectedAmountKes,
    residenceCountry: profile.residenceCountry,
    pepOutcome: profile.pepOutcome,
    behaviour: profile.behaviour,
    tier: ratingTier(tier),
    mlroFlagged: changes.mlroFlagged ?? profile.mlroFlagged,
    overrideRating: changes.overrideRating ?? profile.overrideRating ?? null,
  });
}

/**
 * The fields of a profile that come from an assessment. If the assessment found
 * a reason for enhanced due diligence the earlier record doesn't cover, that
 * record is cleared so it has to be done again.
 */
export function assessmentPatch(
  before: Pick<Doc<"customerRiskProfiles">, "eddReasons"> | null,
  assessment: RiskAssessment,
  actorId: Id<"users">,
  now: number,
) {
  const reopened =
    before !== null && hasNewEddReason(before.eddReasons, assessment.eddReasons);
  return {
    rating: assessment.rating,
    computedRating: assessment.computedRating,
    factors: assessment.factors,
    eddReasons: assessment.eddReasons,
    ratedAt: now,
    ratedBy: actorId,
    nextReviewDue: nextReviewDue(assessment.rating, now),
    ...(reopened
      ? { eddCompletedAt: undefined, eddCompletedBy: undefined }
      : {}),
  };
}

export interface EddRecordInput {
  sourceOfFunds: string;
  sourceOfWealth?: string;
  note?: string;
}

/** Cleans an EDD record and checks it says enough, or throws a message for the MLRO. */
export function cleanEddRecord(input: EddRecordInput | undefined, isPep: boolean) {
  const sourceOfFunds = cleanNote(input?.sourceOfFunds) ?? "";
  const sourceOfWealth = cleanNote(input?.sourceOfWealth);
  const problem = eddRecordProblem({ sourceOfFunds, sourceOfWealth, isPep });
  if (problem) throw new ConvexError(problem);
  return { sourceOfFunds, sourceOfWealth, note: cleanNote(input?.note) };
}

export function describeRating(assessment: RiskAssessment): string {
  const reasons = assessment.eddReasons.map((r) => EDD_REASON_LABELS[r]);
  return reasons.length > 0
    ? `${RISK_LEVEL_LABELS[assessment.rating]} risk. Enhanced due diligence: ${reasons.join("; ")}.`
    : `${RISK_LEVEL_LABELS[assessment.rating]} risk.`;
}

/**
 * Rates a customer for the first time and saves the profile (policy 4.3).
 * Whoever calls it has already decided the customer's PEP status and
 * behaviour. If the rating needs enhanced due diligence (policy 7, 8) only the
 * MLRO can go through with it, and has to record the source of funds, and for
 * a PEP the source of wealth, at the same time.
 */
export async function createRiskProfile(
  ctx: MutationCtx,
  input: {
    staff: Doc<"users">;
    userId: Id<"users">;
    kycSubmissionId: Id<"kycSubmissions">;
    residenceCountry: string;
    expectedAmountKes: number;
    pepOutcome: PepOutcome;
    behaviour: RiskLevel;
    tier: KycTier;
    edd?: EddRecordInput;
  },
): Promise<RiskAssessment> {
  const assessment = assessRisk({
    expectedAmountKes: input.expectedAmountKes,
    residenceCountry: input.residenceCountry,
    pepOutcome: input.pepOutcome,
    behaviour: input.behaviour,
    tier: ratingTier(input.tier),
  });

  let edd: ReturnType<typeof cleanEddRecord> | null = null;
  if (assessment.requiresEdd) {
    if (!isMlro(input.staff)) {
      throw new ConvexError(
        `This needs the MLRO's approval (${assessment.eddReasons
          .map((reason) => EDD_REASON_LABELS[reason])
          .join("; ")}). Pass it to the MLRO.`,
      );
    }
    edd = cleanEddRecord(input.edd, assessment.isPep);
  }

  const now = Date.now();
  const fields = {
    userId: input.userId,
    kycSubmissionId: input.kycSubmissionId,
    residenceCountry: input.residenceCountry,
    expectedAmountKes: input.expectedAmountKes,
    pepOutcome: input.pepOutcome,
    behaviour: input.behaviour,
    mlroFlagged: false,
    ...assessmentPatch(null, assessment, input.staff._id, now),
    ...(edd
      ? {
          eddCompletedAt: now,
          eddCompletedBy: input.staff._id,
          sourceOfFunds: edd.sourceOfFunds,
          sourceOfWealth: edd.sourceOfWealth,
          eddNote: edd.note,
        }
      : {}),
  };

  // A person has one profile. Rating them again replaces it rather than
  // leaving two that disagree.
  const existing = await getRiskProfile(ctx, input.userId);
  if (existing) await ctx.db.replace(existing._id, fields);
  else await ctx.db.insert("customerRiskProfiles", fields);

  await logAction(ctx, {
    actorId: input.staff._id,
    action: "RISK_RATED",
    kycSubmissionId: input.kycSubmissionId,
    statusAfter: assessment.rating,
    note: describeRating(assessment),
  });

  return assessment;
}
