import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

const SHARED_LIMIT = 10;
const SHARED_STATUSES = ["VERIFIED", "PENDING_REVIEW", "REJECTED"] as const;

/**
 * Whether an account is one its fundraiser may be paid to: an organization's
 * fundraiser is paid to that organization's accounts, a personal one to the
 * creator's own. A fundraiser is never paid to somebody else's account.
 */
export function payoutAccountBelongsToFundraiser(
  account: Pick<Doc<"payoutAccounts">, "userId" | "organizationId">,
  fundraiser: Pick<Doc<"fundraisers">, "creatorId" | "organizationId">,
): boolean {
  if (fundraiser.organizationId) {
    return account.organizationId === fundraiser.organizationId;
  }
  return !account.organizationId && account.userId === fundraiser.creatorId;
}

/** The account a fundraiser has been set up to be paid to, if any. */
export async function getFundraiserPayoutSelection(
  ctx: Ctx,
  fundraiserId: Id<"fundraisers">,
): Promise<Doc<"fundraiserPayoutAccounts"> | null> {
  return await ctx.db
    .query("fundraiserPayoutAccounts")
    .withIndex("by_fundraiserId", (q) => q.eq("fundraiserId", fundraiserId))
    .unique();
}

/** Whether an account is one whose ownership was ever confirmed. */
export function wasEverVerified(account: Doc<"payoutAccounts">): boolean {
  return account.verifiedVia !== undefined;
}

export type SharedAccountMatch = {
  payoutAccountId: Id<"payoutAccounts">;
  userId: Id<"users">;
  organizationId: Id<"organizations"> | null;
  status: Doc<"payoutAccounts">["status"];
  createdAt: number;
};

// The same M-Pesa number or bank account behind a different owner (policy 10:
// many fundraisers sharing a number or account is a red flag). Only reviewers
// see this; the owner is never told (policy 12.3).
export async function findSharedPayoutAccounts(
  ctx: Ctx,
  account: Doc<"payoutAccounts">,
): Promise<SharedAccountMatch[]> {
  const rows: Doc<"payoutAccounts">[] = [];

  for (const status of SHARED_STATUSES) {
    if (account.mpesaNumber) {
      const mpesaNumber = account.mpesaNumber;
      rows.push(
        ...(await ctx.db
          .query("payoutAccounts")
          .withIndex("by_mpesaNumber_and_status", (q) =>
            q.eq("mpesaNumber", mpesaNumber).eq("status", status),
          )
          .take(SHARED_LIMIT)),
      );
    }
    if (account.bankAccountNumber) {
      const bankAccountNumber = account.bankAccountNumber;
      const bankName = account.bankName?.toLowerCase();
      const sameBank = await ctx.db
        .query("payoutAccounts")
        .withIndex("by_bankAccountNumber_and_status", (q) =>
          q.eq("bankAccountNumber", bankAccountNumber).eq("status", status),
        )
        .take(SHARED_LIMIT);
      // Account numbers are only unique within a bank.
      rows.push(
        ...sameBank.filter((row) => row.bankName?.toLowerCase() === bankName),
      );
    }
  }

  return rows
    .filter(
      (row) =>
        row._id !== account._id &&
        (row.userId !== account.userId ||
          row.organizationId !== account.organizationId),
    )
    .map((row) => ({
      payoutAccountId: row._id,
      userId: row.userId,
      organizationId: row.organizationId ?? null,
      status: row.status,
      createdAt: row.createdAt,
    }));
}
