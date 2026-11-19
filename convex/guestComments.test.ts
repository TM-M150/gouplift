/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ANONYMOUS_DONOR_NAME,
  checkGuestName,
  COMMENT_RATE_WINDOW_MS,
  MAX_COMMENTS_PER_DAY,
  MAX_GUEST_NAME_LENGTH,
  suggestedGuestName,
} from "../lib/comments";
import { newToken } from "./lib/randomToken";

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

const GOOD = "Thank you for doing this. The pump will change so much.";
const NAME = "Grace";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T09:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

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

    const owner = await user("auth_owner", "Fund Raiser");
    const donor = await user("auth_donor", "Wanjiru Kamau");
    const stranger = await user("auth_stranger", "Someone Else");
    const mod = await user("auth_mod", "Mo Derator", "MODERATOR");

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
      owner,
      donor,
      stranger,
      mod,
      fundraiserId: await fundraiser(),
      privateId: await fundraiser({ isPrivate: true }),
      draftId: await fundraiser({ status: "DRAFT" }),
      cancelledId: await fundraiser({ status: "CANCELLED" }),
      pausedId: await fundraiser({ status: "PAUSED" }),
      completedId: await fundraiser({ status: "COMPLETED" }),
      expiredId: await fundraiser({ status: "EXPIRED" }),
      flaggedId: await fundraiser({ isFlagged: true }),
      commentsOffId: await fundraiser({ commentsEnabled: false }),
    };
  });

  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "auth_owner" }),
    donor: t.withIdentity({ subject: "auth_donor" }),
    stranger: t.withIdentity({ subject: "auth_stranger" }),
    mod: t.withIdentity({ subject: "auth_mod" }),
  };
}
type S = Awaited<ReturnType<typeof setup>>;

/** A donation, by default a completed one made without an account. */
function donate(
  s: S,
  fundraiserId: Id<"fundraisers">,
  extra: Partial<Doc<"donations">> = {},
) {
  return s.t.run((ctx) => {
    const now = Date.now();
    const doc: Omit<Doc<"donations">, "_id" | "_creationTime"> = {
      fundraiserId,
      donorName: "Grace Wambui",
      donorEmail: "grace@example.test",
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES",
      platformFeeRate: 0.0425,
      platformFeeAmount: 42.5,
      netAmount: 957.5,
      status: "COMPLETED",
      payoutStatus: "PENDING_PAYOUT",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
    return ctx.db.insert("donations", doc);
  });
}

/** A guest's donation with its receipt and private link, as the receipt makes them. */
async function guest(
  s: S,
  fundraiserId = s.ids.fundraiserId,
  extra: Partial<Doc<"donations">> = {},
) {
  const donationId = await donate(s, fundraiserId, extra);
  const token = newToken();
  await s.t.run((ctx) =>
    ctx.db.insert("donationReceipts", {
      donationId,
      status: "SENT",
      attempts: 1,
      generation: 0,
      commentToken: token,
      createdAt: Date.now(),
    }),
  );
  return { donationId, token };
}

const page = () => ({ numItems: 20, cursor: null });

async function publicRows(s: S, fundraiserId = s.ids.fundraiserId) {
  const result = await s.t.query(api.fundraiserComments.list, {
    fundraiserId,
    paginationOpts: page(),
  });
  return result.page;
}

const count = (s: S, fundraiserId = s.ids.fundraiserId) =>
  s.t.run(async (ctx) => (await ctx.db.get(fundraiserId))?.commentsCount ?? 0);

const stored = (s: S, commentId: Id<"fundraiserComments">) =>
  s.t.run((ctx) => ctx.db.get(commentId));

// `name` is the first name sent; null sends none at all.
const post = (s: S, token: string, body = GOOD, name: string | null = NAME) =>
  s.t.mutation(api.guestComments.post, {
    token,
    body,
    name: name ?? undefined,
  });

const view = (s: S, token: string) =>
  s.t.query(api.guestComments.forToken, { token });

// ---- The name -----------------------------------------------------------

describe("the name a guest types", () => {
  it("is shown the way a signed-in donor's is: first name, last initial", () => {
    expect(checkGuestName("Grace")).toEqual({ ok: true, name: "Grace" });
    expect(checkGuestName("Grace Wambui")).toEqual({
      ok: true,
      name: "Grace W.",
    });
    expect(checkGuestName("  grace   wambui kamau ")).toEqual({
      ok: true,
      name: "grace K.",
    });
  });

  it("allows the marks and punctuation that real names have", () => {
    for (const name of [
      "Mary-Ann",
      "O'Neil",
      "O’Neil",
      "Chloé",
      "Zoë",
      "Nyambura",
      "Aarav",
      "李明",
      "Мария",
    ]) {
      expect(checkGuestName(name).ok, name).toBe(true);
    }
  });

  it("asks for a name, and not for a long one", () => {
    expect(checkGuestName("")).toEqual({
      ok: false,
      problem: "Enter your first name.",
    });
    expect(checkGuestName("   ").ok).toBe(false);
    expect(checkGuestName("G").ok).toBe(false);
    // The limit is written out here, so changing it has to be done on purpose.
    expect(MAX_GUEST_NAME_LENGTH).toBe(40);
    expect(checkGuestName("G".repeat(40)).ok).toBe(true);
    expect(checkGuestName("G".repeat(41))).toEqual({
      ok: false,
      problem: "Keep your name to 40 characters or fewer.",
    });
  });

  it("counts a name without the extra spaces around its words", () => {
    // 42 characters as typed, 13 once the spaces are tidied.
    const spaced = `Wanjiru${" ".repeat(30)}Kamau`;
    expect(spaced).toHaveLength(42);
    expect(checkGuestName(spaced)).toEqual({ ok: true, name: "Wanjiru K." });
  });

  it("is not a place for numbers, links or symbols", () => {
    for (const name of [
      "0712345678",
      "7Grace",
      "Grace 254",
      "grace@example.test",
      "www.pay-me.co.ke",
      "G.",
      "Grace <b>",
      "Send money to 0700",
      "💚",
      "-Grace",
      "'Grace",
    ]) {
      expect(checkGuestName(name).ok, name).toBe(false);
    }
  });

  it("can't be made to look as if GoUplift wrote it", () => {
    for (const name of [
      "GoUplift",
      "Go Uplift",
      "go-up-lift",
      "GOUPLIFT Team",
      "Admin",
      "Administrator",
      "Moderator",
      "Staff",
      "Support",
      "Support Team",
      "Official",
      "Organizer",
      "Organiser",
    ]) {
      expect(checkGuestName(name), name).toEqual({
        ok: false,
        problem: "Please use your own first name.",
      });
    }
  });

  it("does not turn away ordinary names that only share some letters", () => {
    for (const name of ["Adminah", "Staffan", "Upton", "Liftson", "Gouda"]) {
      expect(checkGuestName(name).ok, name).toBe(true);
    }
  });

  it("starts the field with the first name given at checkout, if it can be used", () => {
    expect(suggestedGuestName("Grace Wambui")).toBe("Grace");
    expect(suggestedGuestName("  Otieno ")).toBe("Otieno");
    expect(suggestedGuestName(undefined)).toBe("");
    expect(suggestedGuestName(null)).toBe("");
    expect(suggestedGuestName("0712345678")).toBe("");
    expect(suggestedGuestName("Admin Joe")).toBe("");
  });
});

// ---- The link in the receipt --------------------------------------------

describe("the link in a receipt", () => {
  it("is made for a donation given without an account", async () => {
    const s = await setup();
    const donationId = await donate(s, s.ids.fundraiserId);

    await s.t.mutation(internal.receipts.queueReceipt, { donationId });

    const receipt = await s.t.run((ctx) =>
      ctx.db
        .query("donationReceipts")
        .withIndex("by_donationId", (q) => q.eq("donationId", donationId))
        .unique(),
    );
    expect(receipt?.commentToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("is not made for a donor who is signed in, who can comment from their account", async () => {
    const s = await setup();
    const donationId = await donate(s, s.ids.fundraiserId, {
      donorUserId: s.ids.donor,
    });

    await s.t.mutation(internal.receipts.queueReceipt, { donationId });

    const receipt = await s.t.run((ctx) =>
      ctx.db
        .query("donationReceipts")
        .withIndex("by_donationId", (q) => q.eq("donationId", donationId))
        .unique(),
    );
    expect(receipt?.status).toBe("PENDING");
    expect(receipt?.commentToken).toBeUndefined();
  });

  it("is not made when there is no one to send the receipt to", async () => {
    const s = await setup();
    const donationId = await donate(s, s.ids.fundraiserId, {
      donorEmail: undefined,
    });

    await s.t.mutation(internal.receipts.queueReceipt, { donationId });

    const receipt = await s.t.run((ctx) =>
      ctx.db
        .query("donationReceipts")
        .withIndex("by_donationId", (q) => q.eq("donationId", donationId))
        .unique(),
    );
    expect(receipt?.status).toBe("SKIPPED");
    expect(receipt?.commentToken).toBeUndefined();
  });

  it("is different for every donation, and is made once", async () => {
    const s = await setup();
    const first = await donate(s, s.ids.fundraiserId);
    const second = await donate(s, s.ids.fundraiserId);

    await s.t.mutation(internal.receipts.queueReceipt, { donationId: first });
    await s.t.mutation(internal.receipts.queueReceipt, { donationId: second });
    // A repeated callback doesn't make a second receipt, or a second link.
    await s.t.mutation(internal.receipts.queueReceipt, { donationId: first });

    const receipts = await s.t.run((ctx) =>
      ctx.db.query("donationReceipts").collect(),
    );
    expect(receipts).toHaveLength(2);
    const tokens = receipts.map((receipt) => receipt.commentToken);
    expect(new Set(tokens).size).toBe(2);
  });

  it("is made from random bytes", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

// ---- Looking at a link --------------------------------------------------

describe("opening the link", () => {
  it("shows the fundraiser and a comment box, with the name they gave to start the field", async () => {
    const s = await setup();
    const { token } = await guest(s);

    expect(await view(s, token)).toEqual({
      fundraiserId: s.ids.fundraiserId,
      fundraiserTitle: "Water for Kajiado",
      access: "CAN_COMMENT",
      askName: true,
      suggestedName: "Grace",
      comments: [],
      hiddenCount: 0,
    });
  });

  it("doesn't ask for a name when the donation was anonymous", async () => {
    const s = await setup();
    const { token } = await guest(s, s.ids.fundraiserId, { isAnonymous: true });

    const result = await view(s, token);
    expect(result?.askName).toBe(false);
    expect(result?.access).toBe("CAN_COMMENT");
  });

  it("says nothing more about a link that isn't ours, however it isn't", async () => {
    const s = await setup();
    await guest(s);

    expect(await view(s, newToken())).toBeNull();
    expect(await view(s, "")).toBeNull();
    expect(await view(s, "x".repeat(101))).toBeNull();
    expect(await view(s, "a".repeat(100))).toBeNull();
  });

  it("works without signing in, and the same for someone who is signed in as somebody else", async () => {
    const s = await setup();
    const { token } = await guest(s);

    const signedOut = await view(s, token);
    const asOther = await s.stranger.query(api.guestComments.forToken, {
      token,
    });
    expect(asOther).toEqual(signedOut);
  });

  it("is closed when comments are off, the fundraiser is down, or the donation was given back", async () => {
    const s = await setup();
    for (const id of [
      s.ids.commentsOffId,
      s.ids.flaggedId,
      s.ids.privateId,
      s.ids.draftId,
      s.ids.cancelledId,
    ]) {
      const { token } = await guest(s, id);
      expect((await view(s, token))?.access, `${id}`).toBe("CLOSED");
    }
    const refunded = await guest(s, s.ids.fundraiserId, { status: "REFUNDED" });
    expect((await view(s, refunded.token))?.access).toBe("CLOSED");
  });

  it("still takes comments once a fundraiser has finished", async () => {
    const s = await setup();
    for (const id of [s.ids.pausedId, s.ids.completedId, s.ids.expiredId]) {
      const { token } = await guest(s, id);
      expect((await view(s, token))?.access, `${id}`).toBe("CAN_COMMENT");
    }
  });

  it("doesn't give away a fundraiser that isn't public", async () => {
    const s = await setup();
    const { token } = await guest(s, s.ids.privateId);

    const result = await view(s, token);
    expect(result?.fundraiserId).toBeNull();
    expect(result?.fundraiserTitle).toBe("this fundraiser");
  });
});

// ---- Posting ------------------------------------------------------------

describe("posting a comment", () => {
  it("shows it on the fundraiser straight away, under the name they typed", async () => {
    const s = await setup();
    const { token, donationId } = await guest(s);

    const commentId = await post(s, token, GOOD, "Grace Wambui");

    const rows = await publicRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: commentId,
      authorName: "Grace W.",
      body: GOOD,
      editedAt: null,
      mine: false,
    });
    expect(await stored(s, commentId)).toMatchObject({
      fundraiserId: s.ids.fundraiserId,
      donationId,
      status: "PUBLISHED",
    });
    expect((await stored(s, commentId))?.authorUserId).toBeUndefined();
    expect(await count(s)).toBe(1);
  });

  it("shows an anonymous donor as one, whatever name is sent", async () => {
    const s = await setup();
    const { token } = await guest(s, s.ids.fundraiserId, { isAnonymous: true });

    await post(s, token, GOOD, "Grace Wambui");

    expect((await publicRows(s))[0].authorName).toBe(ANONYMOUS_DONOR_NAME);
    expect(JSON.stringify(await publicRows(s))).not.toContain("Grace");
  });

  it("needs a name that can be used, unless the donation was anonymous", async () => {
    const s = await setup();
    const { token } = await guest(s);

    // What each is refused for, so a name can't get in and fail somewhere else.
    const refused: Array<[string | null, string]> = [
      [null, "Enter your first name."],
      ["", "Enter your first name."],
      ["  ", "Enter your first name."],
      ["0712345678", "Use only letters in your name."],
      ["GoUplift Support", "Please use your own first name."],
    ];
    for (const [name, problem] of refused) {
      await expect(post(s, token, GOOD, name), `${name}`).rejects.toThrow(
        problem,
      );
    }
    expect(await publicRows(s)).toEqual([]);
    expect(await count(s)).toBe(0);
  });

  it("checks the words the same way as for a signed-in donor", async () => {
    const s = await setup();
    const { token } = await guest(s);

    await expect(post(s, token, "ok")).rejects.toThrow(/at least 3 characters/);
    await expect(post(s, token, "x".repeat(501))).rejects.toThrow(
      /under 500 characters/,
    );
    await expect(post(s, token, "   ")).rejects.toThrow();
    expect(await publicRows(s)).toEqual([]);
  });

  it("is refused for a link that isn't ours", async () => {
    const s = await setup();
    await guest(s);

    await expect(post(s, newToken())).rejects.toThrow(/link isn't valid/);
    await expect(post(s, "")).rejects.toThrow(/link isn't valid/);
    expect(await publicRows(s)).toEqual([]);
  });

  it("is refused where comments are closed, and after the donation was given back", async () => {
    const s = await setup();
    for (const id of [
      s.ids.commentsOffId,
      s.ids.flaggedId,
      s.ids.privateId,
      s.ids.draftId,
      s.ids.cancelledId,
    ]) {
      const { token } = await guest(s, id);
      await expect(post(s, token), `${id}`).rejects.toThrow(
        /Comments are closed/,
      );
    }

    const { token, donationId } = await guest(s);
    await s.t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));
    await expect(post(s, token)).rejects.toThrow(/donated to this fundraiser/);
  });

  it("works on a fundraiser that has finished", async () => {
    const s = await setup();
    const { token } = await guest(s, s.ids.completedId);
    await post(s, token);
    expect(await publicRows(s, s.ids.completedId)).toHaveLength(1);
  });

  it("is limited a day, for each link", async () => {
    const s = await setup();
    const one = await guest(s);
    const two = await guest(s);

    for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) await post(s, one.token);
    await expect(post(s, one.token)).rejects.toThrow(
      /Please try again tomorrow/,
    );
    // Another donor's link is not affected.
    await post(s, two.token);

    vi.setSystemTime(Date.now() + COMMENT_RATE_WINDOW_MS + 1000);
    await post(s, one.token);
    expect(await count(s)).toBe(MAX_COMMENTS_PER_DAY + 2);
  });

  it("is not counted against the limit when it was refused for what it said", async () => {
    const s = await setup();
    const { token } = await guest(s);

    for (let i = 0; i < MAX_COMMENTS_PER_DAY + 2; i++) {
      await expect(post(s, token, "no")).rejects.toThrow();
    }
    await post(s, token);
    expect(await count(s)).toBe(1);
  });

  it("is a signed-in donor's own business: their link makes no difference to them", async () => {
    const s = await setup();
    await guest(s);
    await donate(s, s.ids.fundraiserId, {
      donorUserId: s.ids.donor,
      donorName: undefined,
    });

    await s.donor.mutation(api.fundraiserComments.postComment, {
      fundraiserId: s.ids.fundraiserId,
      body: GOOD,
    });

    const rows = await publicRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0].authorName).toBe("Wanjiru K.");
  });

  it("plans the email to the organizer, like any other comment", async () => {
    const s = await setup();
    const { token } = await guest(s);

    await post(s, token);

    const state = await s.t.run((ctx) =>
      ctx.db.query("commentEmailState").collect(),
    );
    expect(state).toHaveLength(1);
    expect(state[0].fundraiserId).toBe(s.ids.fundraiserId);
  });
});

// ---- Their own comments -------------------------------------------------

describe("the comments a link wrote", () => {
  it("are listed on its page, newest first, with edit and remove open to it", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const first = await post(s, token, "The first thing I wanted to say.");
    vi.setSystemTime(Date.now() + 60_000);
    const second = await post(s, token, "And one more thing to add.");

    const result = await view(s, token);
    expect(result?.comments.map((c) => c._id)).toEqual([second, first]);
    expect(result?.comments.every((c) => c.mine)).toBe(true);
  });

  it("can be edited, and shows that it was", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);

    vi.setSystemTime(Date.now() + 60_000);
    await s.t.mutation(api.guestComments.edit, {
      token,
      commentId,
      body: "  A better way to say it.  ",
    });

    expect((await publicRows(s))[0]).toMatchObject({
      body: "A better way to say it.",
      editedAt: Date.now(),
    });
  });

  it("can't be edited into something that isn't allowed, and saving the same words changes nothing", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);

    await expect(
      s.t.mutation(api.guestComments.edit, { token, commentId, body: "no" }),
    ).rejects.toThrow(/at least 3 characters/);
    await s.t.mutation(api.guestComments.edit, {
      token,
      commentId,
      body: GOOD,
    });
    expect((await stored(s, commentId))?.editedAt).toBeUndefined();
  });

  it("can be removed, and the count goes down", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);
    expect(await count(s)).toBe(1);

    await s.t.mutation(api.guestComments.remove, { token, commentId });

    expect(await publicRows(s)).toEqual([]);
    expect((await stored(s, commentId))?.status).toBe("REMOVED");
    expect(await count(s)).toBe(0);
    expect((await view(s, token))?.comments).toEqual([]);
    // It can't be removed twice, so the count can't go wrong.
    await expect(
      s.t.mutation(api.guestComments.remove, { token, commentId }),
    ).rejects.toThrow(/can't be removed/);
    expect(await count(s)).toBe(0);
  });

  it("can be edited and removed after the fundraiser has stopped taking comments", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { commentsEnabled: false }),
    );

    expect((await view(s, token))?.access).toBe("CLOSED");
    expect((await view(s, token))?.comments).toHaveLength(1);
    await s.t.mutation(api.guestComments.remove, { token, commentId });
    expect(await count(s)).toBe(0);
  });

  it("belong to one link: another link can't touch them", async () => {
    const s = await setup();
    const mine = await guest(s);
    const theirs = await guest(s);
    const commentId = await post(s, mine.token);

    await expect(
      s.t.mutation(api.guestComments.edit, {
        token: theirs.token,
        commentId,
        body: "Someone else's words.",
      }),
    ).rejects.toThrow(/Comment not found/);
    await expect(
      s.t.mutation(api.guestComments.remove, {
        token: theirs.token,
        commentId,
      }),
    ).rejects.toThrow(/Comment not found/);
    expect((await view(s, theirs.token))?.comments).toEqual([]);
    expect((await stored(s, commentId))?.status).toBe("PUBLISHED");
  });

  it("can't be used to change a signed-in donor's comment", async () => {
    const s = await setup();
    const { token } = await guest(s);
    await donate(s, s.ids.fundraiserId, { donorUserId: s.ids.donor });
    const signedIn = await s.donor.mutation(
      api.fundraiserComments.postComment,
      {
        fundraiserId: s.ids.fundraiserId,
        body: GOOD,
      },
    );

    for (const run of [
      () =>
        s.t.mutation(api.guestComments.edit, {
          token,
          commentId: signedIn,
          body: "Hijacked words here.",
        }),
      () =>
        s.t.mutation(api.guestComments.remove, { token, commentId: signedIn }),
    ]) {
      await expect(run()).rejects.toThrow(/Comment not found/);
    }
    expect((await stored(s, signedIn))?.body).toBe(GOOD);
  });

  it("never touches a comment with an account behind it, even one on the same donation", async () => {
    const s = await setup();
    const { donationId, token } = await guest(s);
    // Nothing attaches a guest's donation to an account today. But a comment
    // written by an account is that account's, whatever donation it names, and
    // nothing here should depend on that staying so.
    const signedIn = await s.t.run((ctx) =>
      ctx.db.insert("fundraiserComments", {
        fundraiserId: s.ids.fundraiserId,
        donationId,
        authorUserId: s.ids.donor,
        authorName: "Wanjiru K.",
        body: GOOD,
        status: "PUBLISHED",
        createdAt: Date.now(),
      }),
    );

    const seen = await view(s, token);
    expect(seen?.comments).toEqual([]);
    expect(seen?.hiddenCount).toBe(0);
    for (const run of [
      () =>
        s.t.mutation(api.guestComments.edit, {
          token,
          commentId: signedIn,
          body: "Hijacked words here.",
        }),
      () =>
        s.t.mutation(api.guestComments.remove, { token, commentId: signedIn }),
    ]) {
      await expect(run()).rejects.toThrow(/Comment not found/);
    }
    expect((await stored(s, signedIn))?.body).toBe(GOOD);
    expect((await stored(s, signedIn))?.status).toBe("PUBLISHED");
  });

  it("can't be changed with a link that isn't ours", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);

    await expect(
      s.t.mutation(api.guestComments.edit, {
        token: newToken(),
        commentId,
        body: "Someone else's words.",
      }),
    ).rejects.toThrow(/link isn't valid/);
    await expect(
      s.t.mutation(api.guestComments.remove, { token: "", commentId }),
    ).rejects.toThrow(/link isn't valid/);
  });
});

// ---- Moderation ---------------------------------------------------------

describe("a guest's comment, once it is on the page", () => {
  it("can be hidden by the organizer, and then the guest is told how many were hidden", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);

    await s.owner.mutation(api.fundraiserComments.hideComment, { commentId });

    expect(await publicRows(s)).toEqual([]);
    expect(await count(s)).toBe(0);
    const result = await view(s, token);
    expect(result?.comments).toEqual([]);
    expect(result?.hiddenCount).toBe(1);
    // Hidden is not theirs to undo: the link can neither edit nor remove it.
    await expect(
      s.t.mutation(api.guestComments.remove, { token, commentId }),
    ).rejects.toThrow(/can't be removed/);
    await expect(
      s.t.mutation(api.guestComments.edit, {
        token,
        commentId,
        body: "Trying to change it.",
      }),
    ).rejects.toThrow(/can't be edited/);
  });

  it("is listed with the organizer's hidden comments, and the organizer can put it back", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token);
    await s.owner.mutation(api.fundraiserComments.hideComment, { commentId });

    const hidden = await s.owner.query(api.fundraiserComments.listHidden, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(hidden).toMatchObject([
      { _id: commentId, authorName: NAME, mine: false, canRestore: true },
    ]);

    await s.owner.mutation(api.fundraiserComments.restoreComment, {
      commentId,
    });
    expect(await publicRows(s)).toHaveLength(1);
    expect((await view(s, token))?.hiddenCount).toBe(0);
  });

  it("is not shown to a signed-in stranger as theirs", async () => {
    const s = await setup();
    const { token } = await guest(s);
    await post(s, token);

    const asStranger = await s.stranger.query(api.fundraiserComments.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(),
    });
    expect(asStranger.page.map((row) => row.mine)).toEqual([false]);
    const hidden = await s.stranger.query(api.fundraiserComments.listHidden, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(hidden).toEqual([]);
  });

  it("can be reported by someone signed in, and staff see that it is a guest's", async () => {
    const s = await setup();
    const { token } = await guest(s);
    const commentId = await post(s, token, "Send money to 0700 000 000 now.");
    await s.stranger.mutation(api.fundraiserComments.reportComment, {
      commentId,
      reason: "OFF_PLATFORM_PAYMENT",
    });

    const queue = await s.mod.query(api.fundraiserComments.listReported, {});
    expect(queue).toMatchObject([
      { commentId, authorName: NAME, isGuest: true, reportCount: 1 },
    ]);

    // Staff hide it with a reason, like any other.
    await s.mod.mutation(api.fundraiserComments.hideComment, {
      commentId,
      reason: "Asks for money away from GoUplift",
    });
    expect(await publicRows(s)).toEqual([]);
    expect(await s.mod.query(api.fundraiserComments.listReported, {})).toEqual(
      [],
    );
  });

  it("is marked as a signed-in donor's when it is one, in the same queue", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, { donorUserId: s.ids.donor });
    const commentId = await s.donor.mutation(
      api.fundraiserComments.postComment,
      {
        fundraiserId: s.ids.fundraiserId,
        body: GOOD,
      },
    );
    await s.stranger.mutation(api.fundraiserComments.reportComment, {
      commentId,
      reason: "SPAM",
    });

    const queue = await s.mod.query(api.fundraiserComments.listReported, {});
    expect(queue[0].isGuest).toBe(false);
  });
});
