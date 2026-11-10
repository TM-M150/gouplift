import type { Doc } from "../_generated/dataModel";
import { maskAccountNumber, PAYOUT_METHOD_LABELS } from "../../lib/payout-accounts";
import type { PayoutBlocker, PayoutBlockerCode } from "./payoutEligibility";

/** Where a payout goes, as shown back to the owner and recorded on the payout. */
export function describeDestination(account: Doc<"payoutAccounts">): string {
  const identifier = account.mpesaNumber
    ? account.mpesaNumber
    : `${account.bankName ?? "Bank"} ${maskAccountNumber(account.bankAccountNumber ?? "")}`;
  return `${PAYOUT_METHOD_LABELS[account.method]} ${identifier}`.trim();
}

// What an owner may be told about why they can't withdraw. A hold, a missing
// risk rating or enhanced due diligence must never be explained to them
// (policy 12.3, no tipping off), so those all read the same.
const OWNER_MESSAGES: Partial<Record<PayoutBlockerCode, string>> = {
  OWNER_NOT_VERIFIED: "Verify your identity before you withdraw.",
  ORGANIZATION_NOT_VERIFIED:
    "Your organization has to be verified before it can withdraw.",
  PAYOUT_ACCOUNT_MISSING: "Choose where this fundraiser is paid first.",
  PAYOUT_ACCOUNT_NOT_VERIFIED:
    "The payout account you chose is still being verified.",
  PAYOUT_ACCOUNT_MISMATCH: "Choose one of your own verified payout accounts.",
  PAYOUT_ACCOUNT_RECENTLY_CHANGED:
    "You changed the payout account recently, so withdrawals are paused for a while.",
  FUNDRAISER_STATUS: "This fundraiser can't be paid out right now.",
};

export const GENERIC_PAYOUT_BLOCKED_MESSAGE =
  "We can't process a withdrawal for this fundraiser right now. Please try again later.";

/** The one message an owner sees for a set of blockers. Empty means none. */
export function ownerSafePayoutMessage(
  blockers: readonly PayoutBlocker[],
): string | null {
  if (blockers.length === 0) return null;
  for (const blocker of blockers) {
    const message = OWNER_MESSAGES[blocker.code];
    if (message) return message;
  }
  return GENERIC_PAYOUT_BLOCKED_MESSAGE;
}

/** What the owner sees of a payout: nothing staff wrote for themselves. */
export function toOwnerPayoutView(payout: Doc<"payouts">) {
  const paid = payout.status === "PAID";
  return {
    _id: payout._id,
    amount: payout.amount,
    status: payout.status,
    destination: payout.destination,
    requestedAt: payout.requestedAt,
    paidAt: paid ? (payout.paidAt ?? null) : null,
    providerReference: paid ? (payout.providerReference ?? null) : null,
    transferFeeAmount: paid ? (payout.transferFeeAmount ?? 0) : null,
    // What reached the fundraiser: the payout less the transfer charge.
    received: paid
      ? Math.round((payout.amount - (payout.transferFeeAmount ?? 0)) * 100) / 100
      : null,
    rejectionReason:
      payout.status === "REJECTED" ? (payout.rejectionReason ?? null) : null,
  };
}
