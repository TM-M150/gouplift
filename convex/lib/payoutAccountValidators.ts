import { v } from "convex/values";
import {
  PAYOUT_ACCOUNT_REVIEW_CHECKS,
  PAYOUT_HOLDERS,
  PAYOUT_METHODS,
} from "../../lib/payout-accounts";
import { literalUnion } from "./organizationValidators";

// Derived from the lists in lib/payout-accounts.ts, which the form and review
// screen also use, so adding a method or a check there is all it takes.
export const payoutMethodValidator = literalUnion(PAYOUT_METHODS);
export const payoutHolderValidator = literalUnion(PAYOUT_HOLDERS);
export const payoutAccountReviewCheckValidator = literalUnion(
  PAYOUT_ACCOUNT_REVIEW_CHECKS,
);

export const payoutAccountStatusValidator = v.union(
  v.literal("PENDING_REVIEW"),
  v.literal("VERIFIED"),
  v.literal("REJECTED"),
  v.literal("CLOSED"),
);
export const payoutVerifiedViaValidator = v.union(
  v.literal("KYC_PHONE"),
  v.literal("STAFF_REVIEW"),
);
