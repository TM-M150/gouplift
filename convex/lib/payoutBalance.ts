import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { addMoney, settlesAt } from "../../lib/payouts";

// The running figures behind a fundraiser's withdrawable balance (see the
// fundraiserBalances table). Every change goes through here so the rules live
// in one place, and convex/payoutBalances.ts can rebuild all of it from the
// donations and payouts if a figure ever drifts.

type Ctx = QueryCtx | MutationCtx;

export async function getBalance(
  ctx: Ctx,
  fundraiserId: Id<"fundraisers">,
): Promise<Doc<"fundraiserBalances"> | null> {
  return await ctx.db
    .query("fundraiserBalances")
    .withIndex("by_fundraiserId", (q) => q.eq("fundraiserId", fundraiserId))
    .unique();
}

type Change = Partial<
  Record<"settledNet" | "pendingNet" | "reserved" | "paid", number>
>;

// Adds the changes to the row, creating it on first use. The two figures that
// are only ever sums of positive amounts can't go below zero: if one would, a
// figure has drifted, so it is held at zero and logged for a rebuild to fix.
async function applyChange(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  change: Change,
  now: number,
) {
  const row = await getBalance(ctx, fundraiserId);
  const next = {
    settledNet: addMoney(row?.settledNet ?? 0, change.settledNet ?? 0),
    pendingNet: addMoney(row?.pendingNet ?? 0, change.pendingNet ?? 0),
    reserved: addMoney(row?.reserved ?? 0, change.reserved ?? 0),
    paid: addMoney(row?.paid ?? 0, change.paid ?? 0),
  };
  for (const key of ["pendingNet", "reserved", "paid"] as const) {
    if (next[key] < 0) {
      console.warn(
        `[payout balance] ${fundraiserId}: ${key} would be ${next[key]}; held at 0. Run payoutBalances:rebuildBalance.`,
      );
      next[key] = 0;
    }
  }

  if (row) {
    await ctx.db.patch(row._id, { ...next, updatedAt: now });
  } else {
    await ctx.db.insert("fundraiserBalances", {
      fundraiserId,
      ...next,
      updatedAt: now,
    });
  }
}

/**
 * Adds a completed donation's net amount to its fundraiser's balance. Call it
 * once, right after the donation is marked COMPLETED, from every payment path.
 * Mobile money settles at once; a PayPal donation waits out its delay in
 * pendingNet, and a scheduled job moves it across.
 */
export async function recordCompletedDonation(
  ctx: MutationCtx,
  donationId: Id<"donations">,
  now: number,
) {
  const donation = await ctx.db.get(donationId);
  if (!donation || donation.status !== "COMPLETED") return;
  // Already counted as settled.
  if (donation.settledAt !== undefined) return;

  const dueAt = settlesAt(donation.provider, donation.completedAt ?? now);
  if (dueAt <= now) {
    await ctx.db.patch(donation._id, { settledAt: now });
    await applyChange(
      ctx,
      donation.fundraiserId,
      { settledNet: donation.netAmount },
      now,
    );
    return;
  }

  await applyChange(
    ctx,
    donation.fundraiserId,
    { pendingNet: donation.netAmount },
    now,
  );
  await ctx.scheduler.runAt(dueAt, internal.payoutBalances.settleDonation, {
    donationId: donation._id,
  });
}

/**
 * Moves a donation from pending to withdrawable once its delay is over. Does
 * nothing for one that already settled or is no longer COMPLETED, so it is
 * safe to run twice.
 */
export async function settleDonationBalance(
  ctx: MutationCtx,
  donationId: Id<"donations">,
  now: number,
) {
  const donation = await ctx.db.get(donationId);
  if (!donation || donation.status !== "COMPLETED") return;
  if (donation.settledAt !== undefined) return;

  await ctx.db.patch(donation._id, { settledAt: now });
  await applyChange(
    ctx,
    donation.fundraiserId,
    { pendingNet: -donation.netAmount, settledNet: donation.netAmount },
    now,
  );
}

/**
 * Takes a completed donation back out of the balance. Any path that moves a
 * COMPLETED donation to REFUNDED must call this, with the donation as it was
 * before; convex/lib/refunds.ts is the only one. If the money has already
 * been paid out, settledNet goes negative and the next payouts are held until
 * later donations cover it (availableBalance never shows less than zero).
 */
export async function reverseDonationCredit(
  ctx: MutationCtx,
  donation: Doc<"donations">,
  now: number,
) {
  await applyChange(
    ctx,
    donation.fundraiserId,
    donation.settledAt !== undefined
      ? { settledNet: -donation.netAmount }
      : { pendingNet: -donation.netAmount },
    now,
  );
}

/** Sets an amount aside for a payout that has been asked for. */
export async function reserveForPayout(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  amount: number,
  now: number,
) {
  await applyChange(ctx, fundraiserId, { reserved: amount }, now);
}

/** Puts a reservation back: the payout was rejected, cancelled or failed. */
export async function releaseReservation(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  amount: number,
  now: number,
) {
  await applyChange(ctx, fundraiserId, { reserved: -amount }, now);
}

/** The payout was sent: what was set aside is now paid. */
export async function markReservationPaid(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  amount: number,
  now: number,
) {
  await applyChange(
    ctx,
    fundraiserId,
    { reserved: -amount, paid: amount },
    now,
  );
}
