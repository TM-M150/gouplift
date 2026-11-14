import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { reverseCompletedDonation } from "./fundraiserTotals";
import { reverseDonationCredit } from "./payoutBalance";

// The one way a donation becomes REFUNDED. Staff recording a refund they sent
// by hand and PayPal telling us it refunded or reversed a payment both come
// through here, so the effects can't differ between them:
//
//  - the donation is marked REFUNDED, with when, why and who;
//  - its net amount comes out of the fundraiser's balance (pending if it had
//    not settled yet, settled if it had; if it was already paid out the
//    balance goes negative and the next payouts are held);
//  - the fundraiser's amount raised and donation count come back down;
//  - organizations with webhooks are told (donation.refunded), as a separate
//    scheduled step so webhooks can never undo or delay the refund.
//
// Testimonials need nothing here: the public list and the review queue both
// check the donation is still COMPLETED, so one comes down by itself.
//
// payoutStatus is left alone. It says whether the donation was swept into a
// payout, and a refund doesn't change that; it is the balance that holds the
// shortfall.

export type RefundSource = "STAFF" | "PAYPAL";

export type RefundOutcome =
  | { outcome: "refunded"; donationId: Id<"donations"> }
  // Redelivered notification, or two people clicking: nothing to do.
  | { outcome: "already_refunded"; donationId: Id<"donations"> }
  // Never completed (or was never paid), so there is no money to take back.
  | {
      outcome: "not_completed";
      donationId: Id<"donations">;
      status: Doc<"donations">["status"];
    };

export async function refundCompletedDonation(
  ctx: MutationCtx,
  args: {
    donationId: Id<"donations">;
    source: RefundSource;
    reason: string;
    providerRefundId?: string;
  },
): Promise<RefundOutcome> {
  const donation = await ctx.db.get(args.donationId);
  if (!donation) throw new Error(`Donation ${args.donationId} not found.`);

  if (donation.status === "REFUNDED") {
    return { outcome: "already_refunded", donationId: donation._id };
  }
  if (donation.status !== "COMPLETED") {
    return {
      outcome: "not_completed",
      donationId: donation._id,
      status: donation.status,
    };
  }

  const now = Date.now();

  // The balance is reversed with the donation as it is now: whether it has
  // settled decides which figure the money comes out of.
  await reverseDonationCredit(ctx, donation, now);
  await reverseCompletedDonation(
    ctx,
    donation.fundraiserId,
    donation.grossAmount,
    now,
  );

  await ctx.db.patch(donation._id, {
    status: "REFUNDED",
    refundedAt: now,
    refundReason: args.reason,
    refundSource: args.source,
    refundProviderId: args.providerRefundId,
    updatedAt: now,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.webhookDelivery.enqueueDonationRefunded,
    { donationId: donation._id },
  );

  return { outcome: "refunded", donationId: donation._id };
}
