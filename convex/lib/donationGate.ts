import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// AML policy 5.2: nothing is taken for a campaign that isn't open. Checkout
// used to create a donation for any fundraiser id it was given, including a
// paused, cancelled or rejected fundraiser, or one that doesn't exist.

type FundraiserStatus = Doc<"fundraisers">["status"];

/** Fundraiser statuses that may receive new donations. Everything else is closed. */
export const DONATABLE_STATUSES: ReadonlySet<FundraiserStatus> = new Set([
  "ACTIVE",
]);

// One message for every refusal, and the same one for a fundraiser that
// doesn't exist. A fundraiser that is under review, rejected or paused for a
// compliance reason must not be distinguishable from any other closed one.
export const DONATIONS_CLOSED_MESSAGE =
  "This fundraiser isn't accepting donations.";

export function isAcceptingDonations(
  fundraiser: Pick<Doc<"fundraisers">, "status"> | null,
): boolean {
  return !!fundraiser && DONATABLE_STATUSES.has(fundraiser.status);
}

/**
 * Throws unless the fundraiser exists and is open for donations. Call it from
 * the mutation that creates the pending donation, so the check and the insert
 * happen in one transaction and the status can't change in between.
 */
export async function assertAcceptsDonations(
  ctx: QueryCtx | MutationCtx,
  fundraiserId: Id<"fundraisers">,
): Promise<void> {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!isAcceptingDonations(fundraiser)) {
    throw new ConvexError(DONATIONS_CLOSED_MESSAGE);
  }
}
