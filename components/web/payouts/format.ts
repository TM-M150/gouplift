import type { PayoutMethod } from "@/lib/payout-accounts";
import { PAYOUT_STATUS_LABELS, type PayoutStatus } from "@/lib/payouts";

/** "M-Pesa +254712345678" or "Equity Bank ••••8901", for lists and menus. */
export function describeAccount(account: {
  method: PayoutMethod;
  mpesaNumber: string | null;
  bankName: string | null;
  bankAccountMasked: string | null;
}): string {
  return account.method === "MPESA"
    ? `M-Pesa ${account.mpesaNumber ?? ""}`.trim()
    : `${account.bankName ?? "Bank"} ${account.bankAccountMasked ?? ""}`.trim();
}

export const ACCOUNT_STATUS_DISPLAY = {
  PENDING_REVIEW: { label: "Under review", variant: "secondary" },
  VERIFIED: { label: "Verified", variant: "default" },
  REJECTED: { label: "Not approved", variant: "destructive" },
  CLOSED: { label: "Removed", variant: "outline" },
} as const;

/** "KES 12,500", or "KES 12,500.75" when there are cents. */
export function formatKes(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** How a payout's status reads, and looks, to the person it is for. */
export const PAYOUT_STATUS_DISPLAY = {
  REQUESTED: { label: PAYOUT_STATUS_LABELS.REQUESTED, variant: "secondary" },
  APPROVED: { label: PAYOUT_STATUS_LABELS.APPROVED, variant: "secondary" },
  PAID: { label: PAYOUT_STATUS_LABELS.PAID, variant: "default" },
  REJECTED: { label: PAYOUT_STATUS_LABELS.REJECTED, variant: "destructive" },
  CANCELLED: { label: PAYOUT_STATUS_LABELS.CANCELLED, variant: "outline" },
  FAILED: { label: PAYOUT_STATUS_LABELS.FAILED, variant: "destructive" },
} as const satisfies Record<
  PayoutStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
>;
