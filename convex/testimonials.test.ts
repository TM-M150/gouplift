/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_TESTIMONIAL_LENGTH,
  publicAuthorName,
  resolveTestimonialOptIn,
} from "../lib/testimonials";

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
  vi.setSystemTime(new Date("2026-11-08T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const user = (
      authUserId: string,
      displayName: string,
      role: Doc<"users">["role"] = "USER",
    ) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });
    const approveKyc = (userId: Id<"users">) =>
      ctx.db.insert("kycSubmissions", {
        userId,
        requestedTier: 1,
        status: "APPROVED",
        submittedAt: now,
      });

    const alice = await user("auth_alice", "Wanjiru Kamau"); // verified
    const bob = await user("auth_bob", "Bob Otieno"); // not verified
    const carol = await user("auth_carol", "Carol Njeri"); // verified, a second author
    const mod = await user("auth_mod", "Mo Derator", "MODERATOR");
    const owner = await user("auth_owner", "Fund Raiser");
    const aliceKyc = await approveKyc(alice);
    await approveKyc(carol);

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
      alice,
      bob,
      carol,
      mod,
      aliceKyc,
      fundraiserId: await fundraiser(),
      privateFundraiserId: await fundraiser({ isPrivate: true }),
      flaggedFundraiserId: await fundraiser({ isFlagged: true }),
      pausedFundraiserId: await fundraiser({ status: "PAUSED" }),
    };
  });

  return {
    t,
    ids,
    alice: t.withIdentity({ subject: "auth_alice" }),
    bob: t.withIdentity({ subject: "auth_bob" }),
    carol: t.withIdentity({ subject: "auth_carol" }),
    mod: t.withIdentity({ subject: "auth_mod" }),
  };
}

type S = Awaited<ReturnType<typeof setup>>;

/** A donation that is already paid, as the payment paths leave it. */
function insertDonation(
  s: S,
  overrides: Partial<Doc<"donations">> = {},
): Promise<Id<"donations">> {
  return s.t.run((ctx) =>
    ctx.db.insert("donations", {
      fundraiserId: s.ids.fundraiserId,
      donorUserId: s.ids.alice,
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES",
      message: "Proud to back this. Keep going!",
      shareAsTestimonial: true,
      platformFeeRate: 0.0425,
      platformFeeAmount: 42.5,
      netAmount: 957.5,
      status: "COMPLETED",
      payoutStatus: "PENDING_PAYOUT",
      completedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    }),
  );
}

const queue = (s: S, donationId: Id<"donations">) =>
  s.t.mutation(internal.testimonials.queueFromDonation, { donationId });

const allTestimonials = (s: S) =>
  s.t.run((ctx) => ctx.db.query("testimonials").collect());

/** A donation turned into an approved testimonial, ready to show. */
async function approvedTestimonial(
  s: S,
  donationOverrides: Partial<Doc<"donations">> = {},
) {
  const donationId = await insertDonation(s, donationOverrides);
  await queue(s, donationId);
  const [row] = (await allTestimonials(s)).filter(
    (r) => r.donationId === donationId,
  );
  await s.mod.mutation(api.testimonials.approveTestimonial, {
    testimonialId: row._id,
  });
  return { donationId, testimonialId: row._id };
}

describe("publicAuthorName", () => {
  it("shows the first name and the last initial, never the full name", () => {
    expect(publicAuthorName("Wanjiru Kamau")).toBe("Wanjiru K.");
    expect(publicAuthorName("  Mary  Wanjiku   Kamau ")).toBe("Mary K.");
    expect(publicAuthorName("wanjiru")).toBe("wanjiru");
    expect(publicAuthorName("Zawadi ōkafor")).toBe("Zawadi Ō.");
  });

  it("falls back to a neutral label for a blank name", () => {
    expect(publicAuthorName("   ")).toBe("A GoUplift donor");
  });
});

describe("resolveTestimonialOptIn", () => {
  const base = {
    requested: true,
    signedIn: true,
    isAnonymous: false,
    message: "Great cause",
  };

  it("is on only for a signed-in, non-anonymous donor with a message who asked", () => {
    expect(resolveTestimonialOptIn(base)).toBe(true);
  });

  it("ignores the flag for guests, anonymous donors and empty messages", () => {
    expect(resolveTestimonialOptIn({ ...base, signedIn: false })).toBe(false);
    expect(resolveTestimonialOptIn({ ...base, isAnonymous: true })).toBe(false);
    expect(resolveTestimonialOptIn({ ...base, message: "   " })).toBe(false);
    expect(resolveTestimonialOptIn({ ...base, message: undefined })).toBe(false);
  });

  it("is off unless the donor explicitly asked", () => {
    expect(resolveTestimonialOptIn({ ...base, requested: undefined })).toBe(
      false,
    );
    expect(resolveTestimonialOptIn({ ...base, requested: false })).toBe(false);
  });
});

describe("queueFromDonation", () => {
  it("queues a verified donor's opted-in message as PENDING, under a short name", async () => {
    const s = await setup();
    const donationId = await insertDonation(s);

    await queue(s, donationId);

    const rows = await allTestimonials(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      donationId,
      authorUserId: s.ids.alice,
      fundraiserId: s.ids.fundraiserId,
      authorName: "Wanjiru K.",
      message: "Proud to back this. Keep going!",
      status: "PENDING",
    });
  });

  it("does nothing when the donor didn't opt in", async () => {
    const s = await setup();
    await queue(s, await insertDonation(s, { shareAsTestimonial: undefined }));
    await queue(s, await insertDonation(s, { shareAsTestimonial: false }));
    expect(await allTestimonials(s)).toHaveLength(0);
  });

  it("never queues a guest, even if the flag is somehow set", async () => {
    const s = await setup();
    await queue(s, await insertDonation(s, { donorUserId: undefined }));
    expect(await allTestimonials(s)).toHaveLength(0);
  });

  it("never queues someone without approved verification", async () => {
    const s = await setup();
    await queue(s, await insertDonation(s, { donorUserId: s.ids.bob }));
    expect(await allTestimonials(s)).toHaveLength(0);
  });

  it("doesn't count a submission that is still waiting or was rejected", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("kycSubmissions", {
        userId: s.ids.bob,
        requestedTier: 1,
        status: "PENDING_REVIEW",
        submittedAt: Date.now(),
      });
      await ctx.db.insert("kycSubmissions", {
        userId: s.ids.bob,
        requestedTier: 1,
        status: "REJECTED",
        submittedAt: Date.now(),
      });
    });
    await queue(s, await insertDonation(s, { donorUserId: s.ids.bob }));
    expect(await allTestimonials(s)).toHaveLength(0);
  });

  it("skips anonymous donations, unpaid ones and empty or over-long messages", async () => {
    const s = await setup();
    await queue(s, await insertDonation(s, { isAnonymous: true }));
    await queue(s, await insertDonation(s, { status: "PENDING" }));
    await queue(s, await insertDonation(s, { status: "REFUNDED" }));
    await queue(s, await insertDonation(s, { message: "   " }));
    await queue(s, await insertDonation(s, { message: undefined }));
    await queue(
      s,
      await insertDonation(s, { message: "x".repeat(MAX_TESTIMONIAL_LENGTH + 1) }),
    );
    expect(await allTestimonials(s)).toHaveLength(0);
  });

  it("is safe to run twice for the same donation", async () => {
    const s = await setup();
    const donationId = await insertDonation(s);
    await queue(s, donationId);
    await queue(s, donationId);
    expect(await allTestimonials(s)).toHaveLength(1);
  });

  it("is queued by both payment paths once the donation completes", async () => {
    const s = await setup();
    const pending = (extra: Partial<Doc<"donations">> = {}) =>
      insertDonation(s, { status: "PENDING", ...extra });

    const sasapay = await pending();
    await s.t.mutation(internal.donations.markDonationCompleted, {
      donationId: sasapay,
    });

    const paypal = await pending({ donorUserId: s.ids.carol });
    await s.t.mutation(internal.paypal.completePayPalDonation, {
      donationId: paypal,
      paypalCaptureId: "CAPTURE-1",
    });

    // And a donation that didn't opt in queues nothing.
    const plain = await pending({ shareAsTestimonial: undefined });
    await s.t.mutation(internal.donations.markDonationCompleted, {
      donationId: plain,
    });

    await settle(s.t);

    const rows = await allTestimonials(s);
    expect(rows.map((r) => r.donationId).sort()).toEqual(
      [sasapay, paypal].sort(),
    );
  });

  it("can't hold up the payment: the donation completes even when nothing is queued", async () => {
    const s = await setup();
    const donationId = await insertDonation(s, {
      status: "PENDING",
      donorUserId: s.ids.bob, // opted in but not verified
    });
    await s.t.mutation(internal.donations.markDonationCompleted, { donationId });
    await settle(s.t);

    const donation = await s.t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.status).toBe("COMPLETED");
    expect(await allTestimonials(s)).toHaveLength(0);
  });
});

describe("createPendingDonation", () => {
  it("records the opt-in flag it was given", async () => {
    const s = await setup();
    const donationId = await s.t.mutation(
      internal.donations.createPendingDonation,
      {
        fundraiserId: s.ids.fundraiserId,
        grossAmount: 500,
        currency: "KES",
        message: "Go well",
        shareAsTestimonial: true,
        isAnonymous: false,
        donorUserId: s.ids.alice,
      },
    );
    const donation = await s.t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.shareAsTestimonial).toBe(true);
  });
});

describe("moderation", () => {
  async function queued(s: S) {
    const donationId = await insertDonation(s);
    await queue(s, donationId);
    const [row] = await allTestimonials(s);
    return row._id;
  }

  it("shows the queue to staff only", async () => {
    const s = await setup();
    await queued(s);

    const forStaff = await s.mod.query(api.testimonials.listForReview, {
      status: "PENDING",
    });
    expect(forStaff).toHaveLength(1);
    expect(forStaff[0]).toMatchObject({
      authorName: "Wanjiru K.",
      fundraiserTitle: "Water for Kajiado",
      blocker: null,
    });

    for (const who of [s.alice, s.bob, s.t]) {
      expect(
        await who.query(api.testimonials.listForReview, { status: "PENDING" }),
      ).toEqual([]);
    }
  });

  it("lets only staff approve, and records who and when in the audit log", async () => {
    const s = await setup();
    const id = await queued(s);

    await expect(
      s.alice.mutation(api.testimonials.approveTestimonial, {
        testimonialId: id,
      }),
    ).rejects.toThrow("permission");
    await expect(
      s.t.mutation(api.testimonials.approveTestimonial, { testimonialId: id }),
    ).rejects.toThrow("signed in");

    await s.mod.mutation(api.testimonials.approveTestimonial, {
      testimonialId: id,
      note: "  Reads fine  ",
    });

    const row = await s.t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({
      status: "APPROVED",
      reviewedBy: s.ids.mod,
      reviewNote: "Reads fine",
    });
    // Approved and reviewed in the same instant.
    expect(row?.approvedAt).toBeDefined();
    expect(row?.approvedAt).toBe(row?.reviewedAt);

    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: "TESTIMONIAL_APPROVED",
      actorId: s.ids.mod,
      testimonialId: id,
      statusBefore: "PENDING",
      statusAfter: "APPROVED",
    });
  });

  it("only approves a testimonial that is waiting", async () => {
    const s = await setup();
    const id = await queued(s);
    await s.mod.mutation(api.testimonials.approveTestimonial, {
      testimonialId: id,
    });
    await expect(
      s.mod.mutation(api.testimonials.approveTestimonial, {
        testimonialId: id,
      }),
    ).rejects.toThrow("waiting for review");
  });

  it("refuses to approve when the donation was refunded or verification lapsed", async () => {
    const s = await setup();

    const refunded = await insertDonation(s);
    await queue(s, refunded);
    await s.t.run((ctx) => ctx.db.patch(refunded, { status: "REFUNDED" }));
    const [first] = await allTestimonials(s);
    await expect(
      s.mod.mutation(api.testimonials.approveTestimonial, {
        testimonialId: first._id,
      }),
    ).rejects.toThrow("refunded");

    const lapsed = await insertDonation(s, { donorUserId: s.ids.carol });
    await queue(s, lapsed);
    const carolRow = (await allTestimonials(s)).find(
      (r) => r.donationId === lapsed,
    )!;
    await s.t.run(async (ctx) => {
      const sub = await ctx.db
        .query("kycSubmissions")
        .withIndex("by_userId_and_status", (q) =>
          q.eq("userId", s.ids.carol).eq("status", "APPROVED"),
        )
        .first();
      await ctx.db.patch(sub!._id, { status: "REJECTED" });
    });
    await expect(
      s.mod.mutation(api.testimonials.approveTestimonial, {
        testimonialId: carolRow._id,
      }),
    ).rejects.toThrow("verification");

    // The queue says so too, so a moderator isn't left guessing.
    const rows = await s.mod.query(api.testimonials.listForReview, {
      status: "PENDING",
    });
    expect(rows.every((r) => r.blocker !== null)).toBe(true);
  });

  it("needs a real reason to reject, and logs it", async () => {
    const s = await setup();
    const id = await queued(s);

    await expect(
      s.mod.mutation(api.testimonials.rejectTestimonial, {
        testimonialId: id,
        reason: "no",
      }),
    ).rejects.toThrow("at least");
    await expect(
      s.alice.mutation(api.testimonials.rejectTestimonial, {
        testimonialId: id,
        reason: "Contains a phone number",
      }),
    ).rejects.toThrow("permission");

    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId: id,
      reason: "Contains a phone number",
    });

    expect(await s.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      status: "REJECTED",
      reviewNote: "Contains a phone number",
    });
    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log[0]).toMatchObject({
      action: "TESTIMONIAL_REJECTED",
      statusBefore: "PENDING",
      statusAfter: "REJECTED",
    });
  });

  it("lets staff take an approved testimonial down", async () => {
    const s = await setup();
    const { testimonialId } = await approvedTestimonial(s);
    expect(await s.t.query(api.testimonials.listPublic, {})).toHaveLength(1);

    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId,
      reason: "A complaint from the fundraiser",
    });

    expect(await s.t.query(api.testimonials.listPublic, {})).toHaveLength(0);
    const row = await s.t.run((ctx) => ctx.db.get(testimonialId));
    expect(row?.status).toBe("REJECTED");
    expect(row?.approvedAt).toBeUndefined();
    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log.at(-1)).toMatchObject({
      statusBefore: "APPROVED",
      statusAfter: "REJECTED",
    });
  });
});

describe("withdrawTestimonial and listMine", () => {
  it("lets the author withdraw, on show or waiting, and nobody else", async () => {
    const s = await setup();
    const shown = await approvedTestimonial(s);
    const waitingDonation = await insertDonation(s);
    await queue(s, waitingDonation);
    const waiting = (await allTestimonials(s)).find(
      (r) => r.donationId === waitingDonation,
    )!;

    await expect(
      s.carol.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: shown.testimonialId,
      }),
    ).rejects.toThrow("not found");
    await expect(
      s.t.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: shown.testimonialId,
      }),
    ).rejects.toThrow("signed in");

    await s.alice.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId: shown.testimonialId,
    });
    await s.alice.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId: waiting._id,
    });

    expect(await s.t.query(api.testimonials.listPublic, {})).toHaveLength(0);
    await expect(
      s.alice.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: waiting._id,
      }),
    ).rejects.toThrow("isn't on show");
  });

  it("lists only the signed-in person's own testimonials", async () => {
    const s = await setup();
    await approvedTestimonial(s);
    await approvedTestimonial(s, { donorUserId: s.ids.carol });

    const mine = await s.alice.query(api.testimonials.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      status: "APPROVED",
      fundraiserTitle: "Water for Kajiado",
    });
    expect(await s.bob.query(api.testimonials.listMine, {})).toEqual([]);
    expect(await s.t.query(api.testimonials.listMine, {})).toEqual([]);
  });
});

describe("listPublic", () => {
  it("is empty until something is approved", async () => {
    const s = await setup();
    expect(await s.t.query(api.testimonials.listPublic, {})).toEqual([]);

    // Waiting, rejected and withdrawn ones are never public.
    await queue(s, await insertDonation(s));
    expect(await s.t.query(api.testimonials.listPublic, {})).toEqual([]);
  });

  it("shows an approved testimonial to anyone, signed in or not", async () => {
    const s = await setup();
    const { testimonialId } = await approvedTestimonial(s);

    const list = await s.t.query(api.testimonials.listPublic, {});
    expect(list).toEqual([
      {
        _id: testimonialId,
        message: "Proud to back this. Keep going!",
        authorName: "Wanjiru K.",
        fundraiserId: s.ids.fundraiserId,
        fundraiserTitle: "Water for Kajiado",
        approvedAt: expect.any(Number),
      },
    ]);
  });

  it("exposes nothing private: no email, amount, donor id or full name", async () => {
    const s = await setup();
    await approvedTestimonial(s);
    const [row] = await s.t.query(api.testimonials.listPublic, {});
    const text = JSON.stringify(row);
    expect(Object.keys(row).sort()).toEqual([
      "_id",
      "approvedAt",
      "authorName",
      "fundraiserId",
      "fundraiserTitle",
      "message",
    ]);
    expect(text).not.toContain("Kamau");
    expect(text).not.toContain("example.test");
  });

  it("drops a testimonial whose donation was refunded", async () => {
    const s = await setup();
    const { donationId } = await approvedTestimonial(s);
    await s.t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));
    expect(await s.t.query(api.testimonials.listPublic, {})).toEqual([]);
  });

  it("drops a testimonial once its author is no longer verified", async () => {
    const s = await setup();
    await approvedTestimonial(s);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.aliceKyc, { status: "REJECTED" }),
    );
    expect(await s.t.query(api.testimonials.listPublic, {})).toEqual([]);
  });

  it("drops testimonials on a fundraiser that is private, flagged or not open", async () => {
    const s = await setup();
    for (const fundraiserId of [
      s.ids.privateFundraiserId,
      s.ids.flaggedFundraiserId,
      s.ids.pausedFundraiserId,
    ]) {
      await approvedTestimonial(s, { fundraiserId });
    }
    expect(await s.t.query(api.testimonials.listPublic, {})).toEqual([]);

    // A finished campaign is still a campaign worth quoting.
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { status: "COMPLETED" }),
    );
    await approvedTestimonial(s);
    expect(await s.t.query(api.testimonials.listPublic, {})).toHaveLength(1);
  });

  it("shows the newest first and at most six", async () => {
    const s = await setup();
    const made: Id<"testimonials">[] = [];
    for (let i = 0; i < 8; i++) {
      vi.setSystemTime(Date.now() + 60_000);
      made.push(
        (await approvedTestimonial(s, { message: `Message ${i}` }))
          .testimonialId,
      );
    }

    const list = await s.t.query(api.testimonials.listPublic, {});
    expect(list).toHaveLength(6);
    expect(list.map((r) => r._id)).toEqual(made.slice(2).reverse());
  });

  it("still fills the list when some recent ones no longer qualify", async () => {
    const s = await setup();
    const refunded: Id<"donations">[] = [];
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(Date.now() + 60_000);
      refunded.push((await approvedTestimonial(s)).donationId);
    }
    vi.setSystemTime(Date.now() + 60_000);
    await approvedTestimonial(s, { donorUserId: s.ids.carol });
    for (const donationId of refunded) {
      await s.t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));
    }
    expect(await s.t.query(api.testimonials.listPublic, {})).toHaveLength(1);
  });
});
