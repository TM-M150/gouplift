import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// One fundraiser is recomputed inside a single transaction so a donation
// completing at the same moment makes Convex retry this run instead of
// being overwritten. That caps how many donations one run can read.
const MAX_DONATIONS_PER_FUNDRAISER = 5000;

const FUNDRAISERS_PER_PAGE = 20;

const totalsValidator = v.object({
  amountRaised: v.number(),
  donorCount: v.number(),
});

/**
 * Recomputes one fundraiser's `amountRaised` and `donorCount` from its
 * COMPLETED donations (the source of truth: gross KES amount, one count per
 * donation) and fixes the stored figures if they drifted.
 *
 * Try it first without changing anything:
 *   npx convex run reconcileTotals:reconcileFundraiser '{"fundraiserId":"<id>","dryRun":true}'
 *
 * Note: only COMPLETED donations count, so one marked REFUNDED comes off
 * the total.
 */
export const reconcileFundraiser = internalMutation({
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
      v.literal("skipped_too_many_donations"),
    ),
    before: v.optional(totalsValidator),
    after: v.optional(totalsValidator),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) return { outcome: "missing" as const };

    const donations = await ctx.db
      .query("donations")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "COMPLETED"),
      )
      .take(MAX_DONATIONS_PER_FUNDRAISER + 1);

    if (donations.length > MAX_DONATIONS_PER_FUNDRAISER) {
      console.warn(
        `[reconcile] ${args.fundraiserId} has more than ${MAX_DONATIONS_PER_FUNDRAISER} completed donations; left unchanged.`,
      );
      return { outcome: "skipped_too_many_donations" as const };
    }

    // Add in whole cents so decimal amounts don't pick up float drift.
    let cents = 0;
    for (const donation of donations) {
      cents += Math.round(donation.grossAmount * 100);
    }

    const before = {
      amountRaised: fundraiser.amountRaised,
      donorCount: fundraiser.donorCount,
    };
    const after = { amountRaised: cents / 100, donorCount: donations.length };

    const unchanged =
      Math.abs(before.amountRaised - after.amountRaised) < 0.005 &&
      before.donorCount === after.donorCount;
    if (unchanged) return { outcome: "unchanged" as const, before, after };

    console.log(
      `[reconcile${dryRun ? " dry-run" : ""}] ${args.fundraiserId}: amountRaised ${before.amountRaised} -> ${after.amountRaised}, donorCount ${before.donorCount} -> ${after.donorCount}`,
    );

    if (dryRun) return { outcome: "would_correct" as const, before, after };

    // updatedAt is left alone: this isn't an edit by the organizer.
    await ctx.db.patch(args.fundraiserId, after);
    return { outcome: "corrected" as const, before, after };
  },
});

/**
 * Runs reconcileFundraiser for every fundraiser, a page at a time. Each
 * change is written to the function logs (`npx convex logs`, or the
 * dashboard's Logs tab).
 *
 *   npx convex run reconcileTotals:reconcileAll '{"dryRun":true}'   # report only
 *   npx convex run reconcileTotals:reconcileAll                      # apply
 */
export const reconcileAll = internalMutation({
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
        internal.reconcileTotals.reconcileFundraiser,
        { fundraiserId: fundraiser._id, dryRun },
      );
    }

    if (page.isDone) {
      console.log(
        `[reconcile${dryRun ? " dry-run" : ""}] every fundraiser has been queued.`,
      );
    } else {
      await ctx.scheduler.runAfter(0, internal.reconcileTotals.reconcileAll, {
        cursor: page.continueCursor,
        dryRun,
      });
    }

    return null;
  },
});
