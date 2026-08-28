import { v } from "convex/values";
import { action, httpAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { authComponent } from "./auth";

export const PLATFORM_FEE_RATE = 0.0425;

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function resolveReturnOrigin(requestedOrigin: string): string {
  const allowed = (process.env.ALLOWED_APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowed.includes(requestedOrigin)) {
    return requestedOrigin;
  }
  return allowed[0] ?? requestedOrigin;
}

export const getUserByAuthUserId = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId))
      .unique();
  },
});

function mapSourceChannel(
  sourceChannel?: string,
):
  | "SASAPAY_WALLET"
  | "MPESA"
  | "AIRTEL_MONEY"
  | "CARD"
  | "BANK"
  | undefined {
  switch (sourceChannel?.toUpperCase()) {
    case "M-PESA":
    case "MPESA":
      return "MPESA";
    case "AIRTEL":
    case "AIRTEL MONEY":
      return "AIRTEL_MONEY";
    case "CARD":
      return "CARD";
    case "SASAPAY":
      return "SASAPAY_WALLET";
    default:
      return undefined;
  }
}

export const donationCallback = httpAction(async (ctx, request) => {
  // SasaPay's callbacks aren't documented as signed, so this shared
  // secret (appended as a query param on the CallbackUrl you send SasaPay)
  // is the practical guard against someone posting a fake success payload
  // straight to a guessed endpoint.
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || token !== process.env.SASAPAY_CALLBACK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
 
  const payload = await request.json();
 
  const checkoutRequestId: string | undefined = payload.CheckoutRequestID;
  const resultCode: string | undefined = payload.ResultCode?.toString();
  const resultDesc: string | undefined = payload.ResultDesc;
  const transactionCode: string | undefined = payload.TransactionCode;
  const sourceChannel: string | undefined = payload.SourceChannel;
 
  if (!checkoutRequestId) {
    return new Response("Missing CheckoutRequestID", { status: 400 });
  }
 
  const donation = await ctx.runQuery(
    internal.donations.getDonationByCheckoutRequestId,
    { checkoutRequestId },
  );
 
  if (!donation) {
    // Nothing on our side matches this — most likely a stale/replayed
    // callback. Acknowledge with 200 so SasaPay stops retrying, but don't
    // touch anything since there's no donation to update.
    return new Response("OK", { status: 200 });
  }
 
  if (resultCode === "0") {
    // markDonationCompleted no-ops if this donation is already COMPLETED,
    // so a retried callback for the same transaction is safe to process
    // again — no separate idempotency check needed here.
    await ctx.runMutation(internal.donations.markDonationCompleted, {
      donationId: donation._id,
      providerTransactionCode: transactionCode,
      providerPayload: JSON.stringify(payload),
      paymentMethod: mapSourceChannel(sourceChannel),
    });
  } else {
    await ctx.runMutation(internal.donations.markDonationFailed, {
      donationId: donation._id,
      status: "FAILED",
      failureReason: resultDesc ?? `SasaPay ResultCode ${resultCode}`,
    });
  }
 
  // SasaPay's docs don't specify a required acknowledgment body — plain
  // 200 is the safe default so it doesn't keep retrying a callback
  // you've already handled.
  return new Response("OK", { status: 200 });
});

export const startDonationCheckout = action({
  args: {
    fundraiserId: v.id("fundraisers"),
    grossAmount: v.number(),
    message: v.optional(v.string()),
    isAnonymous: v.boolean(),
    donorName: v.optional(v.string()),
    donorEmail: v.optional(v.string()),
    donorPhone: v.optional(v.string()),
    // Pass window.location.origin from the client — validated against
    // ALLOWED_APP_ORIGINS below, not trusted as-is.
    origin: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ donationId: Id<"donations">; checkoutUrl: string }> => {
    if (args.grossAmount <= 0) {
      throw new Error("Donation amount must be greater than 0.");
    }

    // Donating doesn't require an account — same reasoning as fundraiser
    // creation's inline-auth flow, but here there's no reason to ask for
    // one at all. Attach donorUserId only if they happen to be signed in.
    const authUser = await authComponent.safeGetAuthUser(ctx);
    let donorUserId: Id<"users"> | undefined;
    if (authUser) {
      const user = await ctx.runQuery(
        internal.donations.getUserByAuthUserId,
        { authUserId: authUser._id },
      );
      donorUserId = user?._id;
    }

    // Create the PENDING row before calling SasaPay — we want a record on
    // our side even if the request below fails outright.
    const donationId: Id<"donations"> = await ctx.runMutation(
      internal.donations.createPendingDonation,
      {
        fundraiserId: args.fundraiserId,
        grossAmount: args.grossAmount,
        currency: "KES",
        message: args.message,
        isAnonymous: args.isAnonymous,
        donorUserId,
        donorName: args.donorName,
        donorEmail: args.donorEmail,
        donorPhone: args.donorPhone,
      },
    );

    const accessToken: string = await ctx.runAction(
      internal.sasapay.getSasaPayAccessToken,
      {},
    );

    const merchantCode = process.env.SASAPAY_MERCHANT_CODE;
    const callbackUrl = process.env.SASAPAY_CALLBACK_URL;
    const baseUrl =
      process.env.SASAPAY_BASE_URL ?? "https://sandbox.sasapay.app";

    if (!merchantCode || !callbackUrl) {
      throw new Error(
        "Missing SASAPAY_MERCHANT_CODE / SASAPAY_CALLBACK_URL — set them with `npx convex env set`.",
      );
    }

    // Land the donor back on the fundraiser they just supported, on
    // whichever domain they actually started from — not a separate
    // confirmation page, and not a hardcoded single domain. The page
    // there is responsible for checking the donation's real status (once
    // getDonationStatus exists), so success and failure can point at the
    // same place.
    const returnOrigin = resolveReturnOrigin(args.origin);
    const returnUrl = `${returnOrigin}/fundraiser/${args.fundraiserId}?donation=${donationId}`;

    // The Checkout API is a hosted page — SasaPayWalletEnabled/MpesaEnabled/
    // CardEnabled/AirtelEnabled control which options the donor sees there,
    // not which one gets used. Reference carries our donationId through so
    // it's traceable on SasaPay's side too.
    const response = await fetch(
      `${baseUrl}/api/v1/payments/card-payments/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          MerchantCode: merchantCode,
          Amount: args.grossAmount.toFixed(2),
          Reference: donationId,
          Description: "Donation",
          Currency: "KES",
          PayerEmail: args.donorEmail,
          CallbackUrl: callbackUrl,
          SuccessUrl: returnUrl,
          FailureUrl: returnUrl,
          SasaPayWalletEnabled: true,
          MpesaEnabled: true,
          CardEnabled: true,
          AirtelEnabled: true,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      await ctx.runMutation(internal.donations.markDonationFailed, {
        donationId,
        status: "FAILED",
        failureReason: `SasaPay checkout request failed (${response.status}): ${body}`,
      });
      throw new Error("Could not start checkout. Please try again.");
    }

    const data = (await response.json()) as {
      status?: boolean;
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      // SasaPay's docs confirm the response says "redirect the customer to
      // the given checkout url" but the truncated example didn't show the
      // exact field name for it — check your actual sandbox response and
      // correct this key if it comes back differently.
      CheckoutUrl?: string;
      ResponseDescription?: string;
    };

    if (!data.status || !data.CheckoutRequestID) {
      await ctx.runMutation(internal.donations.markDonationFailed, {
        donationId,
        status: "FAILED",
        failureReason:
          data.ResponseDescription ??
          "SasaPay did not return a checkout request.",
      });
      throw new Error("Could not start checkout. Please try again.");
    }

    // Attach SasaPay's correlation IDs so the webhook can find this row
    // when the result comes back asynchronously.
    await ctx.runMutation(internal.donations.attachProviderIds, {
      donationId,
      merchantRequestId: data.MerchantRequestID,
      checkoutRequestId: data.CheckoutRequestID,
    });

    if (!data.CheckoutUrl) {
      throw new Error(
        "SasaPay response didn't include a checkout URL — check the field name against your actual sandbox response.",
      );
    }

    return { donationId, checkoutUrl: data.CheckoutUrl };
  },
});

export const createPendingDonation = internalMutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    grossAmount: v.number(),
    currency: v.union(v.literal("KES")),
    message: v.optional(v.string()),
    isAnonymous: v.boolean(),
    donorUserId: v.optional(v.id("users")),
    donorName: v.optional(v.string()),
    donorEmail: v.optional(v.string()),
    donorPhone: v.optional(v.string()),
    // paymentMethod is NOT collected here — with the hosted Checkout API,
    // the donor picks their method on SasaPay's page, so it's only known
    // once the callback reports it. See markDonationCompleted below.
  },
  handler: async (ctx, args) => {
    if (args.grossAmount <= 0) {
      throw new Error("Donation amount must be greater than 0.");
    }

    const platformFeeAmount = roundToCents(
      args.grossAmount * PLATFORM_FEE_RATE,
    );
    const netAmount = roundToCents(args.grossAmount - platformFeeAmount);

    const now = Date.now();
    const donationId = await ctx.db.insert("donations", {
      fundraiserId: args.fundraiserId,
      donorUserId: args.donorUserId,
      donorName: args.donorName,
      donorEmail: args.donorEmail,
      donorPhone: args.donorPhone,
      isAnonymous: args.isAnonymous,
      grossAmount: args.grossAmount,
      currency: args.currency,
      message: args.message,
      platformFeeRate: PLATFORM_FEE_RATE,
      platformFeeAmount,
      netAmount,
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      createdAt: now,
      updatedAt: now,
    });

    return donationId;
  },
});

export const attachProviderIds = internalMutation({
  args: {
    donationId: v.id("donations"),
    merchantRequestId: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.donationId, {
      merchantRequestId: args.merchantRequestId,
      checkoutRequestId: args.checkoutRequestId,
      updatedAt: Date.now(),
    });
  },
});

export const getDonationByCheckoutRequestId = internalQuery({
  args: { checkoutRequestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("donations")
      .withIndex("by_checkoutRequestId", (q) =>
        q.eq("checkoutRequestId", args.checkoutRequestId),
      )
      .unique();
  },
});

export const markDonationCompleted = internalMutation({
  args: {
    donationId: v.id("donations"),
    providerTransactionCode: v.optional(v.string()),
    providerPayload: v.optional(v.string()),
    // Filled in here instead of at creation — see the note on
    // createPendingDonation above.
    paymentMethod: v.optional(
      v.union(
        v.literal("SASAPAY_WALLET"),
        v.literal("MPESA"),
        v.literal("AIRTEL_MONEY"),
        v.literal("CARD"),
        v.literal("BANK"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) {
      throw new Error(`Donation ${args.donationId} not found.`);
    }

    // Webhooks get redelivered — this stops a duplicate "success" callback
    // from crediting the fundraiser twice for the same donation.
    if (donation.status === "COMPLETED") {
      return;
    }

    const now = Date.now();

    await ctx.db.patch(args.donationId, {
      status: "COMPLETED",
      payoutStatus: "PENDING_PAYOUT",
      providerTransactionCode: args.providerTransactionCode,
      providerPayload: args.providerPayload,
      paymentMethod: args.paymentMethod,
      completedAt: now,
      updatedAt: now,
    });

    const fundraiser = await ctx.db.get(donation.fundraiserId);
    if (fundraiser) {
      await ctx.db.patch(donation.fundraiserId, {
        amountRaised: fundraiser.amountRaised + donation.grossAmount,
        donorCount: fundraiser.donorCount + 1,
        updatedAt: now,
      });
    }
  },
});

export const markDonationFailed = internalMutation({
  args: {
    donationId: v.id("donations"),
    status: v.union(v.literal("FAILED"), v.literal("CANCELLED")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) {
      throw new Error(`Donation ${args.donationId} not found.`);
    }

    // Don't clobber a COMPLETED donation if a stale failure callback
    // arrives after a success one already landed.
    if (donation.status === "COMPLETED") {
      return;
    }

    await ctx.db.patch(args.donationId, {
      status: args.status,
      failureReason: args.failureReason,
      updatedAt: Date.now(),
    });
  },
});

export const getDonationStatus = query({
  args: { donationId: v.id("donations") },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) {
      return null;
    }
    
    return {
      status: donation.status,
      grossAmount: donation.grossAmount,
      currency: donation.currency,
      paymentMethod: donation.paymentMethod,
      failureReason: donation.failureReason,
      completedAt: donation.completedAt,
    };
  },
});