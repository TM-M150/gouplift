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
import { requireMlro } from "./lib/mlro";
import {
  createOrganizationRiskProfile,
  getOrganizationRiskProfile,
  reassessOrganizationProfile,
} from "./lib/organizationRisk";
import {
  assessmentPatch,
  cleanEddRecord,
  describeRating,
} from "./lib/riskProfile";
import {
  eddRecordValidator,
  pepOutcomeValidator,
  riskLevelValidator,
} from "./lib/riskValidators";

// What the MLRO can do to an organization's risk profile (AML policy 4.3, 7,
// 8): rate one verified before risk was rated, overrule the rating, require
// enhanced due diligence, and record it. The counterpart of customerRisk.ts
// for individuals. Every function is the MLRO's alone, and none can be used on
// an organization the MLRO created.

async function loadOrganization(
  ctx: MutationCtx,
  mlro: Doc<"users">,
  organizationId: Id<"organizations">,
) {
  const organization = await ctx.db.get(organizationId);
  if (!organization) throw new ConvexError("Organization not found.");
  if (organization.createdBy === mlro._id) {
    throw new ConvexError(
      "You can't change the risk rating of an organization you created.",
    );
  }
  return organization;
}

async function loadProfile(
  ctx: MutationCtx,
  mlro: Doc<"users">,
  organizationId: Id<"organizations">,
) {
  const organization = await loadOrganization(ctx, mlro, organizationId);
  const profile = await getOrganizationRiskProfile(ctx, organization._id);
  if (!profile) throw new ConvexError("This organization hasn't been rated yet.");
  return { organization, profile };
}

function requireReason(value: string, what: string): string {
  const reason = cleanNote(value);
  if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
    throw new ConvexError(`${what} (at least 10 characters).`);
  }
  return reason;
}

// For an organization verified before risk was rated. The MLRO says what it
// would have declared, after filling in its owners from the registry documents
// (addBeneficialOwner), and the rest follows the same path as a verification.
export const rateOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    registeredCountry: v.string(),
    expectedAmountKes: v.number(),
    pepOutcome: pepOutcomeValidator,
    behaviour: riskLevelValidator,
    complexStructure: v.boolean(),
    highRiskSector: v.boolean(),
    edd: v.optional(eddRecordValidator),
  },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const organization = await loadOrganization(
      ctx,
      mlro,
      args.organizationId,
    );

    if (organization.verificationStatus !== "VERIFIED") {
      throw new ConvexError("Only a verified organization can be rated.");
    }
    if (await getOrganizationRiskProfile(ctx, organization._id)) {
      throw new ConvexError("This organization has already been rated.");
    }

    const registeredCountry = args.registeredCountry.trim().toUpperCase();
    if (!isCountryCode(registeredCountry)) {
      throw new ConvexError("Choose the country it is registered in.");
    }
    if (
      !Number.isInteger(args.expectedAmountKes) ||
      args.expectedAmountKes < 1 ||
      args.expectedAmountKes > MAX_EXPECTED_AMOUNT_KES
    ) {
      throw new ConvexError(
        "Enter the amount it expects to raise, in whole shillings.",
      );
    }

    await createOrganizationRiskProfile(ctx, {
      staff: mlro,
      organizationId: organization._id,
      registeredCountry,
      expectedAmountKes: args.expectedAmountKes,
      pepOutcome: args.pepOutcome,
      behaviour: args.behaviour,
      complexStructure: args.complexStructure,
      highRiskSector: args.highRiskSector,
      edd: args.edd,
    });
  },
});

// Policy 4.3 says the highest factor sets the rating. The MLRO can still set
// it higher or lower after looking at the whole picture, and says why. An
// organization with a PEP is always High (policy 7.2).
export const overrideOrganizationRisk = mutation({
  args: {
    organizationId: v.id("organizations"),
    rating: riskLevelValidator,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const { organization, profile } = await loadProfile(
      ctx,
      mlro,
      args.organizationId,
    );
    const reason = requireReason(args.reason, "Say why you are changing the rating");

    if (profile.pepOutcome === "PEP" && args.rating !== "HIGH") {
      throw new ConvexError("An organization with a PEP is always High risk.");
    }
    if (args.rating === profile.rating) {
      throw new ConvexError(`It is already rated ${RISK_LEVEL_LABELS[args.rating]}.`);
    }

    const assessment = reassessOrganizationProfile(profile, {
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
      organizationId: organization._id,
      statusBefore: profile.rating,
      statusAfter: assessment.rating,
      note: `${reason} ${describeRating(assessment)}`,
    });
  },
});

// Policy 8.1: the MLRO can require enhanced due diligence whatever the rating
// says. Payouts stop until it is recorded.
export const flagOrganizationForEdd = mutation({
  args: { organizationId: v.id("organizations"), reason: v.string() },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const { organization, profile } = await loadProfile(
      ctx,
      mlro,
      args.organizationId,
    );
    const reason = requireReason(args.reason, "Say why it needs enhanced due diligence");

    if (profile.mlroFlagged) {
      throw new ConvexError("It is already flagged for enhanced due diligence.");
    }

    const assessment = reassessOrganizationProfile(profile, {
      mlroFlagged: true,
    });
    await ctx.db.patch(profile._id, {
      ...assessmentPatch(profile, assessment, mlro._id, Date.now()),
      mlroFlagged: true,
    });

    await logAction(ctx, {
      actorId: mlro._id,
      action: "EDD_FLAGGED",
      organizationId: organization._id,
      statusBefore: profile.rating,
      statusAfter: assessment.rating,
      note: reason,
    });
  },
});

// Policy 7.2 and 8.2: the MLRO's approval, with where the funds come from and,
// where a PEP is involved, where their wealth comes from. Until this is
// recorded the organization can't be paid.
export const recordOrganizationEdd = mutation({
  args: { organizationId: v.id("organizations"), edd: eddRecordValidator },
  handler: async (ctx, args) => {
    const mlro = await requireMlro(ctx);
    const { organization, profile } = await loadProfile(
      ctx,
      mlro,
      args.organizationId,
    );

    if (!isEddOutstanding(profile)) {
      throw new ConvexError(
        "There is no enhanced due diligence waiting to be recorded.",
      );
    }

    const isPep = profile.pepOutcome === "PEP";
    const record = cleanEddRecord(args.edd, isPep);
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
      organizationId: organization._id,
      note: record.note,
    });
  },
});
