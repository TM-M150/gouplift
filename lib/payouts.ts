// Single source of truth for how money leaves a fundraiser. Imported by the
// Convex payout code, to enforce it, and by the payout screens, to show it, so
// the two can never drift apart. Who may be paid at all is decided by
// convex/lib/payoutEligibility.ts; where it goes by lib/payout-accounts.ts.

import { tierPayoutLimitKes, type KycTier } from "./kyc";

export const PAYOUT_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "PAID",
  "REJECTED",
  "CANCELLED",
  "FAILED",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Money set aside for a payout that hasn't been sent. */
export const RESERVING_PAYOUT_STATUSES: readonly PayoutStatus[] = [
  "REQUESTED",
  "APPROVED",
];

/** Payouts that count against a person's verification-level limit. */
export const LIMIT_COUNTING_PAYOUT_STATUSES: readonly PayoutStatus[] = [
  "REQUESTED",
  "APPROVED",
  "PAID",
];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  REQUESTED: "Waiting for review",
  APPROVED: "Approved, being sent",
  PAID: "Paid",
  REJECTED: "Not approved",
  CANCELLED: "Cancelled",
  FAILED: "Couldn't be sent",
};

/** The smallest payout. Matches the Terms (3.2 and 3.5). */
export const MIN_PAYOUT_KES = 250;

// A mobile-money payment can't be taken back once it completes, but a PayPal
// one can be disputed. Those donations only count as withdrawable after this
// long. Proposed: change it here and nowhere else.
export const PAYPAL_SETTLEMENT_DELAY_DAYS = 3;
export const PAYPAL_SETTLEMENT_DELAY_MS =
  PAYPAL_SETTLEMENT_DELAY_DAYS * 24 * 60 * 60 * 1000;

/** The longest a payout reference can be. */
export const MAX_PAYOUT_REFERENCE_LENGTH = 100;
export const MIN_PAYOUT_REFERENCE_LENGTH = 3;

/** Rounds to whole cents, so repeated additions don't pick up float drift. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function addMoney(a: number, b: number): number {
  return roundMoney(a + b);
}

interface BalanceFigures {
  settledNet: number;
  reserved: number;
  paid: number;
}

/** What has settled and hasn't been asked for or sent. Can't be below zero here. */
export function availableBalance(balance: BalanceFigures | null): number {
  if (!balance) return 0;
  return Math.max(
    0,
    roundMoney(balance.settledNet - balance.reserved - balance.paid),
  );
}

/**
 * How far below zero the balance is: money that was paid out and has since
 * been refunded by a donor's payment being taken back. Nothing is withdrawable
 * until later donations have covered it. Zero for any balance that isn't short.
 */
export function balanceShortfall(balance: BalanceFigures | null): number {
  if (!balance) return 0;
  return Math.max(
    0,
    roundMoney(balance.reserved + balance.paid - balance.settledNet),
  );
}

/** The most that can be requested: whole shillings, as M-Pesa sends. */
export function withdrawableKes(available: number): number {
  return Math.floor(available);
}

/**
 * When a completed donation becomes withdrawable. Everything but PayPal
 * settles at once; a donation from before provider was recorded was SasaPay.
 */
export function settlesAt(
  provider: "SASAPAY" | "PAYPAL" | undefined,
  completedAt: number,
): number {
  return provider === "PAYPAL"
    ? completedAt + PAYPAL_SETTLEMENT_DELAY_MS
    : completedAt;
}

/**
 * How much more an individual can be paid at their verification level, given
 * what they have already been paid or asked for. Infinite above Level 2, where
 * the limit is a case-by-case approval rather than a cap.
 */
export function tierRemainingKes(tier: KycTier, committedKes: number): number {
  const limit = tierPayoutLimitKes(tier);
  if (limit === Number.POSITIVE_INFINITY) return limit;
  return Math.max(0, limit - committedKes);
}

/**
 * Whether a payout takes an individual past the Level 2 limit, which needs the
 * MLRO's approval on the record (policy 5.3). Only possible above Level 2.
 */
export function needsEnhancedApproval(
  tier: KycTier,
  committedAfterKes: number,
): boolean {
  return tier >= 3 && committedAfterKes > tierPayoutLimitKes(2);
}

/** Why an amount can't be requested, or null when it can. */
export function payoutAmountProblem(
  amount: number,
  withdrawable: number,
): string | null {
  if (!Number.isInteger(amount) || amount <= 0) {
    return "Enter a whole number of shillings.";
  }
  if (amount < MIN_PAYOUT_KES) {
    return `The smallest payout is KES ${MIN_PAYOUT_KES.toLocaleString("en-KE")}.`;
  }
  if (amount > withdrawable) {
    return withdrawable < MIN_PAYOUT_KES
      ? "There isn't enough available to withdraw yet."
      : `You can withdraw up to KES ${withdrawable.toLocaleString("en-KE")} right now.`;
  }
  return null;
}
