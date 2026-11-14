/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { availableBalance } from "../lib/payouts";
import { markReservationPaid, reserveForPayout } from "./lib/payoutBalance";
import {
  addOrganizationFundraiser,
  auditEntries,
  balanceOf,
  figures,
  seedPayoutWorld,
  type T,
} from "./payouts.fixtures";

// The real auth component needs a running Better Auth deployment. These tests
// only need `safeGetAuthUser`, so it reads the identity convex-test attaches.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
  },
}));

const modules = import.meta.glob("./**/*.ts");

const START = new Date("2026-11-13T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const REASON = "Donor paid twice by mistake and asked for it back.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Nothing here should reach the network: webhooks are queued, not delivered,
  // unless a test settles the scheduler (and then they hit this stub).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("ok", { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function setup() {
  const w = await seedPayoutWorld(convexTest(schema, modules));
  return w;
}

// A donation the way the payment paths start it.
function pending(
  t: T,
  fundraiserId: Id<"fundraisers">,
  over: Partial<Doc<"donations">> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("donations", {
      fundraiserId,
      isAnonymous: false,
      donorName: "Wanjiru Kamau",
      donorEmail: "wanjiru@example.test",
      grossAmount: 1000,
      currency: "KES",
      platformFeeRate: 0.05,
      platformFeeAmount: 50,
      netAmount: 950,
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...over,
    }),
  );
}

// Completed through the real path, so totals and balance are credited as they
// are in production.
async function completedSasaPay(
  t: T,
  fundraiserId: Id<"fundraisers">,
  over: Partial<Doc<"donations">> = {},
) {
  const donationId = await pending(t, fundraiserId, {
    provider: "SASAPAY",
    ...over,
  });
  await t.mutation(internal.donations.markDonationCompleted, {
    donationId,
    providerTransactionCode: "QWE123RTY4",
  });
  return donationId;
}

async function completedPayPal(
  t: T,
  fundraiserId: Id<"fundraisers">,
  captureId = "CAPTURE-1",
  orderId = "ORDER-1",
) {
  const donationId = await pending(t, fundraiserId, {
    provider: "PAYPAL",
    paymentMethod: "PAYPAL",
    originalCurrency: "USD",
    originalAmount: 25,
    exchangeRate: 40,
    checkoutRequestId: orderId,
  });
  await t.mutation(internal.paypal.completePayPalDonation, {
    donationId,
    paypalCaptureId: captureId,
  });
  return donationId;
}

const getDonation = (t: T, id: Id<"donations">) =>
  t.run((ctx) => ctx.db.get(id));
const getFundraiser = (t: T, id: Id<"fundraisers">) =>
  t.run((ctx) => ctx.db.get(id));
const deliveries = (t: T) =>
  t.run((ctx) => ctx.db.query("webhookDeliveries").collect());

describe("recording a refund", () => {
  it("marks the donation refunded and takes the money back out of the balance and totals", async () => {
    const { t, ids, asAdmin } = await setup();
    const keep = await completedSasaPay(t, ids.fundraiser);
    const refunded = await completedSasaPay(t, ids.fundraiser, {
      grossAmount: 2000,
      platformFeeAmount: 100,
      netAmount: 1900,
    });
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 2850,
    });
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 3000,
      donorCount: 2,
    });

    vi.setSystemTime(new Date(START.getTime() + 60_000));
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId: refunded,
      reason: REASON,
    });

    expect(await getDonation(t, refunded)).toMatchObject({
      status: "REFUNDED",
      refundedAt: START.getTime() + 60_000,
      refundReason: REASON,
      refundSource: "STAFF",
    });
    expect((await getDonation(t, keep))?.status).toBe("COMPLETED");
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 950,
      pendingNet: 0,
      reserved: 0,
      paid: 0,
    });
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 1000,
      donorCount: 1,
    });
  });

  it("takes a PayPal donation that hasn't settled out of pending, and the settle job then leaves it alone", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedPayPal(t, ids.fundraiser);
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      pendingNet: 950,
      settledNet: 0,
    });

    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 0,
      pendingNet: 0,
      reserved: 0,
      paid: 0,
    });

    // The settle job was scheduled when it completed; it must not bring the
    // refunded money back once the delay is over.
    vi.setSystemTime(new Date(START.getTime() + 4 * DAY_MS));
    await settle(t);
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 0,
      pendingNet: 0,
      reserved: 0,
      paid: 0,
    });
    expect((await getDonation(t, donationId))?.settledAt).toBeUndefined();
  });

  it("holds later payouts when the money was already paid out", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await t.run(async (ctx) => {
      await reserveForPayout(ctx, ids.fundraiser, 950, Date.now());
      await markReservationPaid(ctx, ids.fundraiser, 950, Date.now());
    });
    expect(availableBalance(await balanceOf(t, ids.fundraiser))).toBe(0);

    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });

    // The shortfall is on the books, and nothing is withdrawable.
    const row = await balanceOf(t, ids.fundraiser);
    expect(row).toMatchObject({ settledNet: 0, paid: 950 });
    expect(availableBalance(row)).toBe(0);

    // A new KES 400 donation goes to covering it, not into a payout.
    await completedSasaPay(t, ids.fundraiser, {
      grossAmount: 421.05,
      platformFeeAmount: 21.05,
      netAmount: 400,
    });
    expect(availableBalance(await balanceOf(t, ids.fundraiser))).toBe(0);
    // And once it is covered, what's beyond is withdrawable again.
    await completedSasaPay(t, ids.fundraiser, {
      grossAmount: 1052.63,
      platformFeeAmount: 52.63,
      netAmount: 1000,
    });
    expect(availableBalance(await balanceOf(t, ids.fundraiser))).toBe(450);
  });

  it("never pushes the fundraiser's totals below zero", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    // Totals that had already drifted down.
    await t.run((ctx) =>
      ctx.db.patch(ids.fundraiser, { amountRaised: 300, donorCount: 0 }),
    );
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 0,
      donorCount: 0,
    });
  });

  it("a refunded donation drops out of a rebuild of the totals", async () => {
    const { t, ids, asAdmin } = await setup();
    await completedSasaPay(t, ids.fundraiser);
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    const before = await figures(t, ids.fundraiser);

    await t.mutation(internal.payoutBalances.rebuildBalance, {
      fundraiserId: ids.fundraiser,
      dryRun: false,
    });
    expect(await figures(t, ids.fundraiser)).toEqual(before);
  });

  it("leaves payoutStatus alone", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    expect((await getDonation(t, donationId))?.payoutStatus).toBe(
      "PENDING_PAYOUT",
    );
  });
});

describe("who can record one, and when", () => {
  it("is for admins only, not moderators, owners or the signed-out", async () => {
    const { t, ids, asModerator, asOwner } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    const denied = /permission/;
    await expect(
      asModerator.mutation(api.refunds.refundDonation, {
        donationId,
        reason: REASON,
      }),
    ).rejects.toThrow(denied);
    await expect(
      asOwner.mutation(api.refunds.refundDonation, {
        donationId,
        reason: REASON,
      }),
    ).rejects.toThrow(denied);
    await expect(
      t.mutation(api.refunds.refundDonation, { donationId, reason: REASON }),
    ).rejects.toThrow(denied);
    expect((await getDonation(t, donationId))?.status).toBe("COMPLETED");
    expect(await auditEntries(t)).toHaveLength(0);
  });

  it("needs a real reason", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    for (const reason of ["", "   ", "dupe"]) {
      await expect(
        asAdmin.mutation(api.refunds.refundDonation, { donationId, reason }),
      ).rejects.toThrow(/at least/);
    }
    expect((await getDonation(t, donationId))?.status).toBe("COMPLETED");
  });

  it("refuses a donation that never completed", async () => {
    const { t, ids, asAdmin } = await setup();
    for (const status of ["PENDING", "FAILED", "CANCELLED"] as const) {
      const donationId = await pending(t, ids.fundraiser, { status });
      await expect(
        asAdmin.mutation(api.refunds.refundDonation, {
          donationId,
          reason: REASON,
        }),
      ).rejects.toThrow(/completed/);
      expect((await getDonation(t, donationId))?.status).toBe(status);
    }
    expect(await figures(t, ids.fundraiser)).toMatchObject({ settledNet: 0 });
    expect(await auditEntries(t)).toHaveLength(0);
  });

  it("can't be done twice: the balance and totals come down once", async () => {
    const { t, ids, asAdmin, asAdmin2 } = await setup();
    await completedSasaPay(t, ids.fundraiser);
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    await expect(
      asAdmin2.mutation(api.refunds.refundDonation, {
        donationId,
        reason: REASON,
      }),
    ).rejects.toThrow(/already been refunded/);

    expect(await figures(t, ids.fundraiser)).toMatchObject({ settledNet: 950 });
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 1000,
      donorCount: 1,
    });
    expect(await auditEntries(t)).toHaveLength(1);
  });

  it("writes an audit entry with who, which donation and why", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: `  ${REASON}  `,
    });
    expect(await auditEntries(t)).toMatchObject([
      {
        actorId: ids.admin,
        action: "DONATION_REFUNDED",
        fundraiserId: ids.fundraiser,
        donationId,
        statusBefore: "COMPLETED",
        statusAfter: "REFUNDED",
        note: REASON,
      },
    ]);
  });
});

describe("a refunded donation stays refunded", () => {
  it("a late success callback can't complete it again", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    const before = await figures(t, ids.fundraiser);

    await t.mutation(internal.donations.markDonationCompleted, {
      donationId,
      providerTransactionCode: "QWE123RTY4",
    });
    await t.mutation(internal.paypal.completePayPalDonation, {
      donationId,
      paypalCaptureId: "CAPTURE-LATE",
    });
    await settle(t);

    expect((await getDonation(t, donationId))?.status).toBe("REFUNDED");
    expect(await figures(t, ids.fundraiser)).toEqual(before);
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 0,
      donorCount: 0,
    });
  });

  it("a late failure callback can't overwrite it", async () => {
    const { t, ids, asAdmin } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });

    await t.mutation(internal.donations.markDonationFailed, {
      donationId,
      status: "FAILED",
      failureReason: "timeout",
    });
    await t.mutation(internal.paypal.failPayPalDonation, { donationId });

    const donation = await getDonation(t, donationId);
    expect(donation?.status).toBe("REFUNDED");
    expect(donation?.failureReason).toBeUndefined();
  });

  it("a repeated PayPal sale notification doesn't recreate a refunded subscription payment", async () => {
    const { t, ids } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("paypalSubscriptions", {
        fundraiserId: ids.fundraiser,
        donorName: "Wanjiru Kamau",
        donorEmail: "wanjiru@example.test",
        isAnonymous: false,
        paypalSubscriptionId: "I-SUB",
        paypalPlanId: "P-PLAN",
        monthlyAmountUsd: 10,
        status: "ACTIVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.mutation(internal.paypal.recordSubscriptionPayment, {
      paypalSubscriptionId: "I-SUB",
      paypalSaleId: "SALE-1",
      grossAmountUsd: 10,
      exchangeRate: 130,
    });
    expect(
      await t.mutation(internal.refunds.applyPayPalRefund, {
        eventType: "PAYMENT.SALE.REFUNDED",
        resource: {
          id: "REFUND-1",
          sale_id: "SALE-1",
          amount: { total: "10.00", currency: "USD" },
        },
      }),
    ).toBe("refunded");

    await t.mutation(internal.paypal.recordSubscriptionPayment, {
      paypalSubscriptionId: "I-SUB",
      paypalSaleId: "SALE-1",
      grossAmountUsd: 10,
      exchangeRate: 130,
    });
    const all = await t.run((ctx) => ctx.db.query("donations").collect());
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("REFUNDED");
  });
});

describe("PayPal telling us", () => {
  const captureResource = (over: Record<string, unknown> = {}) => ({
    id: "REFUND-9",
    amount: { value: "25.00", currency_code: "USD" },
    links: [
      {
        rel: "up",
        href: "https://api.paypal.com/v2/payments/captures/CAPTURE-1",
      },
    ],
    supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    ...over,
  });

  it("a full capture refund refunds the donation, found by its capture id", async () => {
    const { t, ids } = await setup();
    const donationId = await completedPayPal(t, ids.fundraiser);

    const outcome = await t.mutation(internal.refunds.applyPayPalRefund, {
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      resource: captureResource({ supplementary_data: undefined }),
    });

    expect(outcome).toBe("refunded");
    expect(await getDonation(t, donationId)).toMatchObject({
      status: "REFUNDED",
      refundSource: "PAYPAL",
      refundProviderId: "REFUND-9",
      refundReason: "PayPal refunded this payment.",
    });
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      pendingNet: 0,
      settledNet: 0,
    });
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 0,
      donorCount: 0,
    });
    // PayPal's refund is not a staff action, so nothing is in the audit log.
    expect(await auditEntries(t)).toHaveLength(0);
  });

  it("finds a donation made before capture ids were stored, through its order", async () => {
    const { t, ids } = await setup();
    const donationId = await completedPayPal(t, ids.fundraiser);
    await t.run((ctx) =>
      ctx.db.patch(donationId, { paypalCaptureId: undefined }),
    );

    const outcome = await t.mutation(internal.refunds.applyPayPalRefund, {
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      resource: captureResource({
        links: [
          {
            rel: "up",
            href: "https://api.paypal.com/v2/payments/captures/UNSEEN",
          },
        ],
      }),
    });
    expect(outcome).toBe("refunded");
    expect((await getDonation(t, donationId))?.status).toBe("REFUNDED");
  });

  it("a reversal (chargeback) is recorded as one", async () => {
    const { t, ids } = await setup();
    const donationId = await completedPayPal(t, ids.fundraiser);
    const outcome = await t.mutation(internal.refunds.applyPayPalRefund, {
      eventType: "PAYMENT.CAPTURE.REVERSED",
      resource: {
        id: "CAPTURE-1",
        amount: { value: "25.00", currency_code: "USD" },
      },
    });
    expect(outcome).toBe("refunded");
    expect(await getDonation(t, donationId)).toMatchObject({
      status: "REFUNDED",
      refundReason: "PayPal reversed this payment (a dispute or chargeback).",
    });
  });

  it("a notification we've already applied changes nothing", async () => {
    const { t, ids } = await setup();
    await completedSasaPay(t, ids.fundraiser);
    await completedPayPal(t, ids.fundraiser);
    const resource = captureResource();
    const apply = () =>
      t.mutation(internal.refunds.applyPayPalRefund, {
        eventType: "PAYMENT.CAPTURE.REFUNDED",
        resource,
      });
    expect(await apply()).toBe("refunded");
    const after = await figures(t, ids.fundraiser);
    expect(await apply()).toBe("already_refunded");
    expect(await figures(t, ids.fundraiser)).toEqual(after);
    expect(await getFundraiser(t, ids.fundraiser)).toMatchObject({
      amountRaised: 1000,
      donorCount: 1,
    });
  });

  it("a partial refund is not applied, and is reported", async () => {
    const { t, ids } = await setup();
    const donationId = await completedPayPal(t, ids.fundraiser);
    const outcome = await t.mutation(internal.refunds.applyPayPalRefund, {
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      resource: captureResource({
        amount: { value: "10.00", currency_code: "USD" },
      }),
    });
    expect(outcome).toBe("partial_or_unclear");
    expect((await getDonation(t, donationId))?.status).toBe("COMPLETED");
    expect(await figures(t, ids.fundraiser)).toMatchObject({ pendingNet: 950 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("not clearly the whole payment"),
    );
  });

  it("one that names no known payment is reported as not found", async () => {
    const { t, ids } = await setup();
    await completedPayPal(t, ids.fundraiser);
    const outcome = await t.mutation(internal.refunds.applyPayPalRefund, {
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REFUND-X",
        amount: { value: "25.00", currency_code: "USD" },
        links: [
          {
            rel: "up",
            href: "https://api.paypal.com/v2/payments/captures/NOPE",
          },
        ],
        supplementary_data: { related_ids: { order_id: "ORDER-NOPE" } },
      },
    });
    expect(outcome).toBe("not_found");
    expect(await figures(t, ids.fundraiser)).toMatchObject({ pendingNet: 950 });
  });

  it("a donation that never completed is left alone", async () => {
    const { t, ids } = await setup();
    const donationId = await pending(t, ids.fundraiser, {
      status: "FAILED",
      provider: "PAYPAL",
      originalCurrency: "USD",
      originalAmount: 25,
      checkoutRequestId: "ORDER-1",
    });
    const outcome = await t.mutation(internal.refunds.applyPayPalRefund, {
      eventType: "PAYMENT.CAPTURE.REFUNDED",
      resource: captureResource(),
    });
    expect(outcome).toBe("not_completed");
    expect((await getDonation(t, donationId))?.status).toBe("FAILED");
  });

  it("ignores any other event type", async () => {
    const { t } = await setup();
    expect(
      await t.mutation(internal.refunds.applyPayPalRefund, {
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        resource: captureResource(),
      }),
    ).toBe("not_a_refund");
  });
});

describe("telling organizations", () => {
  async function withWebhook() {
    const w = await setup();
    const org = await addOrganizationFundraiser(w.t, w.ids);
    await w.t.run((ctx) =>
      ctx.db.insert("webhookEndpoints", {
        organizationId: org.organizationId,
        url: "https://hooks.example.org/gouplift",
        secret: "whsec_test",
        isActive: true,
        createdBy: w.ids.owner,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    return { ...w, fundraiserId: org.fundraiserId };
  }

  it("queues one donation.refunded event, without the reason or the donor's contact details", async () => {
    const { t, asAdmin, fundraiserId } = await withWebhook();
    const donationId = await completedSasaPay(t, fundraiserId);
    await settle(t);
    const before = (await deliveries(t)).length; // the donation.completed one
    expect(before).toBe(1);

    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    await settle(t);

    const all = await deliveries(t);
    const refunds = all.filter((d) => d.eventType === "donation.refunded");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].eventId).toBe(`evt_donation_refunded_${donationId}`);

    const body = JSON.parse(refunds[0].payload);
    expect(body).toMatchObject({
      type: "donation.refunded",
      data: {
        donation: {
          id: donationId,
          fundraiserId,
          amount: 1000,
          currency: "KES",
          isAnonymous: false,
          donorName: "Wanjiru Kamau",
        },
      },
    });
    const refundedAt = (await getDonation(t, donationId))?.refundedAt;
    expect(body.data.donation.refundedAt).toBe(
      new Date(refundedAt!).toISOString(),
    );
    const text = refunds[0].payload;
    expect(text).not.toContain(REASON);
    expect(text).not.toContain("wanjiru@example.test");
    expect(text).not.toContain("refundReason");
  });

  it("withholds an anonymous donor's name", async () => {
    const { t, asAdmin, fundraiserId } = await withWebhook();
    const donationId = await completedSasaPay(t, fundraiserId, {
      isAnonymous: true,
    });
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    await settle(t);
    const refund = (await deliveries(t)).find(
      (d) => d.eventType === "donation.refunded",
    )!;
    expect(JSON.parse(refund.payload).data.donation).toMatchObject({
      isAnonymous: true,
      donorName: null,
    });
    expect(refund.payload).not.toContain("Wanjiru");
  });

  it("is not sent twice for one refund", async () => {
    const { t, fundraiserId } = await withWebhook();
    const donationId = await completedSasaPay(t, fundraiserId);
    await t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));
    await t.mutation(internal.webhookDelivery.enqueueDonationRefunded, {
      donationId,
    });
    await t.mutation(internal.webhookDelivery.enqueueDonationRefunded, {
      donationId,
    });
    const refunds = (await deliveries(t)).filter(
      (d) => d.eventType === "donation.refunded",
    );
    expect(refunds).toHaveLength(1);
  });

  it("sends nothing for a donation that isn't refunded", async () => {
    const { t, fundraiserId } = await withWebhook();
    const donationId = await completedSasaPay(t, fundraiserId);
    await t.mutation(internal.webhookDelivery.enqueueDonationRefunded, {
      donationId,
    });
    expect(
      (await deliveries(t)).filter((d) => d.eventType === "donation.refunded"),
    ).toHaveLength(0);
  });

  it("recording the refund does not depend on the receiver", async () => {
    const { t, asAdmin, fundraiserId } = await withWebhook();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("receiver is down");
      }),
    );
    const donationId = await completedSasaPay(t, fundraiserId);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });
    await settle(t);
    expect((await getDonation(t, donationId))?.status).toBe("REFUNDED");
  });
});

describe("finding a donation to refund", () => {
  it("lists a fundraiser's donations for an admin, found by its link or its id", async () => {
    const { t, ids, asAdmin } = await setup();
    const open = await completedSasaPay(t, ids.fundraiser, {
      donorPhone: "+254712000111",
    });
    const gone = await completedSasaPay(t, ids.fundraiser);
    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId: gone,
      reason: REASON,
    });

    for (const text of [
      ids.fundraiser,
      `  https://gouplift.co.ke/fundraiser/${ids.fundraiser}?ref=x#top `,
    ]) {
      const result = await asAdmin.query(api.refunds.listDonationsForRefund, {
        fundraiser: text,
      });
      expect(result?.fundraiser).toMatchObject({
        _id: ids.fundraiser,
        title: "Water for Kajiado",
        amountRaised: 1000,
        donorCount: 1,
      });
      expect(result?.shortfall).toBe(0);
      expect(result?.donations.map((d) => [d._id, d.status]).sort()).toEqual(
        [
          [open, "COMPLETED"],
          [gone, "REFUNDED"],
        ].sort(),
      );
      expect(result?.donations.find((d) => d._id === open)).toMatchObject({
        donorPhone: "+254712000111",
        reference: "QWE123RTY4",
        grossAmount: 1000,
      });
      expect(result?.donations.find((d) => d._id === gone)).toMatchObject({
        refundReason: REASON,
        refundSource: "STAFF",
      });
    }
  });

  it("finds nothing for a link that isn't a fundraiser", async () => {
    const { asAdmin } = await setup();
    for (const fundraiser of ["", "nonsense", "https://gouplift.co.ke/about"]) {
      expect(
        await asAdmin.query(api.refunds.listDonationsForRefund, { fundraiser }),
      ).toBeNull();
    }
  });

  it("shows nothing to moderators, owners or the signed-out", async () => {
    const { t, ids, asModerator, asOwner } = await setup();
    await completedSasaPay(t, ids.fundraiser);
    const args = { fundraiser: ids.fundraiser };
    expect(
      await asModerator.query(api.refunds.listDonationsForRefund, args),
    ).toBeNull();
    expect(
      await asOwner.query(api.refunds.listDonationsForRefund, args),
    ).toBeNull();
    expect(await t.query(api.refunds.listDonationsForRefund, args)).toBeNull();
  });

  it("reports how short the fundraiser is after a refund of money already paid out", async () => {
    const { t, ids, asAdmin, asOwner } = await setup();
    const donationId = await completedSasaPay(t, ids.fundraiser);
    await t.run(async (ctx) => {
      await reserveForPayout(ctx, ids.fundraiser, 950, Date.now());
      await markReservationPaid(ctx, ids.fundraiser, 950, Date.now());
    });
    expect(
      (
        await asOwner.query(api.payouts.getMyPayoutOverview, {
          fundraiserId: ids.fundraiser,
        })
      )?.shortfall,
    ).toBe(0);

    await asAdmin.mutation(api.refunds.refundDonation, {
      donationId,
      reason: REASON,
    });

    const mine = await asOwner.query(api.payouts.getMyPayoutOverview, {
      fundraiserId: ids.fundraiser,
    });
    expect(mine).toMatchObject({ available: 0, shortfall: 950 });
    const theirs = await asAdmin.query(api.refunds.listDonationsForRefund, {
      fundraiser: ids.fundraiser,
    });
    expect(theirs?.shortfall).toBe(950);
  });
});
