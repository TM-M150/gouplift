/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  DONATIONS_CLOSED_MESSAGE,
  isAcceptingDonations,
} from "./lib/donationGate";

// The real auth component needs a running Better Auth deployment. Checkout
// only needs `safeGetAuthUser`, so it reads the identity convex-test attaches.
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
type Status = Doc<"fundraisers">["status"];

const ALL_STATUSES: Status[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
];
const CLOSED_STATUSES = ALL_STATUSES.filter((s) => s !== "ACTIVE");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const creator = await t.run((ctx) =>
    ctx.db.insert("users", {
      authUserId: "auth_creator",
      email: "creator@example.test",
      displayName: "Creator",
      role: "USER",
      isPrivate: false,
      isVerified: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return { t, creator };
}

function makeFundraiser(t: T, creator: Id<"users">, status: Status) {
  return t.run((ctx) =>
    ctx.db.insert("fundraisers", {
      creatorId: creator,
      beneficiaryType: "SELF",
      title: "Water for Kajiado",
      story: "A story that is long enough to be a story.",
      type: "COMMUNITY_HARAMBEE",
      goalAmount: 100000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status,
      isPrivate: false,
      isVerified: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

const sasapayDonation = (fundraiserId: Id<"fundraisers">) => ({
  fundraiserId,
  grossAmount: 1000,
  currency: "KES" as const,
  isAnonymous: false,
});

const paypalDonation = (fundraiserId: Id<"fundraisers">) => ({
  fundraiserId,
  isAnonymous: false,
  grossAmountKes: 1300,
  platformFeeAmountKes: 55,
  netAmountKes: 1245,
  platformFeeRate: 0.0425,
});

const donationCount = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("donations").collect()).length);

describe("isAcceptingDonations", () => {
  it("is true only for an ACTIVE fundraiser", () => {
    for (const status of ALL_STATUSES) {
      expect(isAcceptingDonations({ status })).toBe(status === "ACTIVE");
    }
  });

  it("is false when there is no fundraiser", () => {
    expect(isAcceptingDonations(null)).toBe(false);
  });
});

describe("creating a SasaPay donation", () => {
  it("works for an active fundraiser", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "ACTIVE");

    await t.mutation(
      internal.donations.createPendingDonation,
      sasapayDonation(fundraiserId),
    );

    expect(await donationCount(t)).toBe(1);
  });

  it.each(CLOSED_STATUSES)("is refused when the fundraiser is %s", async (status) => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, status);

    await expect(
      t.mutation(
        internal.donations.createPendingDonation,
        sasapayDonation(fundraiserId),
      ),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);
    expect(await donationCount(t)).toBe(0);
  });

  it("is refused when the fundraiser no longer exists", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "ACTIVE");
    await t.run((ctx) => ctx.db.delete(fundraiserId));

    await expect(
      t.mutation(
        internal.donations.createPendingDonation,
        sasapayDonation(fundraiserId),
      ),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);
    expect(await donationCount(t)).toBe(0);
  });
});

describe("creating a PayPal donation", () => {
  it("works for an active fundraiser", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "ACTIVE");

    await t.mutation(
      internal.paypal.createPendingPayPalDonation,
      paypalDonation(fundraiserId),
    );

    expect(await donationCount(t)).toBe(1);
  });

  it.each(CLOSED_STATUSES)("is refused when the fundraiser is %s", async (status) => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, status);

    await expect(
      t.mutation(
        internal.paypal.createPendingPayPalDonation,
        paypalDonation(fundraiserId),
      ),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);
    expect(await donationCount(t)).toBe(0);
  });

  it("is refused when the fundraiser no longer exists", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "ACTIVE");
    await t.run((ctx) => ctx.db.delete(fundraiserId));

    await expect(
      t.mutation(
        internal.paypal.createPendingPayPalDonation,
        paypalDonation(fundraiserId),
      ),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);
  });
});

// The whole checkout action, the way the donate button calls it: the donor
// gets the plain message, nothing is created, and the failed attempt doesn't
// use up their hourly allowance.
describe("starting checkout for a closed fundraiser", () => {
  it("SasaPay: tells the donor, creates nothing, keeps their allowance", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "PAUSED");

    await expect(
      t.action(api.donations.startDonationCheckout, {
        fundraiserId,
        grossAmount: 500,
        isAnonymous: false,
        donorEmail: "donor@example.test",
        origin: "http://localhost:3000",
      }),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);

    expect(await donationCount(t)).toBe(0);
    const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(limits).toHaveLength(0);
  });

  it("PayPal: tells the donor, creates nothing, keeps their allowance", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "REJECTED");
    // A fresh cached rate, so the action never reaches for the network.
    await t.run((ctx) =>
      ctx.db.insert("fxRates", {
        pair: "USD_KES",
        rate: 130,
        fetchedAt: Date.now(),
      }),
    );

    await expect(
      t.action(api.paypal.startPayPalCheckout, {
        fundraiserId,
        amountUsd: 10,
        isAnonymous: false,
        donorEmail: "donor@example.test",
        origin: "http://localhost:3000",
      }),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);

    expect(await donationCount(t)).toBe(0);
    const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(limits).toHaveLength(0);
  });

  it("gives the same answer for a fundraiser that doesn't exist", async () => {
    const { t, creator } = await setup();
    const fundraiserId = await makeFundraiser(t, creator, "ACTIVE");
    await t.run((ctx) => ctx.db.delete(fundraiserId));

    await expect(
      t.action(api.donations.startDonationCheckout, {
        fundraiserId,
        grossAmount: 500,
        isAnonymous: false,
        donorEmail: "donor@example.test",
        origin: "http://localhost:3000",
      }),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);
  });
});
