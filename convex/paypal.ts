// convex/paypal.ts
import { action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getUsdToKesRate } from "./lib/fx";
import { PLATFORM_FEE_RATE } from "./donations";

const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com"; // Switch to https://api-m.paypal.com for production

interface PayPalOrderResponse {
  id: string;
  links: { rel: string; href: string }[];
}

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "PayPal API credentials are not configured in Convex environment variables.",
    );
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to obtain PayPal OAuth token: ${errorText}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal token response did not include access_token.");
  }
  return data.access_token;
}

export const createPendingPayPalDonation = internalMutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    donorUserId: v.optional(v.id("users")),
    donorName: v.optional(v.string()),
    donorEmail: v.optional(v.string()),
    donorPhone: v.optional(v.string()),
    isAnonymous: v.boolean(),
    grossAmountKes: v.number(),
    platformFeeAmountKes: v.number(),
    netAmountKes: v.number(),
    platformFeeRate: v.number(),
    message: v.optional(v.string()),
    checkoutRequestId: v.string(), // PayPal Order ID
  },
  returns: v.id("donations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("donations", {
      fundraiserId: args.fundraiserId,
      donorUserId: args.donorUserId,
      donorName: args.donorName,
      donorEmail: args.donorEmail,
      donorPhone: args.donorPhone,
      isAnonymous: args.isAnonymous,
      grossAmount: args.grossAmountKes,
      platformFeeRate: args.platformFeeRate,
      platformFeeAmount: args.platformFeeAmountKes,
      netAmount: args.netAmountKes,
      message: args.message,
      currency: "KES",
      provider: "PAYPAL",
      paymentMethod: "PAYPAL",
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      checkoutRequestId: args.checkoutRequestId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const startPayPalCheckout = action({
  args: {
    fundraiserId: v.id("fundraisers"),
    donorUserId: v.optional(v.id("users")),
    donorName: v.optional(v.string()),
    donorEmail: v.optional(v.string()),
    donorPhone: v.optional(v.string()),
    isAnonymous: v.boolean(),
    amountUsd: v.number(), // Amount entered by donor in USD
    message: v.optional(v.string()),
    returnUrl: v.string(),
    cancelUrl: v.string(),
  },
  returns: v.object({
    checkoutUrl: v.string(),
    orderId: v.string(),
    donationId: v.id("donations"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    checkoutUrl: string;
    orderId: string;
    donationId: Id<"donations">;
  }> => {
    if (args.amountUsd <= 0) {
      throw new Error("Donation amount must be greater than 0.");
    }

    const token = await getPayPalAccessToken();

    // 1. Convert USD amount to KES equivalent for local progress tracking
    const fxRate = await getUsdToKesRate(ctx);
    const grossAmountKes = Math.round(args.amountUsd * fxRate);
    const platformFeeAmountKes = Math.round(grossAmountKes * PLATFORM_FEE_RATE);
    const netAmountKes = grossAmountKes - platformFeeAmountKes;

    // 2. Create PayPal Order
    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: args.amountUsd.toFixed(2),
          },
          description: `Donation to Fundraiser ID: ${args.fundraiserId}`,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: args.returnUrl,
            cancel_url: args.cancelUrl,
            user_action: "PAY_NOW",
          },
        },
      },
    };

    const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PayPal Order creation failed: ${errorText}`);
    }

    const orderData = (await response.json()) as PayPalOrderResponse;

    // Prefer payer-action (when payment_source is used) or fall back to approve
    const approveLinkObj = orderData.links.find(
      (link) => link.rel === "payer-action" || link.rel === "approve",
    );

    if (!approveLinkObj?.href) {
      console.error(
        "Full PayPal response:",
        JSON.stringify(orderData, null, 2),
      );
      throw new Error(
        "PayPal response did not contain an approval link (approve or payer-action).",
      );
    }

    // 4. Save initial donation record with order ID
    const donationId: Id<"donations"> = await ctx.runMutation(
      internal.paypal.createPendingPayPalDonation,
      {
        fundraiserId: args.fundraiserId,
        donorUserId: args.donorUserId,
        donorName: args.donorName,
        donorEmail: args.donorEmail,
        donorPhone: args.donorPhone,
        isAnonymous: args.isAnonymous,
        grossAmountKes,
        platformFeeAmountKes,
        netAmountKes,
        platformFeeRate: PLATFORM_FEE_RATE,
        message: args.message,
        checkoutRequestId: orderData.id,
      },
    );

    return {
      checkoutUrl: approveLinkObj.href,
      orderId: orderData.id,
      donationId,
    };
  },
});

export const getDonationByOrderId = internalQuery({
  args: {
    orderId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("donations"),
      fundraiserId: v.id("fundraisers"),
      status: v.string(),
      netAmount: v.number(),
      grossAmount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const donation = await ctx.db
      .query("donations")
      .withIndex("by_checkoutRequestId", (q) =>
        q.eq("checkoutRequestId", args.orderId),
      )
      .unique();

    if (!donation) return null;

    return {
      _id: donation._id,
      fundraiserId: donation.fundraiserId,
      status: donation.status,
      netAmount: donation.netAmount,
      grossAmount: donation.grossAmount,
    };
  },
});

export const completePayPalDonation = internalMutation({
  args: {
    donationId: v.id("donations"),
    paypalCaptureId: v.string(),
    paypalPayerId: v.optional(v.string()),
    paypalPayerEmail: v.optional(v.string()),
    rawPayload: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) {
      throw new Error("Donation not found");
    }

    // Idempotent
    if (donation.status === "COMPLETED") {
      return null;
    }

    await ctx.db.patch(args.donationId, {
      status: "COMPLETED",
      payoutStatus: "PENDING_PAYOUT",
      merchantRequestId: args.paypalCaptureId,
      providerTransactionCode: args.paypalCaptureId,
      providerPayload: args.rawPayload,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const fundraiser = await ctx.db.get(donation.fundraiserId);
    if (fundraiser) {
      await ctx.db.patch(donation.fundraiserId, {
        amountRaised: fundraiser.amountRaised + donation.netAmount,
        donorCount: fundraiser.donorCount + 1,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

export const capturePayPalOrder = action({
  args: {
    orderId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    donationId: v.optional(v.id("donations")),
    message: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    donationId?: Id<"donations">;
    message: string;
  }> => {
    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${args.orderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("PayPal capture failed:", errorText);
      return {
        success: false,
        message: `Capture failed: ${errorText}`,
      };
    }

    const captureData = await response.json();

    const isCompleted =
      captureData.status === "COMPLETED" ||
      captureData.purchase_units?.[0]?.payments?.captures?.[0]?.status ===
        "COMPLETED";

    if (!isCompleted) {
      return {
        success: false,
        message: `Order not completed. Status: ${captureData.status}`,
      };
    }

    const donation = await ctx.runQuery(internal.paypal.getDonationByOrderId, {
      orderId: args.orderId,
    });

    if (!donation) {
      return {
        success: false,
        message: "Donation record not found for this order",
      };
    }

    const captureId =
      captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id ??
      captureData.id;

    await ctx.runMutation(internal.paypal.completePayPalDonation, {
      donationId: donation._id,
      paypalCaptureId: captureId,
      paypalPayerId: captureData.payer?.payer_id,
      paypalPayerEmail: captureData.payer?.email_address,
      rawPayload: JSON.stringify(captureData),
    });

    return {
      success: true,
      donationId: donation._id,
      message: "Payment captured successfully",
    };
  },
});
