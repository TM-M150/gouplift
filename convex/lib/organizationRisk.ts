import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  hasNoIdentifiedOwner,
  MAX_BENEFICIAL_OWNERS,
  ownershipProblem,
} from "../../lib/beneficial-ownership";
import {
  assessOrganizationRisk,
  EDD_REASON_LABELS,
  type PepOutcome,
  type RiskAssessment,
  type RiskLevel,
} from "../../lib/risk";
import { logAction } from "./adminAudit";
import { isMlro } from "./mlro";
import {
  assessmentPatch,
  cleanEddRecord,
  describeRating,
  type EddRecordInput,
} from "./riskProfile";

// The risk profile of an organization (AML policy 4.3, 6, 7, 8): how it is
// made when the organization is verified, and how it is worked out again when
// the MLRO changes something. The rules are in lib/risk.ts. The individual
// version of all this is in riskProfile.ts, which this follows closely.

export async function getOrganizationRiskProfile(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationRiskProfiles"> | null> {
  return await ctx.db
    .query("organizationRiskProfiles")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId),
    )
    .first();
}

/** The people on an organization's register. Bounded: the register has a limit. */
export async function listBeneficialOwners(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationBeneficialOwners">[]> {
  return await ctx.db
    .query("organizationBeneficialOwners")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId),
    )
    .take(MAX_BENEFICIAL_OWNERS + 1);
}

/** What an organization declared when it applied, or null if it predates the questions. */
export function readOrganizationDeclarations(
  organization: Pick<
    Doc<"organizations">,
    | "registeredCountry"
    | "expectedAmountKes"
    | "expectedTimeline"
    | "pepDeclared"
    | "pepDetails"
    | "prohibitedActivitiesAcknowledged"
  >,
) {
  if (
    organization.registeredCountry === undefined ||
    organization.expectedAmountKes === undefined ||
    organization.pepDeclared === undefined
  ) {
    return null;
  }
  return {
    registeredCountry: organization.registeredCountry,
    expectedAmountKes: organization.expectedAmountKes,
    expectedTimeline: organization.expectedTimeline ?? null,
    pepDeclared: organization.pepDeclared,
    pepDetails: organization.pepDetails ?? null,
    prohibitedActivitiesAcknowledged:
      organization.prohibitedActivitiesAcknowledged ?? false,
  };
}

/** Whether anyone the organization named, or the organization itself, says they are a PEP. */
export function anyPepDeclared(
  declarations: { pepDeclared: boolean } | null,
  owners: ReadonlyArray<{ pepDeclared: boolean }>,
): boolean {
  return (
    (declarations?.pepDeclared ?? false) || owners.some((o) => o.pepDeclared)
  );
}

/** Works the stored rating out again from the profile's own inputs. */
export function reassessOrganizationProfile(
  profile: Pick<
    Doc<"organizationRiskProfiles">,
    | "expectedAmountKes"
    | "residenceCountry"
    | "pepOutcome"
    | "behaviour"
    | "complexStructure"
    | "highRiskSector"
    | "noOwnerIdentified"
    | "mlroFlagged"
    | "overrideRating"
  >,
  changes: { mlroFlagged?: boolean; overrideRating?: RiskLevel } = {},
): RiskAssessment {
  return assessOrganizationRisk({
    expectedAmountKes: profile.expectedAmountKes,
    residenceCountry: profile.residenceCountry,
    pepOutcome: profile.pepOutcome,
    behaviour: profile.behaviour,
    complexStructure: profile.complexStructure,
    highRiskSector: profile.highRiskSector,
    noOwnerIdentified: profile.noOwnerIdentified,
    mlroFlagged: changes.mlroFlagged ?? profile.mlroFlagged,
    overrideRating: changes.overrideRating ?? profile.overrideRating ?? null,
  });
}

/**
 * Rates an organization for the first time and saves the profile. Whoever
 * calls it has decided the PEP outcome, behaviour and the two structure flags.
 * The register has to be acceptable (policy 6) before anything is rated. If
 * the rating needs enhanced due diligence only the MLRO can go through with
 * it, and has to record the source of funds, and for a PEP the source of
 * wealth, at the same time.
 */
export async function createOrganizationRiskProfile(
  ctx: MutationCtx,
  input: {
    staff: Doc<"users">;
    organizationId: Id<"organizations">;
    registeredCountry: string;
    expectedAmountKes: number;
    pepOutcome: PepOutcome;
    behaviour: RiskLevel;
    complexStructure: boolean;
    highRiskSector: boolean;
    edd?: EddRecordInput;
  },
): Promise<RiskAssessment> {
  const owners = await listBeneficialOwners(ctx, input.organizationId);
  const problem = ownershipProblem(owners);
  if (problem) throw new ConvexError(problem);
  const noOwnerIdentified = hasNoIdentifiedOwner(owners);

  const assessment = assessOrganizationRisk({
    expectedAmountKes: input.expectedAmountKes,
    residenceCountry: input.registeredCountry,
    pepOutcome: input.pepOutcome,
    behaviour: input.behaviour,
    complexStructure: input.complexStructure,
    highRiskSector: input.highRiskSector,
    noOwnerIdentified,
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
    organizationId: input.organizationId,
    residenceCountry: input.registeredCountry,
    expectedAmountKes: input.expectedAmountKes,
    pepOutcome: input.pepOutcome,
    behaviour: input.behaviour,
    complexStructure: input.complexStructure,
    highRiskSector: input.highRiskSector,
    noOwnerIdentified,
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

  // An organization has one profile. Rating it again replaces it rather than
  // leaving two that disagree.
  const existing = await getOrganizationRiskProfile(ctx, input.organizationId);
  if (existing) await ctx.db.replace(existing._id, fields);
  else await ctx.db.insert("organizationRiskProfiles", fields);

  await logAction(ctx, {
    actorId: input.staff._id,
    action: "RISK_RATED",
    organizationId: input.organizationId,
    statusAfter: assessment.rating,
    note: describeRating(assessment),
  });

  return assessment;
}

/**
 * Why this person can't change the organization's register of owners right
 * now, or null if they can. Anyone on staff can while it waits for review. After
 * that it is frozen, except that the MLRO can fill it in for an organization
 * verified before owners were recorded, so it can be rated.
 */
export function ownersLockedReason(
  organization: Pick<Doc<"organizations">, "verificationStatus" | "createdBy">,
  staff: Doc<"users">,
  hasRiskProfile: boolean,
): string | null {
  if (organization.createdBy === staff._id) {
    return "You can't change the owners of an organization you created.";
  }
  if (organization.verificationStatus === "PENDING_REVIEW") return null;
  if (
    organization.verificationStatus === "VERIFIED" &&
    !hasRiskProfile &&
    isMlro(staff)
  ) {
    return null;
  }
  return "The list of owners can't be changed any more.";
}
