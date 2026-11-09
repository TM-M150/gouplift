import { internal } from "./_generated/api";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Fundraisers closed per run. A full batch schedules the next one straight
// away, so a backlog clears without any single run doing unbounded work.
const BATCH_SIZE = 100;

/**
 * Marks ACTIVE fundraisers whose end date has passed as EXPIRED. Donations
 * already stop at the end date (see donationGate), so this keeps the status,
 * the public lists and the stats honest, and runs hourly from crons.ts.
 *
 * Only ACTIVE ones are touched. A paused fundraiser is on hold for a reason
 * and keeps its status; if it is reopened after its end date, the gate still
 * refuses donations and the next sweep expires it. A payment that was started
 * before the end date and completes after it is still credited: the donor
 * has already paid.
 *
 * Run it by hand with: npx convex run fundraiserExpiry:expireEnded
 */
export const expireEnded = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    // gt(0) leaves out fundraisers with no end date, which an index on an
    // optional field sorts first.
    const ended = await ctx.db
      .query("fundraisers")
      .withIndex("by_status_and_endDate", (q) =>
        q.eq("status", "ACTIVE").gt("endDate", 0).lte("endDate", now),
      )
      .take(BATCH_SIZE);

    for (const fundraiser of ended) {
      await ctx.db.patch(fundraiser._id, {
        status: "EXPIRED",
        // The moment it stopped taking donations, not when the sweep ran.
        closedAt: fundraiser.endDate,
        updatedAt: now,
      });
    }

    if (ended.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.fundraiserExpiry.expireEnded, {});
    }
    return null;
  },
});
