// Single source of truth for where a fundraiser's money can be sent (AML policy
// 5.5). Imported by the Convex backend, to enforce it, and by the payouts page
// and the staff review screen, to render it, so they can never drift apart.

import { normalizeKenyanMobile } from "./kyc";

export const PAYOUT_METHODS = ["MPESA", "BANK"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  MPESA: "M-Pesa",
  BANK: "Bank account",
};

// Policy 5.5: payouts go to an account verified as belonging to the verified
// fundraiser or organisation (OWN), or to a verified beneficiary such as a
// hospital or school, with a documented justification (THIRD_PARTY).
export const PAYOUT_HOLDERS = ["OWN", "THIRD_PARTY"] as const;
export type PayoutHolder = (typeof PAYOUT_HOLDERS)[number];

export const PAYOUT_HOLDER_LABELS: Record<PayoutHolder, string> = {
  OWN: "In my name (or my organization's)",
  THIRD_PARTY: "Someone else's, like a hospital or school",
};

export type PayoutAccountStatus =
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "CLOSED";

/** How an account became verified. */
export type PayoutVerifiedVia = "KYC_PHONE" | "STAFF_REVIEW";

/** Accounts that count against the limit: not rejected, not closed. */
export const MAX_OPEN_PAYOUT_ACCOUNTS = 5;

// Policy 5.5: a change of payout details triggers re-verification and a
// temporary hold. The new account has to be verified, and payouts stay paused
// for this long after the change so the real owner has time to notice and
// raise it. Proposed: change it here and nowhere else.
export const PAYOUT_ACCOUNT_CHANGE_HOLD_MS = 72 * 60 * 60 * 1000;

/** When payouts can resume after the payout account was changed at `changedAt`. */
export function payoutChangeHeldUntil(changedAt: number): number {
  return changedAt + PAYOUT_ACCOUNT_CHANGE_HOLD_MS;
}

/** Digits only, spaces and dashes removed. */
export function normalizeBankAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, "");
}
export function isPlausibleBankAccountNumber(normalized: string): boolean {
  return /^\d{6,20}$/.test(normalized);
}

/** All but the last four digits hidden, for lists the owner sees. */
export function maskAccountNumber(normalized: string): string {
  return normalized.length <= 4
    ? "••••"
    : `${"•".repeat(Math.min(normalized.length - 4, 8))}${normalized.slice(-4)}`;
}

/**
 * Whether an M-Pesa account is the mobile number a reviewer already confirmed,
 * at Level 1, is in the fundraiser's own name. That is the one account whose
 * ownership has already been verified, so it needs no further review. Both
 * numbers must be normalized (+254...).
 */
export function isVerifiedKycPhone(
  account: { method: PayoutMethod; holder: PayoutHolder; mpesaNumber?: string },
  verifiedPhone: string | null | undefined,
): boolean {
  return (
    account.method === "MPESA" &&
    account.holder === "OWN" &&
    !!verifiedPhone &&
    !!account.mpesaNumber &&
    normalizeKenyanMobile(account.mpesaNumber) === verifiedPhone
  );
}

// ---- Review ---------------------------------------------------------------

export const PAYOUT_ACCOUNT_REVIEW_CHECKS = [
  "ACCOUNT_NAME_MATCHES",
  "PROOF_GENUINE",
  "BENEFICIARY_JUSTIFIED",
] as const;
export type PayoutAccountReviewCheck =
  (typeof PAYOUT_ACCOUNT_REVIEW_CHECKS)[number];

export const PAYOUT_ACCOUNT_REVIEW_CHECK_LABELS: Record<
  PayoutAccountReviewCheck,
  string
> = {
  ACCOUNT_NAME_MATCHES:
    "The name on the account matches the fundraiser, the organization or the named beneficiary",
  PROOF_GENUINE:
    "The proof shows this account (this number or this account number), is legible and looks genuine",
  BENEFICIARY_JUSTIFIED:
    "The reason for paying someone else is documented and makes sense for the campaign",
};

/** What a reviewer has to confirm, and record, before approving. */
export function requiredPayoutAccountChecks(
  holder: PayoutHolder,
): readonly PayoutAccountReviewCheck[] {
  return holder === "THIRD_PARTY"
    ? ["ACCOUNT_NAME_MATCHES", "PROOF_GENUINE", "BENEFICIARY_JUSTIFIED"]
    : ["ACCOUNT_NAME_MATCHES", "PROOF_GENUINE"];
}

// ---- Proof ----------------------------------------------------------------

/** The one file that backs an account that needs review. */
export const PAYOUT_PROOF_SLOT = {
  label: "Proof of the account",
  description:
    "An M-Pesa statement or confirmation message, a bank statement header or a bank letter, showing the account number and the name on it.",
  maxFiles: 1,
  required: true,
} as const;
