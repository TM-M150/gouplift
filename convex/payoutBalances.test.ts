/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  PAYPAL_SETTLEMENT_DELAY_MS,
  availableBalance,
} from "../lib/payouts";
import { reverseDonationCredit } from "./lib/payoutBalance";
import {
  addFundraiser,
  balanceOf,
  DAY_MS,
  figures,
  fund,
  insertPayout,
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

const START = new Date("2026-11-04T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  // The rebuild logs every correction; keep the test output readable.
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const settleScheduled = (t: T) =>
  t.finishAllScheduledFunctions(vi.runAllTimers);

const world = () => seedPayoutWorld(convexTest(schema, modules));

// A donation that was started, as the payment paths find it.
async function pendingDonation(
  t: T,
  fundraiserId: Id<"fundraisers">,
  net: number,
  provider?: "SASAPAY" | "PAYPAL",
) {
  return await t.run((ctx) =>
    ctx.db.insert("donations", {
      fundraiserId,
      isAnonymous: false,
      grossAmount: net,
      currency: "KES",
      ...(provider ? { provider } : {}),
      platformFeeRate: 0,
      platformFeeAmount: 0,
      netAmount: net,
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

const donationRow = (t: T, id: Id<"donations">) =>
  t.run((ctx) => ctx.db.get(id));

describe("a donation that completes", () => {
  it("is withdrawable at once when it was paid by mobile money", async () => {
    const { t, ids } = await world();
    const donationId = await pendingDonation(t, ids.fundraiser, 957.5);

    await t.mutation(internal.donations.markDonationCompleted, { donationId });
    await settleScheduled(t);

    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 957.5,
      pendingNet: 0,
      reserved: 0,
      paid: 0,
    });
    expect((await donationRow(t, donationId))?.settledAt).toBeGreaterThan(0);
  });

  it("waits out the delay when it was paid through PayPal", async () => {
    const { t, ids } = await world();
    const donationId = await pendingDonation(t, ids.fundraiser, 2000, "PAYPAL");

    await t.mutation(internal.paypal.completePayPalDonation, {
      donationId,
      paypalCaptureId: "CAPTURE1",
    });

    // Counted, but not withdrawable, and nothing to withdraw yet.
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 0,
      pendingNet: 2000,
      reserved: 0,
      paid: 0,
    });
    expect((await donationRow(t, donationId))?.settledAt).toBeUndefined();
    expect(availableBalance(await balanceOf(t, ids.fundraiser))).toBe(0);

    // The scheduled job fires once the delay is over.
    await settleScheduled(t);

    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 2000,
      pendingNet: 0,
      reserved: 0,
      paid: 0,
    });
    const settled = (await donationRow(t, donationId))?.settledAt ?? 0;
    expect(settled).toBeGreaterThanOrEqual(
      START.getTime() + PAYPAL_SETTLEMENT_DELAY_MS,
    );
  });

  it("is scheduled for exactly the end of the PayPal delay", async () => {
    const { t, ids } = await world();
    const donationId = await pendingDonation(t, ids.fundraiser, 500, "PAYPAL");
    await t.mutation(internal.paypal.completePayPalDonation, {
      donationId,
      paypalCaptureId: "CAPTURE2",
    });

    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const settle = jobs.filter((job) => job.name.includes("settleDonation"));
    expect(settle).toHaveLength(1);
    const completedAt = (await donationRow(t, donationId))?.completedAt ?? 0;
    expect(settle[0].scheduledTime).toBe(
      completedAt + PAYPAL_SETTLEMENT_DELAY_MS,
    );
  });

  it("waits out the delay for a recurring PayPal payment too", async () => {
    const { t, ids } = await world();
    await t.run((ctx) =>
      ctx.db.insert("paypalSubscriptions", {
        fundraiserId: ids.fundraiser,
        isAnonymous: false,
        paypalSubscriptionId: "I-SUB1",
        paypalPlanId: "P-PLAN1",
        monthlyAmountUsd: 10,
        status: "ACTIVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await t.mutation(internal.paypal.recordSubscriptionPayment, {
      paypalSubscriptionId: "I-SUB1",
      paypalSaleId: "SALE1",
      grossAmountUsd: 10,
      exchangeRate: 130,
    });

    // 10 USD at 130 is KES 1,300, less the 4.25% fee: KES 1,244.75.
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 0,
      pendingNet: 1244.75,
      reserved: 0,
      paid: 0,
    });
    await settleScheduled(t);
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 1244.75,
      pendingNet: 0,
    });
  });

  it("is counted once when the payment callback is delivered twice", async () => {
    const { t, ids } = await world();
    const donationId = await pendingDonation(t, ids.fundraiser, 1000);

    await t.mutation(internal.donations.markDonationCompleted, { donationId });
    await t.mutation(internal.donations.markDonationCompleted, { donationId });
    await settleScheduled(t);

    expect((await figures(t, ids.fundraiser)).settledNet).toBe(1000);
  });

  it("is counted once when the settling job runs twice", async () => {
    const { t, ids } = await world();
    const donationId = await fund(t, ids.fundraiser, 800, {
      provider: "PAYPAL",
    });

    await t.mutation(internal.payoutBalances.settleDonation, { donationId });
    await t.mutation(internal.payoutBalances.settleDonation, { donationId });

    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 800,
      pendingNet: 0,
    });
  });

  it("is ignored by the settling job once it is no longer completed", async () => {
    const { t, ids } = await world();
    const donationId = await fund(t, ids.fundraiser, 800, {
      provider: "PAYPAL",
    });
    await t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));

    await t.mutation(internal.payoutBalances.settleDonation, { donationId });

    // Still pending: only taking the credit back (below) removes it.
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 0,
      pendingNet: 800,
    });
  });

  it("adds decimal amounts without picking up float drift", async () => {
    const { t, ids } = await world();
    for (const net of [10.1, 20.2, 30.3, 0.07]) await fund(t, ids.fundraiser, net);

    // 10.1 + 20.2 + 30.3 + 0.07 is 60.669999… in plain floating point.
    expect((await figures(t, ids.fundraiser)).settledNet).toBe(60.67);
  });
});

describe("taking a donation's credit back", () => {
  it("removes a settled donation from the settled total", async () => {
    const { t, ids } = await world();
    const donationId = await fund(t, ids.fundraiser, 1000);
    await fund(t, ids.fundraiser, 500);

    await t.run(async (ctx) => {
      const donation = await ctx.db.get(donationId);
      await reverseDonationCredit(ctx, donation!, Date.now());
    });

    expect(await figures(t, ids.fundraiser)).toMatchObject({ settledNet: 500 });
  });

  it("removes one still waiting out its delay from the pending total", async () => {
    const { t, ids } = await world();
    const donationId = await fund(t, ids.fundraiser, 1000, {
      provider: "PAYPAL",
    });

    await t.run(async (ctx) => {
      const donation = await ctx.db.get(donationId);
      await reverseDonationCredit(ctx, donation!, Date.now());
    });

    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 0,
      pendingNet: 0,
    });
  });

  it("leaves nothing to withdraw when the money has already gone", async () => {
    const { t, ids } = await world();
    const donationId = await fund(t, ids.fundraiser, 1000);
    // The whole amount was paid out, then the donation was refunded.
    const row = await balanceOf(t, ids.fundraiser);
    await t.run((ctx) => ctx.db.patch(row!._id, { paid: 1000 }));

    await t.run(async (ctx) => {
      const donation = await ctx.db.get(donationId);
      await reverseDonationCredit(ctx, donation!, Date.now());
    });

    const after = await balanceOf(t, ids.fundraiser);
    expect(after).toMatchObject({ settledNet: 0, paid: 1000 });
    // Never negative: the next payouts simply wait for new donations.
    expect(availableBalance(after)).toBe(0);
  });

  it("holds the pending figure at zero and warns when it would go below", async () => {
    const { t, ids } = await world();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const donationId = await fund(t, ids.fundraiser, 1000, {
      provider: "PAYPAL",
      uncounted: true,
    });

    // Never counted into pending, so taking it out would go to -1000.
    await t.run(async (ctx) => {
      const donation = await ctx.db.get(donationId);
      await reverseDonationCredit(ctx, donation!, Date.now());
    });

    expect((await figures(t, ids.fundraiser)).pendingNet).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("payoutBalances:rebuildBalance"),
    );
  });
});

describe("rebuildBalance", () => {
  const rebuild = (t: T, fundraiserId: Id<"fundraisers">, dryRun?: boolean) =>
    t.mutation(internal.payoutBalances.rebuildBalance, { fundraiserId, dryRun });

  it("reports a fundraiser that doesn't exist", async () => {
    const { t, ids } = await world();
    await t.run((ctx) => ctx.db.delete(ids.fundraiser));

    expect((await rebuild(t, ids.fundraiser)).outcome).toBe("missing");
  });

  it("leaves a fundraiser with no donations without a balance", async () => {
    const { t, ids } = await world();

    expect((await rebuild(t, ids.fundraiser)).outcome).toBe("unchanged");
    expect(await balanceOf(t, ids.fundraiser)).toBeNull();
  });

  it("leaves a correct balance alone", async () => {
    const { t, ids } = await world();
    await fund(t, ids.fundraiser, 1000);
    await fund(t, ids.fundraiser, 400, { provider: "PAYPAL" });
    const before = await balanceOf(t, ids.fundraiser);

    const result = await rebuild(t, ids.fundraiser);

    expect(result.outcome).toBe("unchanged");
    expect(await balanceOf(t, ids.fundraiser)).toEqual(before);
  });

  it("reports drift without changing anything on a dry run, then fixes it", async () => {
    const { t, ids } = await world();
    await fund(t, ids.fundraiser, 1000);
    const row = await balanceOf(t, ids.fundraiser);
    await t.run((ctx) =>
      ctx.db.patch(row!._id, { settledNet: 9999, paid: 5 }),
    );

    const preview = await rebuild(t, ids.fundraiser, true);
    expect(preview.outcome).toBe("would_correct");
    expect(preview.before).toMatchObject({ settledNet: 9999, paid: 5 });
    expect(preview.after).toMatchObject({ settledNet: 1000, paid: 0 });
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 9999,
      paid: 5,
    });

    expect((await rebuild(t, ids.fundraiser)).outcome).toBe("corrected");
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 1000,
      pendingNet: 0,
      reserved: 0,
      paid: 0,
    });
    // Running it again has nothing left to do.
    expect((await rebuild(t, ids.fundraiser)).outcome).toBe("unchanged");
  });

  it("rebuilds reserved and paid from the payouts", async () => {
    const w = await world();
    const { t, ids } = w;
    await fund(t, ids.fundraiser, 5000);
    await insertPayout(t, w, { amount: 300, status: "REQUESTED" });
    await insertPayout(t, w, { amount: 200, status: "APPROVED" });
    await insertPayout(t, w, { amount: 400, status: "PAID" });
    // These put the money back.
    await insertPayout(t, w, { amount: 500, status: "REJECTED" });
    await insertPayout(t, w, { amount: 600, status: "CANCELLED" });
    await insertPayout(t, w, { amount: 700, status: "FAILED" });

    await rebuild(t, ids.fundraiser);

    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 5000,
      pendingNet: 0,
      reserved: 500,
      paid: 400,
    });
  });

  it("only counts completed donations", async () => {
    const { t, ids } = await world();
    await fund(t, ids.fundraiser, 1000, { uncounted: true });
    for (const status of ["PENDING", "FAILED", "CANCELLED", "REFUNDED"] as const) {
      await fund(t, ids.fundraiser, 777, { uncounted: true, status });
    }

    await rebuild(t, ids.fundraiser);

    expect((await figures(t, ids.fundraiser)).settledNet).toBe(1000);
  });

  it("counts donations from before payouts existed, and stamps them settled", async () => {
    const { t, ids } = await world();
    const now = Date.now();
    // Mobile money, long ago; PayPal, long past its delay; PayPal, a day ago.
    const mobile = await fund(t, ids.fundraiser, 1000, {
      uncounted: true,
      completedAt: now - 30 * DAY_MS,
    });
    const oldPayPal = await fund(t, ids.fundraiser, 2000, {
      provider: "PAYPAL",
      uncounted: true,
      completedAt: now - 10 * DAY_MS,
    });
    const recentPayPal = await fund(t, ids.fundraiser, 500, {
      provider: "PAYPAL",
      uncounted: true,
      completedAt: now - DAY_MS,
    });

    const result = await rebuild(t, ids.fundraiser);

    expect(result.outcome).toBe("corrected");
    expect(await figures(t, ids.fundraiser)).toEqual({
      settledNet: 3000,
      pendingNet: 500,
      reserved: 0,
      paid: 0,
    });
    // Stamped with when they became withdrawable, not with today.
    expect((await donationRow(t, mobile))?.settledAt).toBe(now - 30 * DAY_MS);
    expect((await donationRow(t, oldPayPal))?.settledAt).toBe(
      now - 10 * DAY_MS + PAYPAL_SETTLEMENT_DELAY_MS,
    );
    expect((await donationRow(t, recentPayPal))?.settledAt).toBeUndefined();

    // The recent PayPal one settles when its delay is up, and a second
    // rebuild agrees with the result.
    await settleScheduled(t);
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 3500,
      pendingNet: 0,
    });
    expect((await rebuild(t, ids.fundraiser)).outcome).toBe("unchanged");
  });

  it("does not schedule the same settling twice when run again", async () => {
    const { t, ids } = await world();
    await fund(t, ids.fundraiser, 500, {
      provider: "PAYPAL",
      uncounted: true,
      completedAt: Date.now() - DAY_MS,
    });

    await rebuild(t, ids.fundraiser);
    await rebuild(t, ids.fundraiser);

    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.filter((job) => job.name.includes("settleDonation"))).toHaveLength(1);
  });
});

describe("rebuildAll", () => {
  it("rebuilds every fundraiser, across pages", async () => {
    const { t, ids } = await world();
    // More than one page of fundraisers (20 to a page), each owed something.
    const fundraisers = [ids.fundraiser];
    for (let i = 0; i < 44; i++) {
      fundraisers.push(await addFundraiser(t, ids.owner, ids.payoutAccount));
    }
    for (const fundraiserId of fundraisers) {
      await fund(t, fundraiserId, 1000, { uncounted: true });
    }

    await t.mutation(internal.payoutBalances.rebuildAll, {});
    await settleScheduled(t);

    for (const fundraiserId of fundraisers) {
      expect((await figures(t, fundraiserId)).settledNet).toBe(1000);
    }
  });

  it("changes nothing on a dry run", async () => {
    const { t, ids } = await world();
    await fund(t, ids.fundraiser, 1000, { uncounted: true });

    await t.mutation(internal.payoutBalances.rebuildAll, { dryRun: true });
    await settleScheduled(t);

    expect(await balanceOf(t, ids.fundraiser)).toBeNull();
    const donation = await t.run((ctx) => ctx.db.query("donations").first());
    expect(donation?.settledAt).toBeUndefined();
  });
});
