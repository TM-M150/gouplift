import { v } from "convex/values";
import { BENEFICIAL_OWNER_BASES } from "../../lib/beneficial-ownership";
import { ORGANIZATION_REVIEW_CHECKS } from "../../lib/organization-verification";
import { kycIdTypeValidator } from "./kycValidators";
import { literalUnion } from "./organizationValidators";

// Derived from the lists in lib/beneficial-ownership.ts and
// lib/organization-verification.ts, which the forms and review screens also use.
export const beneficialOwnerBasisValidator = literalUnion(
  BENEFICIAL_OWNER_BASES,
);
export const organizationReviewCheckValidator = literalUnion(
  ORGANIZATION_REVIEW_CHECKS,
);

// One person on the register, as it arrives from a form. createOrganization
// and addBeneficialOwner both take this and check it with the zod schema.
export const beneficialOwnerInputValidator = v.object({
  fullName: v.string(),
  idType: kycIdTypeValidator,
  idNumber: v.string(),
  basis: beneficialOwnerBasisValidator,
  ownershipPercent: v.optional(v.number()),
  role: v.optional(v.string()),
  residenceCountry: v.string(),
  pepDeclared: v.boolean(),
});
