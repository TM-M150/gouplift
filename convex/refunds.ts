import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import {
  isPayPalRefundEvent,
  parsePayPalRefund,
  refundCoversWholeDonation,
  type ParsedPayPalRefund,
} from "./lib/paypalRefunds";
import { refundCompletedDonation } from "./lib/refunds";
import { getCurrentUserDoc, requireAdmin } from "./lib/staff";
import { getBalance } from "./lib/payoutBalance";
import { balanceShortfall } from "../lib/payouts";

// Recording that a donation was refunded or reversed. The money itself is
// sent back outside GoUplift (M-Pesa or SasaPay by hand, PayPal from the
// PayPal dashboard); this is where the platform's books catch up, through
// refundCompletedDonation, which is the only code that changes a donation to
// REFUNDED.

/** Staff recording a refund they have sent. Admins only: it moves money. */
export const refundDonation = mutation({
  args: {
    donationId: v.id("donations"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        `Say why it is being refunded, in at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
      );
    }

    const result = await refundCompletedDonation(ctx, {
      donationId: args.donationId,
      source: "STAFF",
      reason,
    });
    if (result.outcome === "already_refunded") {
      throw new ConvexError("This donation has already been refunded.");
    }
    if (result.outcome === "not_completed") {
      throw new ConvexError(
        "Only a completed donation can be refunded. This one never was.",
      );
    }

    const donation = await ctx.db.get(args.donationId);
    const fundraiser = donation
      ? await ctx.db.get(donation.fundraiserId)
      : null;
    await logAction(ctx, {
      actorId: admin._id,
      action: "DONATION_REFUNDED",
      fundraiserId: donation?.fundraiserId,
      organizationId: fundraiser?.organizationId,
      donationId: args.donationId,
      statusBefore: "COMPLETED",
      statusAfter: "REFUNDED",
      note: reason,
    });
    return null;
  },
});

const REASONS: Record<ParsedPayPalRefund["kind"], string> = {
  REFUND: "PayPal refunded this payment.",
  REVERSAL: "PayPal reversed this payment (a dispute or chargeback).",
};

/**
 * PayPal telling us it refunded or reversed a payment. Returns what became of
 * it so the webhook can answer PayPal: `not_found` is answered with an error
 * so PayPal sends it again (the refund can arrive before the payment's own
 * notification) and so a refund we can never match shows up in PayPal's
 * failed-delivery list instead of vanishing.
 */
export const applyPayPalRefund = internalMutation({
  args: {
    eventType: v.string(),
    resource: v.any(),
  },
  returns: v.union(
    v.literal("refunded"),
    v.literal("already_refunded"),
    v.literal("not_completed"),
    v.literal("partial_or_unclear"),
    v.literal("not_found"),
    v.literal("not_a_refund"),
  ),
  handler: async (ctx, args) => {
    if (!isPayPalRefundEvent(args.eventType)) return "not_a_refund";
    const refund = parsePayPalRefund(args.eventType, args.resource);

    let donation = null;
    for (const paymentId of refund.paymentIds) {
      donation = await ctx.db
        .query("donations")
        .withIndex("by_paypalCaptureId", (q) =>
          q.eq("paypalCaptureId", paymentId),
        )
        .first();
      if (donation) break;
    }
    // One-off donations made before the capture id was stored on them are
    // found through their checkout order.
    if (!donation && refund.orderId) {
      donation = await ctx.db
        .query("donations")
        .withIndex("by_checkoutRequestId", (q) =>
          q.eq("checkoutRequestId", refund.orderId!),
        )
        .first();
    }
    if (!donation) {
      console.error(
        `[refund] PayPal ${args.eventType} matched no donation (ids: ${refund.paymentIds.join(", ") || "none"}, order: ${refund.orderId ?? "none"}).`,
      );
      return "not_found";
    }

    if (donation.status === "REFUNDED") return "already_refunded";

    if (!refundCoversWholeDonation(donation, refund)) {
      console.error(
        `[refund] PayPal ${args.eventType} for donation ${donation._id} is not clearly the whole payment (${refund.amount} ${refund.currency} against ${donation.originalAmount ?? donation.grossAmount} ${donation.originalCurrency ?? donation.currency}). Not applied: check it in PayPal, and refund the donation by hand if it was the whole amount.`,
      );
      return "partial_or_unclear";
    }

    const result = await refundCompletedDonation(ctx, {
      donationId: donation._id,
      source: "PAYPAL",
      reason: REASONS[refund.kind],
      providerRefundId: refund.providerRefundId ?? undefined,
    });
    if (result.outcome === "not_completed") {
      console.error(
        `[refund] PayPal ${args.eventType} for donation ${donation._id}, which is ${result.status}, not completed.`,
      );
      return "not_completed";
    }
    return result.outcome;
  },
});

// ---- The staff screen ---------------------------------------------------

const LIST_LIMIT = 100;

/** The id from what staff paste: a fundraiser's link, or the id itself. */
function fundraiserIdFrom(text: string): string {
  const cleaned = text.trim().split(/[?#]/)[0].replace(/\/+$/, "");
  return cleaned.slice(cleaned.lastIndexOf("/") + 1);
}

/**
 * A fundraiser's latest completed and refunded donations, for finding the one
 * to refund. Admins only, and quietly nothing for anyone else. Includes how to
 * reach the donor, because the refund is sent by hand and staff need that.
 * Null when the link or id doesn't match a fundraiser.
 */
export const listDonationsForRefund = query({
  args: { fundraiser: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (user?.role !== "ADMIN") return null;

    const fundraiserId = ctx.db.normalizeId(
      "fundraisers",
      fundraiserIdFrom(args.fundraiser),
    );
    const fundraiser = fundraiserId ? await ctx.db.get(fundraiserId) : null;
    if (!fundraiser) return null;

    const [completed, refunded, balance, organization] = await Promise.all([
      ctx.db
        .query("donations")
        .withIndex("by_fundraiserId_and_status", (q) =>
          q.eq("fundraiserId", fundraiser._id).eq("status", "COMPLETED"),
        )
        .order("desc")
        .take(LIST_LIMIT),
      ctx.db
        .query("donations")
        .withIndex("by_fundraiserId_and_status", (q) =>
          q.eq("fundraiserId", fundraiser._id).eq("status", "REFUNDED"),
        )
        .order("desc")
        .take(LIST_LIMIT),
      getBalance(ctx, fundraiser._id),
      fundraiser.organizationId ? ctx.db.get(fundraiser.organizationId) : null,
    ]);

    const donations = [...completed, ...refunded]
      .sort(
        (a, b) =>
          (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
      )
      .map((donation) => ({
        _id: donation._id,
        status: donation.status,
        provider: donation.provider ?? "SASAPAY",
        // What the donor paid: the KES amount, and the USD one for PayPal.
        grossAmount: donation.grossAmount,
        originalAmount: donation.originalAmount ?? null,
        originalCurrency: donation.originalCurrency ?? null,
        netAmount: donation.netAmount,
        donorName: donation.donorName ?? null,
        isAnonymous: donation.isAnonymous,
        donorEmail: donation.donorEmail ?? null,
        donorPhone: donation.donorPhone ?? null,
        reference:
          donation.providerTransactionCode ?? donation.paypalCaptureId ?? null,
        completedAt: donation.completedAt ?? donation.createdAt,
        refundedAt: donation.refundedAt ?? null,
        refundReason: donation.refundReason ?? null,
        refundSource: donation.refundSource ?? null,
      }));

    return {
      fundraiser: {
        _id: fundraiser._id,
        title: fundraiser.title,
        organizationName: organization?.name ?? null,
        amountRaised: fundraiser.amountRaised,
        donorCount: fundraiser.donorCount,
      },
      // Refunded after it was paid out: the owner can't withdraw until covered.
      shortfall: balanceShortfall(balance),
      donations,
      limit: LIST_LIMIT,
    };
  },
});
