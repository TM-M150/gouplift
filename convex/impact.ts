import { v } from "convex/values";
import { query } from "./_generated/server";
import { getCurrentUserDoc } from "./lib/staff";
import {
  MAX_IMPACT_DONATIONS,
  MAX_IMPACT_FUNDRAISERS,
  tallyImpact,
} from "../lib/impact";

/**
 * The signed-in person's impact, for the Impact tab on their profile: what
 * they gave, what their own fundraisers raised, and how many donations those
 * fundraisers received. See lib/impact.ts for what each figure means.
 *
 * It reads their most recent completed donations and their fundraisers, up to
 * a limit each. Past a limit the figures are a floor, not the whole truth, and
 * `complete` says so, so the tab shows "at least" rather than a wrong total.
 *
 * Only the person's own figures are returned: nothing about the people who
 * gave to their fundraisers.
 */
export const mine = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      givenKes: v.number(),
      raisedKes: v.number(),
      totalKes: v.number(),
      fundraisersSupported: v.number(),
      donationsReceived: v.number(),
      complete: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;

    // One more than the limit, to tell "exactly at the limit" from "more".
    const fundraisers = await ctx.db
      .query("fundraisers")
      .withIndex("by_creatorId", (q) => q.eq("creatorId", user._id))
      .order("desc")
      .take(MAX_IMPACT_FUNDRAISERS + 1);
    const donations = await ctx.db
      .query("donations")
      .withIndex("by_donorUserId_and_status", (q) =>
        q.eq("donorUserId", user._id).eq("status", "COMPLETED"),
      )
      .order("desc")
      .take(MAX_IMPACT_DONATIONS + 1);

    const complete =
      fundraisers.length <= MAX_IMPACT_FUNDRAISERS &&
      donations.length <= MAX_IMPACT_DONATIONS;

    return {
      ...tallyImpact(
        donations.slice(0, MAX_IMPACT_DONATIONS),
        fundraisers.slice(0, MAX_IMPACT_FUNDRAISERS),
      ),
      complete,
    };
  },
});
