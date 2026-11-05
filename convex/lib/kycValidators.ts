import { v } from "convex/values";
import {
  KYC_DOCUMENT_TYPES,
  KYC_ID_TYPES,
  KYC_REVIEW_CHECKS,
} from "../../lib/kyc";
import { literalUnion } from "./organizationValidators";

// Derived from the lists in lib/kyc.ts, which the form and review screen also
// use, so adding a document type or a review check there is all it takes.
export const kycIdTypeValidator = literalUnion(KYC_ID_TYPES);
export const kycDocumentTypeValidator = literalUnion(KYC_DOCUMENT_TYPES);
export const kycReviewCheckValidator = literalUnion(KYC_REVIEW_CHECKS);

export const kycRequestedTierValidator = v.union(v.literal(1), v.literal(2));
export const kycSubmissionStatusValidator = v.union(
  v.literal("PENDING_REVIEW"),
  v.literal("APPROVED"),
  v.literal("REJECTED"),
);
