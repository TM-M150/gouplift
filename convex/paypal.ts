// convex/paypal.ts
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getUsdToKesRate } from "./lib/fx";
import { PLATFORM_FEE_RATE, resolveReturnOrigin } from "./lib/constants";

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
    amountUsd: v.number(),
    message: v.optional(v.string()),
    origin: v.string(), // window.location.origin from the client
  },
  returns: v.object({
    checkoutUrl: v.string(),
    donationId: v.id("donations"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ checkoutUrl: string; donationId: Id<"donations"> }> => {
    if (args.amountUsd <= 0) {
      throw new Error("Donation amount must be greater than 0.");
    }

    const fxRate = await getUsdToKesRate(ctx);
    const grossAmountKes = Math.round(args.amountUsd * fxRate);
    const platformFeeAmountKes = Math.round(grossAmountKes * PLATFORM_FEE_RATE);
    const netAmountKes = grossAmountKes - platformFeeAmountKes;

    // Create the pending donation FIRST so there's a real donationId to
    // put in the return URL — same order startDonationCheckout uses.
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
      },
    );

    const returnOrigin = resolveReturnOrigin(args.origin);
    const returnUrl = `${returnOrigin}/fundraiser/${args.fundraiserId}?donation=${donationId}`;

    const token = await getPayPalAccessToken();

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
            return_url: returnUrl,
            cancel_url: returnUrl,
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
      await ctx.runMutation(internal.donations.markDonationFailed, {
        donationId,
        status: "FAILED",
        failureReason: `PayPal order creation failed (${response.status}): ${errorText}`,
      });
      throw new Error("Could not start PayPal checkout. Please try again.");
    }

    const orderData = await response.json();

    console.log("PayPal order response:", JSON.stringify(orderData, null, 2));

    const links = orderData.links ?? [];

    const approveLinkObj = links.find(
      (link: any) => link.rel === "payer-action" || link.rel === "approve",
    );

    if (!approveLinkObj?.href) {
      console.error("No approval link found. Available links:", links);

      await ctx.runMutation(internal.donations.markDonationFailed, {
        donationId,
        status: "FAILED",
        failureReason: `PayPal response did not contain an approval link. Links: ${JSON.stringify(links)}`,
      });

      throw new Error("Could not start PayPal checkout. Please try again.");
    }

    // Attach PayPal's order ID
    await ctx.runMutation(internal.donations.attachProviderIds, {
      donationId,
      checkoutRequestId: orderData.id,
    });

    return { checkoutUrl: approveLinkObj.href, donationId };
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

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource: {
    id: string; // capture ID for PAYMENT.CAPTURE.* events
    status?: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
    // Fallback paths some payloads use
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{ id: string }>;
      };
    }>;
    // For ORDER events
    links?: Array<{ rel: string; href: string }>;
  };
  summary?: string;
}

async function verifyPayPalWebhook(
  headers: Headers,
  body: string,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error("PAYPAL_WEBHOOK_ID is not set");
    return false;
  }

  const transmissionId = headers.get("paypal-transmission-id");
  const transmissionTime = headers.get("paypal-transmission-time");
  const transmissionSig = headers.get("paypal-transmission-sig");
  const certUrl = headers.get("paypal-cert-url");
  const authAlgo = headers.get("paypal-auth-algo");

  if (
    !transmissionId ||
    !transmissionTime ||
    !transmissionSig ||
    !certUrl ||
    !authAlgo
  ) {
    return false;
  }

  const token = await getPayPalAccessToken();

  const verifyResponse = await fetch(
    `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: JSON.parse(body),
      }),
    },
  );

  if (!verifyResponse.ok) {
    const err = await verifyResponse.text();
    console.error("PayPal webhook verification failed:", err);
    return false;
  }

  const result = (await verifyResponse.json()) as {
    verification_status?: string;
  };
  return result.verification_status === "SUCCESS";
}

export const paypalWebhook = httpAction(async (ctx, request) => {
  const body = await request.text();

  // 1. Verify signature (required in production)
  const isValid = await verifyPayPalWebhook(request.headers, body);
  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(body) as PayPalWebhookEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // We only care about successful captures for now
  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    // Acknowledge other events so PayPal doesn't keep retrying
    return new Response("OK", { status: 200 });
  }

  const captureId = event.resource?.id;
  const orderId =
    event.resource?.supplementary_data?.related_ids?.order_id ?? null;

  if (!orderId) {
    console.error(
      "PayPal CAPTURE.COMPLETED missing order_id in supplementary_data",
      event.resource,
    );
    // Still 200 so PayPal stops retrying — we can't match the donation
    return new Response("OK", { status: 200 });
  }

  const donation = await ctx.runQuery(internal.paypal.getDonationByOrderId, {
    orderId,
  });

  if (!donation) {
    // Stale / unknown order — acknowledge and move on
    return new Response("OK", { status: 200 });
  }

  // Idempotent — completePayPalDonation already no-ops if already COMPLETED
  await ctx.runMutation(internal.paypal.completePayPalDonation, {
    donationId: donation._id,
    paypalCaptureId: captureId,
    rawPayload: body,
  });

  return new Response("OK", { status: 200 });
});
