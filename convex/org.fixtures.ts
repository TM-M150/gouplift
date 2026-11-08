import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { assessOrganizationRisk, nextReviewDue } from "../lib/risk";

// Test helper, not a Convex module: the extra dot in the name keeps it out of
// the deploy, the same way *.test.ts files are.

/** One person who owns most of an organization, as a form would send them. */
export const OWNER_MAJORITY = {
  fullName: "Wanjiru Kamau",
  idType: "NATIONAL_ID" as const,
  idNumber: "23456789",
  basis: "OWNERSHIP" as const,
  ownershipPercent: 60,
  role: "Chairperson",
  residenceCountry: "KE",
  pepDeclared: false,
};

/** A second owner, so the shares can be made to add up. */
export const OWNER_MINORITY = {
  fullName: "Otieno Odhiambo",
  idType: "NATIONAL_ID" as const,
  idNumber: "34567890",
  basis: "OWNERSHIP" as const,
  ownershipPercent: 40,
  role: "Treasurer",
  residenceCountry: "KE",
  pepDeclared: false,
};

/** What an organization declares at creation, apart from its name and documents. */
export const ORG_DECLARATIONS = {
  registeredCountry: "KE",
  expectedAmountKes: 500_000,
  expectedTimeline: "SIX_TO_12_MONTHS" as const,
  beneficialOwners: [OWNER_MAJORITY, OWNER_MINORITY],
  pepDeclared: false,
  prohibitedActivitiesAcknowledged: true,
};

/**
 * Inserts an organization risk profile worked out from its inputs, so a fixture
 * can say "registered in Kenya, not a PEP, rated Medium" and get a profile
 * that agrees with lib/risk.ts. EDD is recorded unless the test says otherwise.
 */
export async function insertOrgRiskProfile(
  ctx: MutationCtx,
  input: {
    organizationId: Id<"organizations">;
    ratedBy: Id<"users">;
    now?: number;
  } & Partial<
    Pick<
      Doc<"organizationRiskProfiles">,
      | "residenceCountry"
      | "expectedAmountKes"
      | "pepOutcome"
      | "behaviour"
      | "complexStructure"
      | "highRiskSector"
      | "noOwnerIdentified"
      | "mlroFlagged"
      | "eddCompletedAt"
    >
  >,
) {
  const now = input.now ?? Date.now();
  const inputs = {
    residenceCountry: input.residenceCountry ?? "KE",
    expectedAmountKes: input.expectedAmountKes ?? 500_000,
    pepOutcome: input.pepOutcome ?? ("NOT_PEP" as const),
    behaviour: input.behaviour ?? ("LOW" as const),
    complexStructure: input.complexStructure ?? false,
    highRiskSector: input.highRiskSector ?? false,
    noOwnerIdentified: input.noOwnerIdentified ?? false,
    mlroFlagged: input.mlroFlagged ?? false,
  };
  const assessment = assessOrganizationRisk(inputs);

  return await ctx.db.insert("organizationRiskProfiles", {
    organizationId: input.organizationId,
    ...inputs,
    rating: assessment.rating,
    computedRating: assessment.computedRating,
    factors: assessment.factors,
    eddReasons: assessment.eddReasons,
    ratedAt: now,
    ratedBy: input.ratedBy,
    nextReviewDue: nextReviewDue(assessment.rating, now),
    ...(assessment.requiresEdd
      ? {
          eddCompletedAt: input.eddCompletedAt ?? now,
          eddCompletedBy: input.ratedBy,
          sourceOfFunds: "Member contributions and a county grant",
        }
      : {}),
  });
}
