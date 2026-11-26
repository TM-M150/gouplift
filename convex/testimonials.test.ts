/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  checkTestimonial,
  MAX_RATING,
  MAX_RECOMMENDATION_LENGTH,
  MAX_TESTIMONIAL_LENGTH,
  MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY,
  MIN_RATING,
  MIN_TESTIMONIAL_LENGTH,
  publicAuthorName,
  TESTIMONIAL_RATE_WINDOW_MS,
} from "../lib/testimonials";

// The real auth component needs a running Better Auth deployment. These tests
// only need `safeGetAuthUser`, so it reads the identity convex-test attaches.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject, emailVerified: true } : null;
    },
  },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const GOOD = "GoUplift made it easy to raise money for our borehole.";
const NOTE = "Please put the M-Pesa receipt number in the donor emails.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-08T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const later = (ms = 60_000) => vi.setSystemTime(Date.now() + ms);

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
    const carol = await user("auth_carol", "Carol Njeri"); // verified
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
type Who = S["alice"];

/** Someone else with an account, verified or not. */
async function newUser(s: S, name: string, verified: boolean) {
  const id = await s.t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authUserId: `auth_${name}`,
      email: `${name}@example.test`,
      displayName: `${name} Wangari`,
      role: "USER",
      isPrivate: false,
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    if (verified) {
      await ctx.db.insert("kycSubmissions", {
        userId,
        requestedTier: 1,
        status: "APPROVED",
        submittedAt: now,
      });
    }
    return userId;
  });
  return { id, who: s.t.withIdentity({ subject: `auth_${name}` }) };
}

const save = (
  who: Who,
  input: { rating?: number; message?: string; recommendation?: string } = {},
) =>
  who.mutation(api.testimonials.saveMine, {
    rating: 5,
    message: GOOD,
    recommendation: NOTE,
    ...input,
  });

const allRows = (s: S) =>
  s.t.run((ctx) => ctx.db.query("testimonials").collect());

const profileRow = (s: S, userId: Id<"users">) =>
  s.t.run((ctx) =>
    ctx.db
      .query("testimonials")
      .withIndex("by_authorUserId_and_source", (q) =>
        q.eq("authorUserId", userId).eq("source", "PROFILE"),
      )
      .unique(),
  );

const versionOf = (row: Doc<"testimonials">) => row.editedAt ?? row.createdAt;

/** The version staff would be reading, as the queue gives it. */
const versionNow = async (s: S, testimonialId: Id<"testimonials">) =>
  versionOf((await s.t.run((ctx) => ctx.db.get(testimonialId)))!);

const approve = async (s: S, testimonialId: Id<"testimonials">) => {
  await s.mod.mutation(api.testimonials.approveTestimonial, {
    testimonialId,
    version: await versionNow(s, testimonialId),
  });
};

/** A testimonial written from the profile, then approved. */
async function approvedBy(s: S, who: Who, userId: Id<"users">, message = GOOD) {
  await save(who, { message });
  const row = (await profileRow(s, userId))!;
  await approve(s, row._id);
  return row._id;
}

const publicList = (s: S) => s.t.query(api.testimonials.listPublic, {});
const queueOf = (
  s: S,
  status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING",
) => s.mod.query(api.testimonials.listForReview, { status });

/** An older testimonial, from a donation, as the old donate-form tick-box made it. */
async function legacy(
  s: S,
  extra: {
    donation?: Partial<Doc<"donations">>;
    row?: Partial<Doc<"testimonials">>;
  } = {},
) {
  return await s.t.run(async (ctx) => {
    const now = Date.now();
    const donationId = await ctx.db.insert("donations", {
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
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      ...extra.donation,
    });
    const donation = (await ctx.db.get(donationId))!;
    const testimonialId = await ctx.db.insert("testimonials", {
      donationId,
      authorUserId: donation.donorUserId!,
      fundraiserId: donation.fundraiserId,
      authorName: "Wanjiru K.",
      message: "Proud to back this. Keep going!",
      status: "PENDING",
      createdAt: now,
      ...extra.row,
    });
    return { donationId, testimonialId };
  });
}

async function approvedLegacy(s: S, extra: Parameters<typeof legacy>[1] = {}) {
  const made = await legacy(s, extra);
  await approve(s, made.testimonialId);
  return made;
}

describe("publicAuthorName", () => {
  it("shows the first name and the last initial, never the full name", () => {
    expect(publicAuthorName("Wanjiru Kamau")).toBe("Wanjiru K.");
    expect(publicAuthorName("  Mary  Wanjiku   Kamau ")).toBe("Mary K.");
    expect(publicAuthorName("wanjiru")).toBe("wanjiru");
    expect(publicAuthorName("Zawadi ōkafor")).toBe("Zawadi Ō.");
  });

  it("falls back to a neutral label for a blank name", () => {
    expect(publicAuthorName("   ")).toBe("A GoUplift user");
  });
});

describe("what a testimonial may say", () => {
  const input = { rating: 4, message: GOOD, recommendation: NOTE };

  it("keeps its limits where they are written here", () => {
    // Written out, so changing one has to be done on purpose.
    expect([MIN_RATING, MAX_RATING]).toEqual([1, 5]);
    expect(MIN_TESTIMONIAL_LENGTH).toBe(20);
    expect(MAX_TESTIMONIAL_LENGTH).toBe(500);
    expect(MAX_RECOMMENDATION_LENGTH).toBe(1000);
    expect(MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY).toBe(10);
  });

  it("accepts a rating, some words and a suggestion, tidied", () => {
    expect(checkTestimonial(input)).toEqual({
      ok: true,
      value: { rating: 4, message: GOOD, recommendation: NOTE },
    });
    expect(
      checkTestimonial({
        rating: 1,
        message: `  ${GOOD}\r\n\r\n\r\n\r\nThank you.  `,
        recommendation: `  ${NOTE}  `,
      }),
    ).toEqual({
      ok: true,
      value: {
        rating: 1,
        message: `${GOOD}\n\nThank you.`,
        recommendation: NOTE,
      },
    });
  });

  it("needs a whole number of stars from 1 to 5", () => {
    for (const rating of [0, 6, -1, 3.5, Number.NaN, 100]) {
      expect(checkTestimonial({ ...input, rating }), `${rating}`).toEqual({
        ok: false,
        field: "rating",
        problem: "Choose a star rating from 1 to 5.",
      });
    }
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(checkTestimonial({ ...input, rating }).ok).toBe(true);
    }
  });

  it("needs words, not too few and not too many", () => {
    const x = (n: number) => "x".repeat(n);
    expect(checkTestimonial({ ...input, message: x(19) })).toEqual({
      ok: false,
      field: "message",
      problem: "Write at least 20 characters about your experience.",
    });
    expect(checkTestimonial({ ...input, message: "   " }).ok).toBe(false);
    expect(checkTestimonial({ ...input, message: x(20) }).ok).toBe(true);
    expect(checkTestimonial({ ...input, message: x(500) }).ok).toBe(true);
    expect(checkTestimonial({ ...input, message: x(501) })).toEqual({
      ok: false,
      field: "message",
      problem: "Keep your testimonial under 500 characters.",
    });
  });

  it("takes a suggestion or none, and not a very long one", () => {
    for (const recommendation of [undefined, null, "", "   \n "]) {
      expect(
        checkTestimonial({ ...input, recommendation }),
        `${JSON.stringify(recommendation)}`,
      ).toEqual({
        ok: true,
        value: { rating: 4, message: GOOD, recommendation: null },
      });
    }
    expect(
      checkTestimonial({ ...input, recommendation: "x".repeat(1000) }).ok,
    ).toBe(true);
    expect(
      checkTestimonial({ ...input, recommendation: "x".repeat(1001) }),
    ).toEqual({
      ok: false,
      field: "recommendation",
      problem: "Keep your suggestion under 1,000 characters.",
    });
  });

  it("reports the first thing wrong, in the order of the form", () => {
    expect(
      checkTestimonial({
        rating: 0,
        message: "short",
        recommendation: "x".repeat(2000),
      }),
    ).toMatchObject({ field: "rating" });
    expect(
      checkTestimonial({
        rating: 3,
        message: "short",
        recommendation: "x".repeat(2000),
      }),
    ).toMatchObject({ field: "message" });
  });
});

describe("saveMine", () => {
  it("needs someone signed in", async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.testimonials.saveMine, { rating: 5, message: GOOD }),
    ).rejects.toThrow("signed in");
    expect(await allRows(s)).toEqual([]);
  });

  it("lets anyone with an account write one, and puts it in front of staff", async () => {
    const s = await setup();
    await save(s.alice);
    await save(s.bob); // not verified: writing one needs nothing more

    const alice = await profileRow(s, s.ids.alice);
    expect(alice).toMatchObject({
      source: "PROFILE",
      authorName: "Wanjiru K.",
      message: GOOD,
      rating: 5,
      recommendation: NOTE,
      status: "PENDING",
    });
    expect(alice?.donationId).toBeUndefined();
    expect(alice?.fundraiserId).toBeUndefined();
    expect(alice?.editedAt).toBeUndefined();
    expect((await profileRow(s, s.ids.bob))?.status).toBe("PENDING");
  });

  it("keeps one for each person, changing it rather than adding another", async () => {
    const s = await setup();
    await save(s.alice);
    later();
    await save(s.alice, { rating: 3, message: `${GOOD} Mostly.` });

    const rows = (await allRows(s)).filter(
      (r) => r.authorUserId === s.ids.alice,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 3, message: `${GOOD} Mostly.` });
  });

  it("turns away what isn't allowed, and stores nothing", async () => {
    const s = await setup();
    const refused: Array<[string, Parameters<typeof save>[1]]> = [
      ["Choose a star rating", { rating: 0 }],
      ["Choose a star rating", { rating: 6 }],
      ["Choose a star rating", { rating: 4.5 }],
      ["at least 20 characters", { message: "Great." }],
      ["under 500 characters", { message: "x".repeat(501) }],
      ["under 1,000 characters", { recommendation: "x".repeat(1001) }],
    ];
    for (const [problem, input] of refused) {
      await expect(save(s.alice, input), problem).rejects.toThrow(problem);
    }
    expect(await allRows(s)).toEqual([]);
  });

  it("tidies what was typed, and keeps no suggestion when it is blank", async () => {
    const s = await setup();
    await save(s.alice, {
      message: `  ${GOOD}\r\n\r\n\r\n\r\nThank you.  `,
      recommendation: "   ",
    });
    const row = await profileRow(s, s.ids.alice);
    expect(row?.message).toBe(`${GOOD}\n\nThank you.`);
    expect(row?.recommendation).toBeUndefined();
  });

  it("sends an approved one back for review when the rating or the words change", async () => {
    const s = await setup();
    const id = await approvedBy(s, s.alice, s.ids.alice);
    expect(await publicList(s)).toHaveLength(1);

    later();
    await save(s.alice, { rating: 4 });

    const row = await profileRow(s, s.ids.alice);
    expect(row).toMatchObject({ status: "PENDING", rating: 4 });
    expect(row?.editedAt).toBe(Date.now());
    // Nothing of the last review carries over, and it is off the homepage.
    expect(row?.approvedAt).toBeUndefined();
    expect(row?.reviewedBy).toBeUndefined();
    expect(row?.reviewedAt).toBeUndefined();
    expect(row?.reviewNote).toBeUndefined();
    expect(await publicList(s)).toEqual([]);
    expect((await queueOf(s)).map((r) => r._id)).toEqual([id]);

    later();
    await save(s.alice, { rating: 4, message: `${GOOD} It really did.` });
    expect((await profileRow(s, s.ids.alice))?.message).toBe(
      `${GOOD} It really did.`,
    );
  });

  it("refreshes the name shown when the words change, not before", async () => {
    const s = await setup();
    await save(s.alice);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.alice, { displayName: "Wanjiru Njoroge" }),
    );
    expect((await profileRow(s, s.ids.alice))?.authorName).toBe("Wanjiru K.");

    later();
    await save(s.alice, { rating: 4 });
    expect((await profileRow(s, s.ids.alice))?.authorName).toBe("Wanjiru N.");
  });

  it("leaves an approved one showing when only the suggestion changes", async () => {
    const s = await setup();
    await approvedBy(s, s.alice, s.ids.alice);
    const before = await profileRow(s, s.ids.alice);

    later();
    await save(s.alice, { recommendation: "Add a Swahili version." });
    await save(s.alice, { recommendation: "" });

    const after = await profileRow(s, s.ids.alice);
    expect(after).toMatchObject({ status: "APPROVED", reviewedBy: s.ids.mod });
    expect(after?.recommendation).toBeUndefined();
    expect(after?.editedAt).toBeUndefined();
    expect(after?.approvedAt).toBe(before?.approvedAt);
    expect(await publicList(s)).toHaveLength(1);
  });

  it("changes nothing when what is saved is saved again", async () => {
    const s = await setup();
    await approvedBy(s, s.alice, s.ids.alice);
    const before = await profileRow(s, s.ids.alice);

    later();
    await save(s.alice);
    expect(await profileRow(s, s.ids.alice)).toEqual(before);
    expect(await publicList(s)).toHaveLength(1);
  });

  it("doesn't send a rejected one back until it has been edited", async () => {
    const s = await setup();
    await save(s.alice);
    const row = (await profileRow(s, s.ids.alice))!;
    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId: row._id,
      reason: "Contains a phone number",
    });

    later();
    await save(s.alice);
    await save(s.alice, { recommendation: "Add a Swahili version." });
    expect(await profileRow(s, s.ids.alice)).toMatchObject({
      status: "REJECTED",
      recommendation: "Add a Swahili version.",
    });
    expect(await queueOf(s)).toEqual([]);

    await save(s.alice, { message: `${GOOD} Call us any time.` });
    const edited = await profileRow(s, s.ids.alice);
    expect(edited).toMatchObject({ status: "PENDING" });
    expect(edited?.reviewNote).toBeUndefined();
    expect(await queueOf(s)).toHaveLength(1);
  });

  it("lets someone send a withdrawn one in again, even unchanged", async () => {
    const s = await setup();
    const id = await approvedBy(s, s.alice, s.ids.alice);
    await s.alice.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId: id,
    });
    expect((await profileRow(s, s.ids.alice))?.status).toBe("WITHDRAWN");
    expect(await publicList(s)).toEqual([]);

    later();
    await save(s.alice);
    expect(await profileRow(s, s.ids.alice)).toMatchObject({
      status: "PENDING",
      message: GOOD,
    });
    expect(await publicList(s)).toEqual([]);
  });

  describe("how often", () => {
    const send = (s: S, i: number) =>
      save(s.alice, { message: `${GOOD} Version ${i}.` });

    it("is limited a day for each person, counting every time it goes to staff", async () => {
      const s = await setup();
      for (let i = 0; i < MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY; i++) {
        await send(s, i);
      }
      await expect(send(s, 99)).rejects.toThrow("a lot today");
      expect((await profileRow(s, s.ids.alice))?.message).toBe(
        `${GOOD} Version ${MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY - 1}.`,
      );

      // Someone else is not held up by it.
      await save(s.bob);
      expect((await profileRow(s, s.ids.bob))?.status).toBe("PENDING");

      // And it ends: a day later it is open again.
      later(TESTIMONIAL_RATE_WINDOW_MS + 1000);
      await send(s, 100);
      expect((await profileRow(s, s.ids.alice))?.message).toBe(
        `${GOOD} Version 100.`,
      );
    });

    it("doesn't count a change that staff never see", async () => {
      const s = await setup();
      for (let i = 0; i < MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY; i++) {
        await send(s, i);
      }
      const row = await profileRow(s, s.ids.alice);

      await save(s.alice, {
        message: row!.message,
        recommendation: "Add a Swahili version.",
      });
      await save(s.alice, {
        message: row!.message,
        recommendation: "Add a Swahili version.",
      });
      expect((await profileRow(s, s.ids.alice))?.recommendation).toBe(
        "Add a Swahili version.",
      );
    });

    it("doesn't count an attempt that was turned away for what it said", async () => {
      const s = await setup();
      for (let i = 0; i < MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY + 3; i++) {
        await expect(save(s.alice, { message: "too short" })).rejects.toThrow(
          "at least 20",
        );
      }
      await save(s.alice);
      expect(await profileRow(s, s.ids.alice)).toMatchObject({
        status: "PENDING",
      });
    });
  });
});

describe("listMine", () => {
  it("lists a person's own testimonial, with the suggestion they wrote", async () => {
    const s = await setup();
    await save(s.alice);
    await save(s.carol, { recommendation: "Carol's private idea." });

    const mine = await s.alice.query(api.testimonials.listMine, {});
    expect(mine).toEqual([
      {
        _id: expect.any(String),
        source: "PROFILE",
        message: GOOD,
        rating: 5,
        recommendation: NOTE,
        status: "PENDING",
        fundraiserTitle: null,
        awaitingVerification: false,
        createdAt: expect.any(Number),
        editedAt: null,
      },
    ]);
    expect(JSON.stringify(mine)).not.toContain("Carol");
    expect(await s.bob.query(api.testimonials.listMine, {})).toEqual([]);
    expect(await s.t.query(api.testimonials.listMine, {})).toEqual([]);
  });

  it("says when it is approved but waiting for the author to be verified", async () => {
    const s = await setup();
    await save(s.bob);
    const row = (await profileRow(s, s.ids.bob))!;
    await approve(s, row._id);
    expect((await s.bob.query(api.testimonials.listMine, {}))[0]).toMatchObject(
      { status: "APPROVED", awaitingVerification: true },
    );

    // Waiting for review isn't "waiting for verification", verified or not.
    const dina = await newUser(s, "Dina", false);
    await save(dina.who);
    expect(
      (await dina.who.query(api.testimonials.listMine, {}))[0],
    ).toMatchObject({ status: "PENDING", awaitingVerification: false });
    await approvedBy(s, s.carol, s.ids.carol);
    expect(
      (await s.carol.query(api.testimonials.listMine, {}))[0],
    ).toMatchObject({ status: "APPROVED", awaitingVerification: false });
  });

  it("includes what a donor offered with an older donation, newest first", async () => {
    const s = await setup();
    await legacy(s);
    later();
    await save(s.alice);

    const mine = await s.alice.query(api.testimonials.listMine, {});
    expect(mine.map((r) => r.source)).toEqual(["PROFILE", "DONATION"]);
    expect(mine[1]).toMatchObject({
      rating: null,
      recommendation: null,
      fundraiserTitle: "Water for Kajiado",
      status: "PENDING",
    });
  });
});

describe("withdrawTestimonial", () => {
  it("lets the author withdraw one that is waiting or on show, and nobody else", async () => {
    const s = await setup();
    const shown = await approvedBy(s, s.alice, s.ids.alice);
    await save(s.carol);
    const waiting = (await profileRow(s, s.ids.carol))!._id;

    await expect(
      s.carol.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: shown,
      }),
    ).rejects.toThrow("not found");
    await expect(
      s.t.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: shown,
      }),
    ).rejects.toThrow("signed in");

    await s.alice.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId: shown,
    });
    await s.carol.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId: waiting,
    });
    expect(await publicList(s)).toEqual([]);
    expect((await profileRow(s, s.ids.alice))?.approvedAt).toBeUndefined();

    await expect(
      s.carol.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: waiting,
      }),
    ).rejects.toThrow("isn't on show");
  });

  it("can't withdraw one staff rejected", async () => {
    const s = await setup();
    await save(s.alice);
    const row = (await profileRow(s, s.ids.alice))!;
    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId: row._id,
      reason: "Contains a phone number",
    });
    await expect(
      s.alice.mutation(api.testimonials.withdrawTestimonial, {
        testimonialId: row._id,
      }),
    ).rejects.toThrow("isn't on show");
  });

  it("works on an older one that came from a donation", async () => {
    const s = await setup();
    const { testimonialId } = await approvedLegacy(s);
    expect(await publicList(s)).toHaveLength(1);
    await s.alice.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId,
    });
    expect(await publicList(s)).toEqual([]);
  });
});

describe("moderation", () => {
  it("shows the queue to staff only, with everything needed to judge it", async () => {
    const s = await setup();
    await save(s.alice);
    await save(s.bob);

    const forStaff = await queueOf(s);
    expect(forStaff).toHaveLength(2);
    expect(forStaff[0]).toMatchObject({
      source: "PROFILE",
      authorName: "Wanjiru K.",
      authorDisplayName: "Wanjiru Kamau",
      authorVerified: true,
      rating: 5,
      message: GOOD,
      recommendation: NOTE,
      fundraiserId: null,
      fundraiserTitle: null,
      blocker: null,
      shownBlocker: null,
      editedAt: null,
    });
    expect(forStaff[1]).toMatchObject({
      authorName: "Bob O.",
      authorVerified: false,
      blocker: null,
    });
    expect(forStaff[1].shownBlocker).toMatch(/identity verification/);

    for (const who of [s.alice, s.bob, s.t]) {
      expect(
        await who.query(api.testimonials.listForReview, { status: "PENDING" }),
      ).toEqual([]);
    }
  });

  it("shows waiting ones oldest first, so nobody is left queueing", async () => {
    const s = await setup();
    await save(s.carol);
    later();
    await save(s.alice);
    expect((await queueOf(s)).map((r) => r.authorName)).toEqual([
      "Carol N.",
      "Wanjiru K.",
    ]);
  });

  it("lets only staff approve, and records who and when in the audit log", async () => {
    const s = await setup();
    await save(s.alice);
    const row = (await profileRow(s, s.ids.alice))!;
    const args = { testimonialId: row._id, version: versionOf(row) };

    await expect(
      s.alice.mutation(api.testimonials.approveTestimonial, args),
    ).rejects.toThrow("permission");
    await expect(
      s.t.mutation(api.testimonials.approveTestimonial, args),
    ).rejects.toThrow("signed in");

    await s.mod.mutation(api.testimonials.approveTestimonial, {
      ...args,
      note: "  Reads fine  ",
    });

    const after = await s.t.run((ctx) => ctx.db.get(row._id));
    expect(after).toMatchObject({
      status: "APPROVED",
      reviewedBy: s.ids.mod,
      reviewNote: "Reads fine",
    });
    // Approved and reviewed in the same instant.
    expect(after?.approvedAt).toBeDefined();
    expect(after?.approvedAt).toBe(after?.reviewedAt);

    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: "TESTIMONIAL_APPROVED",
      actorId: s.ids.mod,
      testimonialId: row._id,
      statusBefore: "PENDING",
      statusAfter: "APPROVED",
    });
    expect(log[0].fundraiserId).toBeUndefined();
  });

  it("only approves a testimonial that is waiting", async () => {
    const s = await setup();
    const id = await approvedBy(s, s.alice, s.ids.alice);
    const row = (await s.t.run((ctx) => ctx.db.get(id)))!;
    await expect(
      s.mod.mutation(api.testimonials.approveTestimonial, {
        testimonialId: id,
        version: versionOf(row),
      }),
    ).rejects.toThrow("waiting for review");
  });

  it("won't approve words that were changed after the reviewer opened them", async () => {
    const s = await setup();
    await save(s.alice);
    const [opened] = await queueOf(s);

    later();
    await save(s.alice, {
      message: "Something the reviewer has not read yet.",
    });

    await expect(
      s.mod.mutation(api.testimonials.approveTestimonial, {
        testimonialId: opened._id,
        version: opened.version,
      }),
    ).rejects.toThrow("changed this testimonial");
    expect((await profileRow(s, s.ids.alice))?.status).toBe("PENDING");
    expect(await publicList(s)).toEqual([]);

    // Read again, it can be approved.
    const [reopened] = await queueOf(s);
    expect(reopened.version).not.toBe(opened.version);
    await s.mod.mutation(api.testimonials.approveTestimonial, {
      testimonialId: reopened._id,
      version: reopened.version,
    });
    expect((await profileRow(s, s.ids.alice))?.status).toBe("APPROVED");
  });

  it("approves the words of someone who isn't verified yet, and shows them once they are", async () => {
    const s = await setup();
    await save(s.bob);
    const row = (await profileRow(s, s.ids.bob))!;
    await approve(s, row._id);

    expect(await publicList(s)).toEqual([]);
    const [approved] = await queueOf(s, "APPROVED");
    expect(approved).toMatchObject({ authorVerified: false, blocker: null });
    expect(approved.shownBlocker).toMatch(/identity verification/);

    // The payout system approves them: nothing more for staff to do.
    await s.t.run((ctx) =>
      ctx.db.insert("kycSubmissions", {
        userId: s.ids.bob,
        requestedTier: 1,
        status: "APPROVED",
        submittedAt: Date.now(),
      }),
    );
    expect(await publicList(s)).toHaveLength(1);
    expect((await queueOf(s, "APPROVED"))[0].shownBlocker).toBeNull();
  });

  it("holds an older one to the old rule: its donation has to stand and its author be verified", async () => {
    const s = await setup();

    const refunded = await legacy(s, { donation: { status: "REFUNDED" } });
    await expect(
      s.mod.mutation(api.testimonials.approveTestimonial, {
        testimonialId: refunded.testimonialId,
        version: await versionNow(s, refunded.testimonialId),
      }),
    ).rejects.toThrow("refunded");

    const lapsed = await legacy(s, { donation: { donorUserId: s.ids.carol } });
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
        testimonialId: lapsed.testimonialId,
        version: await versionNow(s, lapsed.testimonialId),
      }),
    ).rejects.toThrow("verification");

    // The queue says so too, so a moderator isn't left guessing.
    const rows = await queueOf(s);
    expect(rows.every((r) => r.blocker !== null)).toBe(true);
    expect(rows.map((r) => r.fundraiserTitle)).toEqual([
      "Water for Kajiado",
      "Water for Kajiado",
    ]);
  });

  it("needs a real reason to reject, and logs it", async () => {
    const s = await setup();
    await save(s.alice);
    const id = (await profileRow(s, s.ids.alice))!._id;

    await expect(
      s.mod.mutation(api.testimonials.rejectTestimonial, {
        testimonialId: id,
        reason: "no",
      }),
    ).rejects.toThrow("reason");
    await expect(
      s.alice.mutation(api.testimonials.rejectTestimonial, {
        testimonialId: id,
        reason: "Not allowed to do this",
      }),
    ).rejects.toThrow("permission");

    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId: id,
      reason: "  Contains a phone number  ",
    });
    expect(await s.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      status: "REJECTED",
      reviewedBy: s.ids.mod,
      reviewNote: "Contains a phone number",
    });
    const [rejected] = await queueOf(s, "REJECTED");
    expect(rejected.reviewNote).toBe("Contains a phone number");
    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log[0]).toMatchObject({
      action: "TESTIMONIAL_REJECTED",
      statusBefore: "PENDING",
      statusAfter: "REJECTED",
    });
  });

  it("lets staff take an approved testimonial down", async () => {
    const s = await setup();
    const id = await approvedBy(s, s.alice, s.ids.alice);
    expect(await publicList(s)).toHaveLength(1);

    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId: id,
      reason: "Turned out to be inaccurate",
    });
    expect(await publicList(s)).toEqual([]);
    expect((await profileRow(s, s.ids.alice))?.approvedAt).toBeUndefined();
    await expect(
      s.mod.mutation(api.testimonials.rejectTestimonial, {
        testimonialId: id,
        reason: "Turned out to be inaccurate",
      }),
    ).rejects.toThrow("can't be rejected");
  });
});

describe("the private suggestion", () => {
  it("is read by staff and by its author, and by nobody else", async () => {
    const s = await setup();
    await approvedBy(s, s.alice, s.ids.alice);
    await save(s.bob, { recommendation: "Bob's idea about M-Pesa limits." });

    // Staff, in every list of the queue.
    expect((await queueOf(s, "APPROVED"))[0].recommendation).toBe(NOTE);
    expect((await queueOf(s))[0].recommendation).toBe(
      "Bob's idea about M-Pesa limits.",
    );
    // Its author.
    expect(
      (await s.alice.query(api.testimonials.listMine, {}))[0].recommendation,
    ).toBe(NOTE);

    // Not other people, signed in or not.
    for (const who of [s.bob, s.carol, s.t]) {
      expect(
        JSON.stringify(await who.query(api.testimonials.listMine, {})),
      ).not.toContain("Swahili");
      expect(
        JSON.stringify(await who.query(api.testimonials.listPublic, {})),
      ).not.toContain("M-Pesa");
    }
    expect(
      JSON.stringify(await s.carol.query(api.testimonials.listMine, {})),
    ).not.toContain(NOTE);
    expect(
      JSON.stringify(await s.bob.query(api.testimonials.listMine, {})),
    ).not.toContain(NOTE);
  });
});

describe("listPublic", () => {
  it("is empty until something is approved", async () => {
    const s = await setup();
    expect(await publicList(s)).toEqual([]);

    // Waiting, rejected and withdrawn ones are never public.
    await save(s.alice);
    await save(s.carol);
    await save(s.bob);
    const carol = (await profileRow(s, s.ids.carol))!;
    await s.mod.mutation(api.testimonials.rejectTestimonial, {
      testimonialId: carol._id,
      reason: "Contains a phone number",
    });
    const bobId = (await profileRow(s, s.ids.bob))!._id;
    await s.bob.mutation(api.testimonials.withdrawTestimonial, {
      testimonialId: bobId,
    });
    expect(await publicList(s)).toEqual([]);
  });

  it("shows an approved testimonial to anyone, signed in or not, with its rating", async () => {
    const s = await setup();
    const id = await approvedBy(s, s.alice, s.ids.alice);

    const expected = [
      {
        _id: id,
        message: GOOD,
        rating: 5,
        authorName: "Wanjiru K.",
        fundraiserId: null,
        fundraiserTitle: null,
        approvedAt: expect.any(Number),
      },
    ];
    expect(await publicList(s)).toEqual(expected);
    expect(await s.bob.query(api.testimonials.listPublic, {})).toEqual(
      expected,
    );
  });

  it("exposes nothing private: no suggestion, email, account id or full name", async () => {
    const s = await setup();
    await approvedBy(s, s.alice, s.ids.alice);
    const [row] = await publicList(s);
    expect(Object.keys(row).sort()).toEqual([
      "_id",
      "approvedAt",
      "authorName",
      "fundraiserId",
      "fundraiserTitle",
      "message",
      "rating",
    ]);
    const text = JSON.stringify(row);
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain("Kamau");
    expect(text).not.toContain("example.test");
  });

  it("drops a testimonial once its author is no longer verified", async () => {
    const s = await setup();
    await approvedBy(s, s.alice, s.ids.alice);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.aliceKyc, { status: "REJECTED" }),
    );
    expect(await publicList(s)).toEqual([]);
  });

  it("doesn't need a fundraiser, so a flagged or private one changes nothing for it", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const id of [
        s.ids.fundraiserId,
        s.ids.privateFundraiserId,
        s.ids.flaggedFundraiserId,
      ]) {
        await ctx.db.patch(id, { status: "CANCELLED" });
      }
    });
    await approvedBy(s, s.alice, s.ids.alice);
    expect(await publicList(s)).toHaveLength(1);
  });

  it("shows the newest first and at most six", async () => {
    const s = await setup();
    const made: Id<"testimonials">[] = [];
    for (let i = 0; i < 8; i++) {
      const author = await newUser(s, `Writer${i}`, true);
      later();
      made.push(await approvedBy(s, author.who, author.id, `${GOOD} #${i}`));
    }

    const list = await publicList(s);
    expect(list).toHaveLength(6);
    expect(list.map((r) => r._id)).toEqual(made.slice(2).reverse());
  });

  it("still fills the list when some recent ones no longer qualify", async () => {
    const s = await setup();
    // The one that qualifies is the oldest, behind three that don't.
    const carol = await approvedBy(s, s.carol, s.ids.carol);
    for (let i = 0; i < 3; i++) {
      const author = await newUser(s, `Lapsed${i}`, false);
      later();
      await approvedBy(s, author.who, author.id);
    }

    // The three newest were never verified, so only the verified one shows.
    expect((await publicList(s)).map((r) => r._id)).toEqual([carol]);
  });

  describe("an older one, from a donation", () => {
    it("is still shown, with the fundraiser it was about and no rating", async () => {
      const s = await setup();
      const { testimonialId } = await approvedLegacy(s);
      expect(await publicList(s)).toEqual([
        {
          _id: testimonialId,
          message: "Proud to back this. Keep going!",
          rating: null,
          authorName: "Wanjiru K.",
          fundraiserId: s.ids.fundraiserId,
          fundraiserTitle: "Water for Kajiado",
          approvedAt: expect.any(Number),
        },
      ]);
    });

    it("comes down when its donation is refunded or its author stops being verified", async () => {
      const s = await setup();
      const { donationId } = await approvedLegacy(s);
      await s.t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));
      expect(await publicList(s)).toEqual([]);

      await s.t.run((ctx) => ctx.db.patch(donationId, { status: "COMPLETED" }));
      expect(await publicList(s)).toHaveLength(1);
      await s.t.run((ctx) =>
        ctx.db.patch(s.ids.aliceKyc, { status: "REJECTED" }),
      );
      expect(await publicList(s)).toEqual([]);
    });

    it("comes down with a fundraiser that is private, flagged or not open", async () => {
      const s = await setup();
      for (const fundraiserId of [
        s.ids.privateFundraiserId,
        s.ids.flaggedFundraiserId,
        s.ids.pausedFundraiserId,
      ]) {
        await approvedLegacy(s, { donation: { fundraiserId } });
      }
      expect(await publicList(s)).toEqual([]);

      // A finished campaign is still a campaign worth quoting.
      await s.t.run((ctx) =>
        ctx.db.patch(s.ids.fundraiserId, { status: "COMPLETED" }),
      );
      await approvedLegacy(s);
      expect(await publicList(s)).toHaveLength(1);
    });

    it("sits beside the new ones, newest first", async () => {
      const s = await setup();
      const old = await approvedLegacy(s);
      later();
      const fresh = await approvedBy(s, s.carol, s.ids.carol);
      expect((await publicList(s)).map((r) => r._id)).toEqual([
        fresh,
        old.testimonialId,
      ]);
    });
  });
});

describe("the donation message", () => {
  it("no longer becomes a testimonial, whether or not an older tick-box was set", async () => {
    const s = await setup();
    const pending = (extra: Partial<Doc<"donations">> = {}) =>
      s.t.run((ctx) =>
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
          status: "PENDING",
          payoutStatus: "NOT_YET_PAYABLE",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...extra,
        }),
      );

    const sasapay = await pending();
    await s.t.mutation(internal.donations.markDonationCompleted, {
      donationId: sasapay,
    });
    const paypal = await pending({ donorUserId: s.ids.carol });
    await s.t.mutation(internal.paypal.completePayPalDonation, {
      donationId: paypal,
      paypalCaptureId: "CAPTURE-1",
    });
    await settle(s.t);

    // The payments went through, and no testimonial came of them.
    for (const id of [sasapay, paypal]) {
      expect((await s.t.run((ctx) => ctx.db.get(id)))?.status).toBe(
        "COMPLETED",
      );
    }
    expect(await allRows(s)).toEqual([]);
  });
});
