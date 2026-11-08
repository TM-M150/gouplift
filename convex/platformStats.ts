import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";

// Fundraisers read per run. Each page is its own transaction and the next
// page is scheduled, so no single run reads the whole table.
const PAGE_SIZE = 100;

// Statuses a fundraiser can sit in without ever having been live.
const NEVER_LIVE = new Set(["DRAFT", "PENDING_REVIEW", "REJECTED"]);

const accumulatorValidator = v.object({
  totalRaisedKes: v.number(),
  totalDonations: v.number(),
  fundraisersLaunched: v.number(),
  activeFundraisers: v.number(),
  categoryCounts: v.record(v.string(), v.number()),
});

const publicStatsValidator = v.object({
  totalRaisedKes: v.number(),
  totalDonations: v.number(),
  fundraisersLaunched: v.number(),
  activeFundraisers: v.number(),
  categories: v.array(v.object({ type: v.string(), count: v.number() })),
  updatedAt: v.number(),
});

/**
 * Rebuilds the "global" stats row. Walks the fundraisers table one page at
 * a time, carrying running totals in the arguments of the next scheduled
 * run, and writes the row once the last page is read.
 *
 * Run it by hand with: npx convex run platformStats:refresh
 */
export const refresh = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    accumulator: v.optional(accumulatorValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const acc = args.accumulator ?? {
      totalRaisedKes: 0,
      totalDonations: 0,
      fundraisersLaunched: 0,
      activeFundraisers: 0,
      categoryCounts: {},
    };

    const page = await ctx.db
      .query("fundraisers")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });

    for (const fundraiser of page.page) {
      if (NEVER_LIVE.has(fundraiser.status)) continue;

      acc.fundraisersLaunched += 1;
      acc.totalDonations += fundraiser.donorCount;
      // createFundraiser only ever sets KES; guard anyway so a USD row
      // could never be added to a shilling total.
      if (fundraiser.currency === "KES") {
        acc.totalRaisedKes += fundraiser.amountRaised;
      }

      if (fundraiser.status === "ACTIVE" && !fundraiser.isPrivate) {
        acc.activeFundraisers += 1;
        acc.categoryCounts[fundraiser.type] =
          (acc.categoryCounts[fundraiser.type] ?? 0) + 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.platformStats.refresh, {
        cursor: page.continueCursor,
        accumulator: acc,
      });
      return null;
    }

    const next = {
      key: "global" as const,
      totalRaisedKes: acc.totalRaisedKes,
      totalDonations: acc.totalDonations,
      fundraisersLaunched: acc.fundraisersLaunched,
      activeFundraisers: acc.activeFundraisers,
      categories: Object.entries(acc.categoryCounts).map(([type, count]) => ({
        type,
        count,
      })),
      updatedAt: Date.now(),
    };

    const existing = await ctx.db
      .query("platformStats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (existing) {
      await ctx.db.replace(existing._id, next);
    } else {
      await ctx.db.insert("platformStats", next);
    }

    return null;
  },
});

/**
 * Public, aggregate-only totals for the homepage. Returns null until the
 * first refresh has run, so callers must treat "no stats" as normal.
 */
export const get = query({
  args: {},
  returns: v.union(v.null(), publicStatsValidator),
  handler: async (ctx) => {
    const stats = await ctx.db
      .query("platformStats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    if (!stats) return null;

    return {
      totalRaisedKes: stats.totalRaisedKes,
      totalDonations: stats.totalDonations,
      fundraisersLaunched: stats.fundraisersLaunched,
      activeFundraisers: stats.activeFundraisers,
      categories: [...stats.categories].sort((a, b) => b.count - a.count),
      updatedAt: stats.updatedAt,
    };
  },
});
