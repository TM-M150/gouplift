/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { refundCompletedDonation } from "./lib/refunds";
import {
  MAX_IMPACT_DONATIONS,
  MAX_IMPACT_FUNDRAISERS,
  tallyImpact,
  type ImpactDonation,
  type ImpactFundraiser,
} from "../lib/impact";

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
type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T00:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  // A donation with an email queues a receipt, which can't be sent here.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // A refund queues webhooks; none of them should reach the network.
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
const later = (ms = 60_000) => vi.setSystemTime(Date.now() + ms);

// ---------------------------------------------------------------------------
// The sums, on their own.

const gift = (fundraiserId: string, grossAmount: number): ImpactDonation => ({
  fundraiserId,
  grossAmount,
});
const raising = (
  _id: string,
  amountRaised: number,
  donorCount = 0,
  currency: ImpactFundraiser["currency"] = "KES",
): ImpactFundraiser => ({ _id, currency, amountRaised, donorCount });

describe("tallyImpact", () => {
  it("is all zeros for someone who has done nothing yet", () => {
    expect(tallyImpact([], [])).toEqual({
      givenKes: 0,
      raisedKes: 0,
      totalKes: 0,
      fundraisersSupported: 0,
      donationsReceived: 0,
    });
  });

  it("adds up what was given, and counts each fundraiser once", () => {
    const impact = tallyImpact(
      [gift("a", 1000), gift("a", 500), gift("b", 250)],
      [],
    );
    expect(impact.givenKes).toBe(1750);
    expect(impact.fundraisersSupported).toBe(2);
    expect(impact.totalKes).toBe(1750);
  });

  it("adds up what their fundraisers raised and the gifts they received", () => {
    const impact = tallyImpact(
      [],
      [raising("mine1", 40_000, 12), raising("mine2", 2_500, 3)],
    );
    expect(impact.raisedKes).toBe(42_500);
    expect(impact.donationsReceived).toBe(15);
    expect(impact.givenKes).toBe(0);
    expect(impact.totalKes).toBe(42_500);
  });

  it("is given plus raised", () => {
    const impact = tallyImpact([gift("a", 1000)], [raising("mine", 9000, 4)]);
    expect(impact.totalKes).toBe(10_000);
  });

  it("doesn't count a gift to their own fundraiser as given, or as supporting it", () => {
    const impact = tallyImpact(
      [gift("mine", 3000), gift("a", 1000)],
      [raising("mine", 3000, 1)],
    );
    // The 3,000 is in what the fundraiser raised, and counted there once.
    expect(impact.givenKes).toBe(1000);
    expect(impact.fundraisersSupported).toBe(1);
    expect(impact.raisedKes).toBe(3000);
    expect(impact.totalKes).toBe(4000);
  });

  it("never adds a fundraiser kept in another currency to the shilling total", () => {
    const impact = tallyImpact(
      [],
      [raising("kes", 1000, 2), raising("usd", 500, 1, "USD")],
    );
    expect(impact.raisedKes).toBe(1000);
    // A gift is still a gift, whatever the currency.
    expect(impact.donationsReceived).toBe(3);
  });

  it("keeps cents and doesn't show floating point dust", () => {
    const given = tallyImpact([gift("a", 0.1), gift("b", 0.2)], []);
    expect(given.givenKes).toBe(0.3);
    expect(given.totalKes).toBe(0.3);

    const raised = tallyImpact([], [raising("a", 0.1), raising("b", 0.2)]);
    expect(raised.raisedKes).toBe(0.3);
    expect(raised.totalKes).toBe(0.3);
  });

  it("reads a bounded number of rows for one person", () => {
    // Pinned so that raising them is a choice: each one is read on every
    // change to that person's donations or fundraisers.
    expect(MAX_IMPACT_DONATIONS).toBe(500);
    expect(MAX_IMPACT_FUNDRAISERS).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The query, against a database.

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const user = (authUserId: string, displayName: string) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName,
        role: "USER",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await user("auth_alice", "Wanjiru Kamau"),
      bob: await user("auth_bob", "Bob Otieno"),
      carol: await user("auth_carol", "Carol Njeri"),
    };
  });

  return {
    t,
    ids,
    alice: t.withIdentity({ subject: "auth_alice" }),
    bob: t.withIdentity({ subject: "auth_bob" }),
    carol: t.withIdentity({ subject: "auth_carol" }),
  };
}
type World = Awaited<ReturnType<typeof setup>>;

function fundraiser(
  s: World,
  creatorId: Id<"users">,
  over: Partial<Doc<"fundraisers">> = {},
) {
  const now = Date.now();
  return s.t.run((ctx) =>
    ctx.db.insert("fundraisers", {
      creatorId,
      beneficiaryType: "SELF",
      title: "Water for Kajiado",
      story: "A story that is long enough to be a story.",
      type: "COMMUNITY_HARAMBEE",
      goalAmount: 100_000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status: "ACTIVE",
      isPrivate: false,
      isVerified: false,
      createdAt: now,
      updatedAt: now,
      ...over,
    }),
  );
}

// A donation the way the payment paths start it.
function pending(
  s: World,
  fundraiserId: Id<"fundraisers">,
  donorUserId: Id<"users"> | undefined,
  over: Partial<Doc<"donations">> = {},
) {
  const now = Date.now();
  return s.t.run((ctx) =>
    ctx.db.insert("donations", {
      fundraiserId,
      donorUserId,
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES",
      platformFeeRate: 0.05,
      platformFeeAmount: 50,
      netAmount: 950,
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      createdAt: now,
      updatedAt: now,
      ...over,
    }),
  );
}

// Completed through the real path, so the fundraiser is credited as it is in
// production.
async function completed(
  s: World,
  fundraiserId: Id<"fundraisers">,
  donorUserId: Id<"users"> | undefined,
  over: Partial<Doc<"donations">> = {},
) {
  const donationId = await pending(s, fundraiserId, donorUserId, over);
  await s.t.mutation(internal.donations.markDonationCompleted, { donationId });
  return donationId;
}

const refund = (s: World, donationId: Id<"donations">) =>
  s.t.run((ctx) =>
    refundCompletedDonation(ctx, {
      donationId,
      source: "STAFF",
      reason: "Donor paid twice by mistake and asked for it back.",
    }),
  );

const impactOf = (who: { query: T["query"] }) => who.query(api.impact.mine, {});

describe("impact.mine", () => {
  it("is null for someone who isn't signed in, or has no profile yet", async () => {
    const s = await setup();
    expect(await impactOf(s.t)).toBeNull();
    expect(await impactOf(s.t.withIdentity({ subject: "auth_nobody" }))).toBe(
      null,
    );
  });

  it("is zero for someone who has done nothing yet", async () => {
    const s = await setup();
    expect(await impactOf(s.alice)).toEqual({
      givenKes: 0,
      raisedKes: 0,
      totalKes: 0,
      fundraisersSupported: 0,
      donationsReceived: 0,
      complete: true,
    });
  });

  it("counts only donations that went through", async () => {
    const s = await setup();
    const water = await fundraiser(s, s.ids.bob);
    const school = await fundraiser(s, s.ids.bob, { title: "School fees" });

    await completed(s, water, s.ids.alice, { grossAmount: 1000 });
    // None of these is money that reached anyone.
    for (const status of ["PENDING", "FAILED", "CANCELLED"] as const) {
      await pending(s, school, s.ids.alice, { grossAmount: 777, status });
    }
    const refunded = await completed(s, school, s.ids.alice, {
      grossAmount: 5000,
    });
    await refund(s, refunded);
    await settle(s.t);

    const impact = await impactOf(s.alice);
    expect(impact).toMatchObject({
      givenKes: 1000,
      fundraisersSupported: 1,
      totalKes: 1000,
    });
  });

  it("counts a dollar gift by its shilling value, whichever way it was paid", async () => {
    const s = await setup();
    const water = await fundraiser(s, s.ids.bob);
    await completed(s, water, s.ids.alice, { grossAmount: 1000 });

    const paypal = await pending(s, water, s.ids.alice, {
      grossAmount: 3250,
      provider: "PAYPAL",
      paymentMethod: "PAYPAL",
      originalCurrency: "USD",
      originalAmount: 25,
      exchangeRate: 130,
    });
    await s.t.mutation(internal.paypal.completePayPalDonation, {
      donationId: paypal,
      paypalCaptureId: "CAPTURE-1",
    });
    await settle(s.t);

    expect(await impactOf(s.alice)).toMatchObject({
      givenKes: 4250,
      fundraisersSupported: 1,
    });
  });

  it("still counts a gift made anonymously, for the person who made it", async () => {
    const s = await setup();
    const water = await fundraiser(s, s.ids.bob);
    await completed(s, water, s.ids.alice, {
      grossAmount: 400,
      isAnonymous: true,
    });
    expect(await impactOf(s.alice)).toMatchObject({ givenKes: 400 });
  });

  it("counts a gift only for the person who made it", async () => {
    const s = await setup();
    const water = await fundraiser(s, s.ids.bob);
    await completed(s, water, s.ids.alice, { grossAmount: 1000 });
    // A guest gift has nobody to credit it to.
    await completed(s, water, undefined, { grossAmount: 9000 });
    await settle(s.t);

    expect((await impactOf(s.alice))?.givenKes).toBe(1000);
    expect((await impactOf(s.carol))?.givenKes).toBe(0);
  });

  it("adds what their own fundraisers raised, and the gifts they got", async () => {
    const s = await setup();
    const water = await fundraiser(s, s.ids.alice);
    const school = await fundraiser(s, s.ids.alice, { title: "School fees" });
    await completed(s, water, s.ids.bob, { grossAmount: 2000 });
    await completed(s, water, s.ids.carol, { grossAmount: 500 });
    await completed(s, school, s.ids.carol, { grossAmount: 1500 });
    await completed(s, water, undefined, { grossAmount: 1000 });
    await settle(s.t);

    expect(await impactOf(s.alice)).toEqual({
      givenKes: 0,
      raisedKes: 5000,
      totalKes: 5000,
      fundraisersSupported: 0,
      donationsReceived: 4,
      complete: true,
    });
  });

  it("is given plus raised", async () => {
    const s = await setup();
    const mine = await fundraiser(s, s.ids.alice);
    const theirs = await fundraiser(s, s.ids.bob);
    await completed(s, mine, s.ids.bob, { grossAmount: 8000 });
    await completed(s, theirs, s.ids.alice, { grossAmount: 1200 });
    await settle(s.t);

    expect(await impactOf(s.alice)).toMatchObject({
      givenKes: 1200,
      raisedKes: 8000,
      totalKes: 9200,
    });
  });

  it("counts a gift to their own fundraiser once, as raised", async () => {
    const s = await setup();
    const mine = await fundraiser(s, s.ids.alice);
    await completed(s, mine, s.ids.alice, { grossAmount: 3000 });
    await settle(s.t);

    expect(await impactOf(s.alice)).toEqual({
      givenKes: 0,
      raisedKes: 3000,
      totalKes: 3000,
      fundraisersSupported: 0,
      donationsReceived: 1,
      complete: true,
    });
  });

  it("takes a refund back off both sides", async () => {
    const s = await setup();
    const mine = await fundraiser(s, s.ids.alice);
    const theirs = await fundraiser(s, s.ids.bob);
    const received = await completed(s, mine, s.ids.bob, { grossAmount: 8000 });
    const given = await completed(s, theirs, s.ids.alice, {
      grossAmount: 1200,
    });
    await settle(s.t);
    expect((await impactOf(s.alice))?.totalKes).toBe(9200);

    await refund(s, received);
    await settle(s.t);
    expect(await impactOf(s.alice)).toMatchObject({
      raisedKes: 0,
      donationsReceived: 0,
      givenKes: 1200,
    });

    await refund(s, given);
    await settle(s.t);
    expect(await impactOf(s.alice)).toMatchObject({
      givenKes: 0,
      fundraisersSupported: 0,
      totalKes: 0,
    });
  });

  it("keeps what a fundraiser raised whatever became of it afterwards", async () => {
    const s = await setup();
    for (const status of [
      "ACTIVE",
      "COMPLETED",
      "PAUSED",
      "CANCELLED",
    ] as const) {
      await fundraiser(s, s.ids.alice, { status, amountRaised: 1000 });
    }
    expect((await impactOf(s.alice))?.raisedKes).toBe(4000);
  });

  it("never counts another person's fundraisers or gifts, and reveals nobody", async () => {
    const s = await setup();
    const mine = await fundraiser(s, s.ids.alice);
    await fundraiser(s, s.ids.bob, { amountRaised: 99_999, donorCount: 50 });
    await completed(s, mine, s.ids.bob, {
      grossAmount: 1000,
      donorName: "Bob Otieno",
      donorEmail: "bob@example.test",
      message: "Proud to back this.",
    });
    await settle(s.t);

    const impact = await impactOf(s.alice);
    expect(impact).toMatchObject({ raisedKes: 1000, donationsReceived: 1 });
    // Only the five figures and the flag: nothing about who gave.
    expect(Object.keys(impact!).sort()).toEqual([
      "complete",
      "donationsReceived",
      "fundraisersSupported",
      "givenKes",
      "raisedKes",
      "totalKes",
    ]);
    expect(JSON.stringify(impact)).not.toMatch(/Bob|example|Proud/);
  });

  describe("how much it reads", () => {
    it("says the donation figures are the whole story up to the limit", async () => {
      const s = await setup();
      const water = await fundraiser(s, s.ids.bob);
      await s.t.run(async (ctx) => {
        for (let i = 0; i < MAX_IMPACT_DONATIONS; i++) {
          await ctx.db.insert("donations", {
            fundraiserId: water,
            donorUserId: s.ids.alice,
            isAnonymous: false,
            grossAmount: 10,
            currency: "KES",
            platformFeeRate: 0.05,
            platformFeeAmount: 0.5,
            netAmount: 9.5,
            status: "COMPLETED",
            payoutStatus: "PENDING_PAYOUT",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });

      expect(await impactOf(s.alice)).toMatchObject({
        givenKes: MAX_IMPACT_DONATIONS * 10,
        complete: true,
      });
    });

    it("counts the newest donations past the limit, and says it isn't everything", async () => {
      const s = await setup();
      const water = await fundraiser(s, s.ids.bob);
      const insert = (grossAmount: number) =>
        s.t.run((ctx) =>
          ctx.db.insert("donations", {
            fundraiserId: water,
            donorUserId: s.ids.alice,
            isAnonymous: false,
            grossAmount,
            currency: "KES",
            platformFeeRate: 0.05,
            platformFeeAmount: 0,
            netAmount: grossAmount,
            status: "COMPLETED",
            payoutStatus: "PENDING_PAYOUT",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
        );

      await insert(7777); // the oldest
      later();
      for (let i = 0; i < MAX_IMPACT_DONATIONS; i++) await insert(10);

      expect(await impactOf(s.alice)).toMatchObject({
        givenKes: MAX_IMPACT_DONATIONS * 10, // not 7777 more
        complete: false,
      });
    });

    it("does the same for fundraisers", async () => {
      const s = await setup();
      await fundraiser(s, s.ids.alice, { amountRaised: 5000 }); // the oldest
      later();
      for (let i = 0; i < MAX_IMPACT_FUNDRAISERS - 1; i++) {
        await fundraiser(s, s.ids.alice, { amountRaised: 10 });
      }
      // 200 in all: still the whole story.
      expect(await impactOf(s.alice)).toMatchObject({
        raisedKes: 5000 + (MAX_IMPACT_FUNDRAISERS - 1) * 10,
        complete: true,
      });

      later();
      await fundraiser(s, s.ids.alice, { amountRaised: 10 });
      // 201: the oldest is left out.
      expect(await impactOf(s.alice)).toMatchObject({
        raisedKes: MAX_IMPACT_FUNDRAISERS * 10,
        complete: false,
      });
    });

    it("doesn't let failed attempts use up the limit", async () => {
      const s = await setup();
      const water = await fundraiser(s, s.ids.bob);
      await completed(s, water, s.ids.alice, { grossAmount: 1000 });
      later();
      await s.t.run(async (ctx) => {
        for (let i = 0; i < MAX_IMPACT_DONATIONS + 20; i++) {
          await ctx.db.insert("donations", {
            fundraiserId: water,
            donorUserId: s.ids.alice,
            isAnonymous: false,
            grossAmount: 50,
            currency: "KES",
            platformFeeRate: 0.05,
            platformFeeAmount: 0,
            netAmount: 50,
            status: i % 2 ? "FAILED" : "CANCELLED",
            payoutStatus: "NOT_YET_PAYABLE",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      });
      await settle(s.t);

      expect(await impactOf(s.alice)).toMatchObject({
        givenKes: 1000,
        complete: true,
      });
    });
  });
});
