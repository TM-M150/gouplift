import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { assessRisk, nextReviewDue } from "../lib/risk";

// Test helper, not a Convex module: the extra dot in the name keeps it out of
// the deploy, the same way *.test.ts files are.

/**
 * Inserts a customer risk profile worked out from its inputs, so a fixture can
 * say "a Kenyan, not a PEP, rated Low" and get a profile that agrees with
 * lib/risk.ts. Pass `edd: true` to have it done, or override any field.
 */
export async function insertRiskProfile(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    kycSubmissionId: Id<"kycSubmissions">;
    ratedBy: Id<"users">;
    now?: number;
  } & Partial<
    Pick<
      Doc<"customerRiskProfiles">,
      | "residenceCountry"
      | "expectedAmountKes"
      | "pepOutcome"
      | "behaviour"
      | "mlroFlagged"
      | "eddCompletedAt"
    >
  >,
) {
  const now = input.now ?? Date.now();
  const inputs = {
    residenceCountry: input.residenceCountry ?? "KE",
    expectedAmountKes: input.expectedAmountKes ?? 50_000,
    pepOutcome: input.pepOutcome ?? ("NOT_PEP" as const),
    behaviour: input.behaviour ?? ("LOW" as const),
    mlroFlagged: input.mlroFlagged ?? false,
  };
  const assessment = assessRisk({ ...inputs, tier: 1 });

  return await ctx.db.insert("customerRiskProfiles", {
    userId: input.userId,
    kycSubmissionId: input.kycSubmissionId,
    ...inputs,
    rating: assessment.rating,
    computedRating: assessment.computedRating,
    factors: assessment.factors,
    eddReasons: assessment.eddReasons,
    ratedAt: now,
    ratedBy: input.ratedBy,
    nextReviewDue: nextReviewDue(assessment.rating, now),
    // Enhanced due diligence is recorded unless the test says otherwise.
    ...(assessment.requiresEdd
      ? {
          eddCompletedAt: input.eddCompletedAt ?? now,
          eddCompletedBy: input.ratedBy,
          sourceOfFunds: "Savings and family contributions",
        }
      : {}),
  });
}
