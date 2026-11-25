/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { RECENT_DONATIONS_SHOWN } from "../lib/donation-activity";

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

const START = new Date("2026-11-24T10:00:00Z").getTime();
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const user = (authUserId: string, role: Doc<"users">["role"] = "USER") =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName: authUserId,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });
    const owner = await user("auth_owner");
    const admin = await user("auth_admin", "ADMIN");
    await user("auth_stranger");

    const fundraiser = (extra: Partial<Doc<"fundraisers">> = {}) =>
      ctx.db.insert("fundraisers", {
        creatorId: owner,
        beneficiaryType: "SELF",
        title: "Water for Kajiado",
        story: "A story that is long enough to be a story.",
        type: "COMMUNITY_HARAMBEE",
        goalAmount: 100000,
        currency: "KES",
        amountRaised: 0,
        donorCount: 0,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    return {
      admin,
      fundraiserId: await fundraiser(),
      otherId: await fundraiser({ title: "School fees" }),
      privateId: await fundraiser({ isPrivate: true }),
      draftId: await fundraiser({ status: "DRAFT" }),
      flaggedId: await fundraiser({ isFlagged: true }),
    };
  });

  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "auth_owner" }),
    admin: t.withIdentity({ subject: "auth_admin" }),
    stranger: t.withIdentity({ subject: "auth_stranger" }),
  };
}

type Given = Partial<Doc<"donations">> & { fundraiserId: Id<"fundraisers"> };

/** A donation as the database holds it: every private detail filled in. */
async function addDonation(
  t: Awaited<ReturnType<typeof setup>>["t"],
  given: Given,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("donations", {
      donorName: "Wanjiru Kamau",
      donorEmail: "wanjiru.private@example.test",
      donorPhone: "0712345678",
      message: "A private note to the organizer",
      isAnonymous: false,
      grossAmount: 500,
      currency: "KES",
      platformFeeRate: 0.05,
      platformFeeAmount: 25,
      netAmount: 475,
      status: "COMPLETED",
      payoutStatus: "PENDING_PAYOUT",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
      ...given,
    }),
  );
}

describe("donationActivity.forFundraiser", () => {
  it("gives the totals and the latest donations, newest first", async () => {
    const { t, ids } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(ids.fundraiserId, { amountRaised: 1800, donorCount: 3 }),
    );
    await addDonation(t, {
      fundraiserId: ids.fundraiserId,
      donorName: "Brian Otieno",
      grossAmount: 300,
      completedAt: START - 30 * MINUTE,
    });
    await addDonation(t, {
      fundraiserId: ids.fundraiserId,
      donorName: "Wanjiru Kamau",
      grossAmount: 1000,
      completedAt: START - 5 * MINUTE,
    });
    await addDonation(t, {
      fundraiserId: ids.fundraiserId,
      donorName: "Amina",
      grossAmount: 500,
      completedAt: START - MINUTE,
    });

    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });

    expect(result).toMatchObject({
      amountRaised: 1800,
      goalAmount: 100000,
      donorCount: 3,
    });
    expect(
      result?.recent.map(({ name, amount, at }) => ({ name, amount, at })),
    ).toEqual([
      { name: "Amina", amount: 500, at: START - MINUTE },
      { name: "Wanjiru K.", amount: 1000, at: START - 5 * MINUTE },
      { name: "Brian O.", amount: 300, at: START - 30 * MINUTE },
    ]);
  });

  it("shows only the latest few, not every donation", async () => {
    const { t, ids } = await setup();
    for (let i = 0; i < 12; i++) {
      await addDonation(t, {
        fundraiserId: ids.fundraiserId,
        donorName: `Donor${i}`,
        completedAt: START - (20 - i) * MINUTE,
      });
    }
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(result?.recent).toHaveLength(RECENT_DONATIONS_SHOWN);
    expect(result?.recent.map((d) => d.name)).toEqual([
      "Donor11",
      "Donor10",
      "Donor9",
    ]);
  });

  it("goes by when a donation was paid, not when it was started", async () => {
    const { t, ids } = await setup();
    // Started first, paid last: it is the latest.
    await addDonation(t, {
      fundraiserId: ids.fundraiserId,
      donorName: "Slow Payer",
      createdAt: START - 60 * MINUTE,
      completedAt: START,
    });
    await addDonation(t, {
      fundraiserId: ids.fundraiserId,
      donorName: "Quick Payer",
      createdAt: START - MINUTE,
      completedAt: START - MINUTE,
    });
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(result?.recent.map((d) => d.name)).toEqual(["Slow P.", "Quick P."]);
  });

  it("leaves out donations that are not paid, or were refunded", async () => {
    const { t, ids } = await setup();
    for (const status of [
      "PENDING",
      "FAILED",
      "CANCELLED",
      "REFUNDED",
    ] as const) {
      await addDonation(t, {
        fundraiserId: ids.fundraiserId,
        status,
        donorName: `Not Counted ${status}`,
      });
    }
    await addDonation(t, {
      fundraiserId: ids.fundraiserId,
      donorName: "Counted One",
    });
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(result?.recent.map((d) => d.name)).toEqual(["Counted O."]);
  });

  it("leaves out donations to other fundraisers", async () => {
    const { t, ids } = await setup();
    await addDonation(t, { fundraiserId: ids.otherId, donorName: "Elsewhere" });
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(result?.recent).toEqual([]);
  });

  it("has an empty list, and the totals, when nothing has been given yet", async () => {
    const { t, ids } = await setup();
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(result).toEqual({
      amountRaised: 0,
      goalAmount: 100000,
      donorCount: 0,
      recent: [],
    });
  });

  describe("who is named", () => {
    it("shows an anonymous gift as Anonymous donor, with no trace of the name", async () => {
      const { t, ids } = await setup();
      await addDonation(t, {
        fundraiserId: ids.fundraiserId,
        isAnonymous: true,
        donorName: "Wanjiru Kamau",
      });
      const result = await t.query(api.donationActivity.forFundraiser, {
        fundraiserId: ids.fundraiserId,
      });
      expect(result?.recent[0].name).toBe("Anonymous donor");
      expect(JSON.stringify(result)).not.toContain("Wanjiru");
    });

    it("says Someone when the donor gave no name, even if they have an account", async () => {
      const { t, ids } = await setup();
      const donorUserId = await t.run(
        async (ctx) => (await ctx.db.query("users").first())!._id,
      );
      await addDonation(t, {
        fundraiserId: ids.fundraiserId,
        donorName: undefined,
        donorUserId,
      });
      const result = await t.query(api.donationActivity.forFundraiser, {
        fundraiserId: ids.fundraiserId,
      });
      expect(result?.recent[0].name).toBe("Someone");
    });

    it("does not show an email or a phone number that was stored as a name", async () => {
      const { t, ids } = await setup();
      await addDonation(t, {
        fundraiserId: ids.fundraiserId,
        donorName: "jane@example.com",
      });
      await addDonation(t, {
        fundraiserId: ids.fundraiserId,
        donorName: "0722 000 111",
      });
      const result = await t.query(api.donationActivity.forFundraiser, {
        fundraiserId: ids.fundraiserId,
      });
      expect(result?.recent.map((d) => d.name)).toEqual(["Someone", "Someone"]);
    });
  });

  // This query is open to anyone who can see the fundraiser.
  it("returns only a name, an amount and a time: nothing private about a donor", async () => {
    const { t, ids } = await setup();
    await addDonation(t, { fundraiserId: ids.fundraiserId });
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(Object.keys(result?.recent[0] ?? {}).sort()).toEqual([
      "amount",
      "at",
      "id",
      "name",
    ]);
    const everything = JSON.stringify(result);
    for (const secret of [
      "wanjiru.private@example.test",
      "0712345678",
      "A private note",
      "Kamau",
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  describe("a fundraiser that is not public", () => {
    it.each(["privateId", "draftId", "flaggedId"] as const)(
      "shows nothing about %s to a signed-out visitor or a stranger",
      async (which) => {
        const { t, ids, stranger } = await setup();
        await addDonation(t, { fundraiserId: ids[which] });
        const args = { fundraiserId: ids[which] };
        expect(await t.query(api.donationActivity.forFundraiser, args)).toBe(
          null,
        );
        expect(
          await stranger.query(api.donationActivity.forFundraiser, args),
        ).toBe(null);
      },
    );

    it("shows it to its creator and to staff", async () => {
      const { t, ids, owner, admin } = await setup();
      await addDonation(t, { fundraiserId: ids.privateId });
      const args = { fundraiserId: ids.privateId };
      expect(
        (await owner.query(api.donationActivity.forFundraiser, args))?.recent,
      ).toHaveLength(1);
      expect(
        (await admin.query(api.donationActivity.forFundraiser, args))?.recent,
      ).toHaveLength(1);
    });

    it("gives null for a fundraiser that no longer exists", async () => {
      const { t, ids } = await setup();
      await t.run((ctx) => ctx.db.delete(ids.otherId));
      expect(
        await t.query(api.donationActivity.forFundraiser, {
          fundraiserId: ids.otherId,
        }),
      ).toBe(null);
    });
  });
});

// From the donate form to what the page shows, so that a payment really does
// add up on the page without anything being done by hand.
describe("a donation, from start to what the page shows", () => {
  const checkout = (
    t: Awaited<ReturnType<typeof setup>>["t"],
    fundraiserId: Id<"fundraisers">,
    donorName: string | undefined,
    grossAmount = 1000,
    isAnonymous = false,
  ) =>
    t.mutation(internal.donations.createPendingDonation, {
      fundraiserId,
      grossAmount,
      currency: "KES",
      isAnonymous,
      donorName,
      donorEmail: "payer@example.test",
    });

  it("adds to the total and the list once it is paid, and not before", async () => {
    const { t, ids } = await setup();
    const donationId = await checkout(
      t,
      ids.fundraiserId,
      "  Wanjiru   Kamau ",
    );

    const before = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(before).toMatchObject({
      amountRaised: 0,
      donorCount: 0,
      recent: [],
    });

    await t.mutation(internal.donations.markDonationCompleted, { donationId });

    const after = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(after).toMatchObject({ amountRaised: 1000, donorCount: 1 });
    expect(after?.recent).toEqual([
      {
        id: donationId,
        name: "Wanjiru K.",
        amount: 1000,
        at: expect.any(Number),
      },
    ]);
    // Paid just now. The test clock moves on a little with each call, so this
    // is a moment's window rather than one exact millisecond.
    const paidAt = after?.recent[0].at ?? 0;
    expect(paidAt).toBeGreaterThanOrEqual(START);
    expect(paidAt).toBeLessThan(START + 1000);

    // A second payment comes in a minute later.
    vi.setSystemTime(START + MINUTE);
    const second = await checkout(t, ids.fundraiserId, "Brian", 250);
    await t.mutation(internal.donations.markDonationCompleted, {
      donationId: second,
    });
    const latest = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(latest).toMatchObject({ amountRaised: 1250, donorCount: 2 });
    expect(latest?.recent.map((d) => d.name)).toEqual(["Brian", "Wanjiru K."]);
  });

  it("does not add a payment twice when the provider repeats its notification", async () => {
    const { t, ids } = await setup();
    const donationId = await checkout(t, ids.fundraiserId, "Amina");
    await t.mutation(internal.donations.markDonationCompleted, { donationId });
    await t.mutation(internal.donations.markDonationCompleted, { donationId });
    const result = await t.query(api.donationActivity.forFundraiser, {
      fundraiserId: ids.fundraiserId,
    });
    expect(result).toMatchObject({ amountRaised: 1000, donorCount: 1 });
    expect(result?.recent).toHaveLength(1);
  });

  describe("the name that is stored", () => {
    const storedName = async (
      t: Awaited<ReturnType<typeof setup>>["t"],
      id: Id<"donations">,
    ) => (await t.run((ctx) => ctx.db.get(id)))?.donorName;

    it("is tidied", async () => {
      const { t, ids } = await setup();
      const id = await checkout(t, ids.fundraiserId, "  Wanjiru \n  Kamau  ");
      expect(await storedName(t, id)).toBe("Wanjiru Kamau");
    });

    it.each(["jane@example.com", "0712345678", "https://spam.example"])(
      "is dropped when it is really %s",
      async (typed) => {
        const { t, ids } = await setup();
        const id = await checkout(t, ids.fundraiserId, typed);
        expect(await storedName(t, id)).toBeUndefined();
      },
    );

    it("is kept for an anonymous gift, but never shown", async () => {
      const { t, ids } = await setup();
      const id = await checkout(
        t,
        ids.fundraiserId,
        "Wanjiru Kamau",
        500,
        true,
      );
      expect(await storedName(t, id)).toBe("Wanjiru Kamau");
      await t.mutation(internal.donations.markDonationCompleted, {
        donationId: id,
      });
      const result = await t.query(api.donationActivity.forFundraiser, {
        fundraiserId: ids.fundraiserId,
      });
      expect(result?.recent[0].name).toBe("Anonymous donor");
    });

    it("is tidied for PayPal donations too", async () => {
      const { t, ids } = await setup();
      const make = (donorName: string) =>
        t.mutation(internal.paypal.createPendingPayPalDonation, {
          fundraiserId: ids.fundraiserId,
          donorName,
          donorEmail: "payer@example.test",
          isAnonymous: false,
          grossAmountKes: 1300,
          platformFeeAmountKes: 65,
          netAmountKes: 1235,
          platformFeeRate: 0.05,
        });
      expect(await storedName(t, await make("  Otieno   Odhiambo "))).toBe(
        "Otieno Odhiambo",
      );
      expect(await storedName(t, await make("jane@example.com"))).toBe(
        undefined,
      );
    });
  });
});
