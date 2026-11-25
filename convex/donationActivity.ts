import { v } from "convex/values";
import { query } from "./_generated/server";
import { canViewFundraiser } from "./lib/fundraiserAccess";
import {
  latestDonations,
  publicDonorName,
  RECENT_DONATIONS_SHOWN,
  RECENT_DONATIONS_WINDOW,
} from "../lib/donation-activity";

/**
 * What the fundraiser page keeps up to date while it is open: how much has
 * been raised, and the latest few donations. One query for both, so a new
 * donation always arrives together with the total it changed, and the page
 * never shows one without the other.
 *
 * Open to anyone who can see the fundraiser, so each donation is only what a
 * visitor is meant to see: a name (as a comment would show it, or "Anonymous
 * donor"), the amount and when. Never an email, a phone number or a message.
 * Null when the fundraiser can't be seen, as with getFundraiserById.
 */
export const forFundraiser = query({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.union(
    v.null(),
    v.object({
      amountRaised: v.number(),
      goalAmount: v.number(),
      donorCount: v.number(),
      recent: v.array(
        v.object({
          id: v.id("donations"),
          name: v.string(),
          amount: v.number(),
          at: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !(await canViewFundraiser(ctx, fundraiser))) {
      return null;
    }

    const completed = await ctx.db
      .query("donations")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "COMPLETED"),
      )
      .order("desc")
      .take(RECENT_DONATIONS_WINDOW);

    return {
      amountRaised: fundraiser.amountRaised,
      goalAmount: fundraiser.goalAmount,
      donorCount: fundraiser.donorCount,
      recent: latestDonations(completed, RECENT_DONATIONS_SHOWN).map(
        (donation) => ({
          id: donation._id,
          name: publicDonorName(donation),
          amount: donation.grossAmount,
          at: donation.completedAt ?? donation.createdAt,
        }),
      ),
    };
  },
});
