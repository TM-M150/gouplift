import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { hasEnded } from "../../lib/fundraiser-dates";
import type { MutationCtx } from "../_generated/server";

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

/**
 * Open means an ACTIVE status, an end date that hasn't passed, and not
 * suspended. The date is checked here as well as by the hourly sweep that
 * marks the fundraiser EXPIRED, so donations stop at the end date and not up
 * to an hour later. A suspended fundraiser (taken down while staff look into
 * a report) takes no new donations, and says no more about why than any
 * other closed one.
 */
export function isAcceptingDonations(
  fundraiser: Pick<
    Doc<"fundraisers">,
    "status" | "endDate" | "isFlagged"
  > | null,
  now: number = Date.now(),
): boolean {
  if (!fundraiser || !DONATABLE_STATUSES.has(fundraiser.status)) return false;
  if (fundraiser.isFlagged === true) return false;
  return !hasEnded(fundraiser.endDate, now);
}

/**
 * Throws unless the fundraiser exists and is open for donations. Call it from
 * the mutation that creates the pending donation, so the check and the insert
 * happen in one transaction and the status can't change in between. It reads
 * the clock, so it is for mutations only.
 */
export async function assertAcceptsDonations(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
): Promise<void> {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!isAcceptingDonations(fundraiser)) {
    throw new ConvexError(DONATIONS_CLOSED_MESSAGE);
  }
}
