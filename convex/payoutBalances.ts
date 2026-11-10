import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  RESERVING_PAYOUT_STATUSES,
  roundMoney,
  settlesAt,
} from "../lib/payouts";
import { settleDonationBalance } from "./lib/payoutBalance";

// A fundraiser is rebuilt inside one transaction so a donation completing at
// the same moment makes Convex retry this run instead of being overwritten.
// That caps how many donations one run can read, as in reconcileTotals.
const MAX_DONATIONS_PER_FUNDRAISER = 5000;
const MAX_PAYOUTS_PER_FUNDRAISER = 1000;
const FUNDRAISERS_PER_PAGE = 20;

/** Scheduled when a PayPal donation completes: makes it withdrawable. */
export const settleDonation = internalMutation({
  args: { donationId: v.id("donations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await settleDonationBalance(ctx, args.donationId, Date.now());
    return null;
  },
});

const figuresValidator = v.object({
  settledNet: v.number(),
  pendingNet: v.number(),
  reserved: v.number(),
  paid: v.number(),
});

/**
 * Recomputes one fundraiser's balance from its COMPLETED donations and its
 * payouts, which are the record, and fixes the stored figures if they
 * drifted. It is also how balances are first created for donations made
 * before payouts existed: run rebuildAll once after deploying.
 *
 * Try it first without changing anything:
 *   npx convex run payoutBalances:rebuildBalance '{"fundraiserId":"<id>","dryRun":true}'
 */
export const rebuildBalance = internalMutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    outcome: v.union(
      v.literal("missing"),
      v.literal("unchanged"),
      v.literal("corrected"),
      v.literal("would_correct"),
      v.literal("skipped_too_many_records"),
    ),
    before: v.optional(figuresValidator),
    after: v.optional(figuresValidator),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) return { outcome: "missing" as const };

    const donations = await ctx.db
      .query("donations")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "COMPLETED"),
      )
      .take(MAX_DONATIONS_PER_FUNDRAISER + 1);
    const payouts = await ctx.db
      .query("payouts")
      .withIndex("by_fundraiserId_and_requestedAt", (q) =>
        q.eq("fundraiserId", args.fundraiserId),
      )
      .take(MAX_PAYOUTS_PER_FUNDRAISER + 1);

    if (
      donations.length > MAX_DONATIONS_PER_FUNDRAISER ||
      payouts.length > MAX_PAYOUTS_PER_FUNDRAISER
    ) {
      console.warn(
        `[payout balance] ${args.fundraiserId} has too many records to rebuild in one go; left unchanged.`,
      );
      return { outcome: "skipped_too_many_records" as const };
    }

    // Whole cents throughout, so decimal amounts don't pick up float drift.
    let settledCents = 0;
    let pendingCents = 0;
    const toStamp: { id: (typeof donations)[number]["_id"]; at: number }[] = [];
    const toSchedule: { id: (typeof donations)[number]["_id"]; at: number }[] =
      [];
    for (const donation of donations) {
      const cents = Math.round(donation.netAmount * 100);
      const dueAt = settlesAt(
        donation.provider,
        donation.completedAt ?? donation.createdAt,
      );
      if (donation.settledAt !== undefined || dueAt <= now) {
        settledCents += cents;
        if (donation.settledAt === undefined) {
          toStamp.push({ id: donation._id, at: dueAt });
        }
      } else {
        pendingCents += cents;
        toSchedule.push({ id: donation._id, at: dueAt });
      }
    }

    let reservedCents = 0;
    let paidCents = 0;
    for (const payout of payouts) {
      const cents = Math.round(payout.amount * 100);
      if (RESERVING_PAYOUT_STATUSES.includes(payout.status)) {
        reservedCents += cents;
      } else if (payout.status === "PAID") {
        paidCents += cents;
      }
    }

    const row = await ctx.db
      .query("fundraiserBalances")
      .withIndex("by_fundraiserId", (q) => q.eq("fundraiserId", args.fundraiserId))
      .unique();
    const before = {
      settledNet: row?.settledNet ?? 0,
      pendingNet: row?.pendingNet ?? 0,
      reserved: row?.reserved ?? 0,
      paid: row?.paid ?? 0,
    };
    const after = {
      settledNet: settledCents / 100,
      pendingNet: pendingCents / 100,
      reserved: reservedCents / 100,
      paid: paidCents / 100,
    };

    const same = (Object.keys(after) as (keyof typeof after)[]).every(
      (key) => Math.abs(before[key] - after[key]) < 0.005,
    );
    // With no row, "same" means there is nothing to record: a fundraiser with
    // no donations needs no balance.
    if (same && toStamp.length === 0) {
      return { outcome: "unchanged" as const, before, after };
    }

    console.log(
      `[payout balance${dryRun ? " dry-run" : ""}] ${args.fundraiserId}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
    if (dryRun) return { outcome: "would_correct" as const, before, after };

    for (const { id, at } of toStamp) {
      await ctx.db.patch(id, { settledAt: at });
    }
    for (const { id, at } of toSchedule) {
      await ctx.scheduler.runAt(at, internal.payoutBalances.settleDonation, {
        donationId: id,
      });
    }
    const values = {
      settledNet: roundMoney(after.settledNet),
      pendingNet: roundMoney(after.pendingNet),
      reserved: roundMoney(after.reserved),
      paid: roundMoney(after.paid),
      updatedAt: now,
    };
    if (row) {
      await ctx.db.patch(row._id, values);
    } else {
      await ctx.db.insert("fundraiserBalances", {
        fundraiserId: args.fundraiserId,
        ...values,
      });
    }
    return { outcome: "corrected" as const, before, after };
  },
});

/**
 * Runs rebuildBalance for every fundraiser, a page at a time. Each change is
 * written to the function logs.
 *
 *   npx convex run payoutBalances:rebuildAll '{"dryRun":true}'   # report only
 *   npx convex run payoutBalances:rebuildAll                      # apply
 */
export const rebuildAll = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const dryRun = args.dryRun ?? false;

    const page = await ctx.db
      .query("fundraisers")
      .paginate({ cursor: args.cursor ?? null, numItems: FUNDRAISERS_PER_PAGE });

    for (const fundraiser of page.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.payoutBalances.rebuildBalance,
        { fundraiserId: fundraiser._id, dryRun },
      );
    }

    if (page.isDone) {
      console.log(
        `[payout balance${dryRun ? " dry-run" : ""}] every fundraiser has been queued.`,
      );
    } else {
      await ctx.scheduler.runAfter(0, internal.payoutBalances.rebuildAll, {
        cursor: page.continueCursor,
        dryRun,
      });
    }
    return null;
  },
});
