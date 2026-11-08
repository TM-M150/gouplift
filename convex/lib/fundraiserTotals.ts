import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Credits one completed donation to its fundraiser.
 *
 * Every payment path (SasaPay, PayPal one-off, PayPal subscription) must go
 * through here so the rule lives in one place:
 *
 * - `amountRaised` grows by the donation's gross KES amount: what the donor
 *   paid, before the platform fee. The fee comes out at payout time, not
 *   here, so a KES 1,000 gift always counts as KES 1,000 whichever way it
 *   was paid.
 * - `donorCount` grows by one. Despite its name it counts completed
 *   donations, not unique donors, because anonymous and guest donors can't
 *   be told apart.
 *
 * Callers are responsible for being idempotent (not crediting the same
 * donation twice).
 */
export async function creditCompletedDonation(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  grossAmountKes: number,
  now: number,
) {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!fundraiser) return;

  await ctx.db.patch(fundraiserId, {
    amountRaised: fundraiser.amountRaised + grossAmountKes,
    donorCount: fundraiser.donorCount + 1,
    updatedAt: now,
  });
}
