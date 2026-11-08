import type { PayoutMethod } from "@/lib/payout-accounts";

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
