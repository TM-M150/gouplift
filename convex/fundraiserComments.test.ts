/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ANONYMOUS_DONOR_NAME,
  checkCommentBody,
  COMMENT_RATE_WINDOW_MS,
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS_PER_DAY,
  MAX_REPORTS_PER_DAY,
  MIN_COMMENT_LENGTH,
  REPORT_REASONS,
} from "../lib/comments";

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
type Client = T | ReturnType<T["withIdentity"]>;

const GOOD = "Thank you for doing this. The pump will change so much.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T09:00:00Z"));
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
    const donor2 = await user("auth_donor2", "Otieno Odhiambo");
    const stranger = await user("auth_stranger", "Someone Else");
    const mod = await user("auth_mod", "Mo Derator", "MODERATOR");
    const admin = await user("auth_admin", "Ad Min", "ADMIN");

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
      donor2,
      stranger,
      mod,
      admin,
      fundraiserId: await fundraiser(),
      otherFundraiserId: await fundraiser({ title: "School fees" }),
      privateId: await fundraiser({ isPrivate: true }),
      draftId: await fundraiser({ status: "DRAFT" }),
      pendingId: await fundraiser({ status: "PENDING_REVIEW" }),
      rejectedId: await fundraiser({ status: "REJECTED" }),
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
    donor2: t.withIdentity({ subject: "auth_donor2" }),
    stranger: t.withIdentity({ subject: "auth_stranger" }),
    mod: t.withIdentity({ subject: "auth_mod" }),
    admin: t.withIdentity({ subject: "auth_admin" }),
  };
}
type S = Awaited<ReturnType<typeof setup>>;

/** A donation, by default a completed one by a signed-in donor. */
function donate(
  s: S,
  fundraiserId: Id<"fundraisers">,
  donorUserId: Id<"users"> | undefined,
  extra: Partial<Doc<"donations">> = {},
) {
  return s.t.run((ctx) => {
    const now = Date.now();
    const doc: Omit<Doc<"donations">, "_id" | "_creationTime"> = {
      fundraiserId,
      donorUserId,
      donorEmail: "donor@example.test",
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

const page = (numItems = 20, cursor: string | null = null) => ({
  numItems,
  cursor,
});

async function listRows(client: Client, fundraiserId: Id<"fundraisers">) {
  const result = await client.query(api.fundraiserComments.list, {
    fundraiserId,
    paginationOpts: page(),
  });
  return result.page;
}
async function listBodies(client: Client, fundraiserId: Id<"fundraisers">) {
  return (await listRows(client, fundraiserId)).map((row) => row.body);
}

const count = (s: S, fundraiserId = s.ids.fundraiserId) =>
  s.t.run(async (ctx) => (await ctx.db.get(fundraiserId))?.commentsCount ?? 0);

const stored = (s: S, commentId: Id<"fundraiserComments">) =>
  s.t.run((ctx) => ctx.db.get(commentId));

function comment(client: Client, fundraiserId: Id<"fundraisers">, body = GOOD) {
  return client.mutation(api.fundraiserComments.postComment, {
    fundraiserId,
    body,
  });
}

/** A donor who has given to the main fundraiser, and a comment from them. */
async function withComment(s: S, body = GOOD) {
  await donate(s, s.ids.fundraiserId, s.ids.donor);
  const commentId = await comment(s.donor, s.ids.fundraiserId, body);
  return commentId;
}

describe("the rules for what a comment says", () => {
  it("tidies the text before checking it", () => {
    const result = checkCommentBody("  Well\r\ndone\u0000   \n\n\n\nall  ");
    expect(result).toEqual({ ok: true, body: "Well\ndone\n\nall" });
  });

  it("accepts the shortest and the longest allowed", () => {
    expect(checkCommentBody("x".repeat(MIN_COMMENT_LENGTH)).ok).toBe(true);
    expect(checkCommentBody("x".repeat(MAX_COMMENT_LENGTH)).ok).toBe(true);
  });

  it("explains what is wrong with one that is empty, too short or too long", () => {
    for (const raw of ["", "  \n ", "x".repeat(MIN_COMMENT_LENGTH - 1)]) {
      const result = checkCommentBody(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toMatch(/at least 3/);
    }
    const long = checkCommentBody("x".repeat(MAX_COMMENT_LENGTH + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.problem).toMatch(/under 500/);
  });

  it("counts the length after tidying, so padding doesn't help", () => {
    expect(checkCommentBody(`ab\n\n\n\n     `).ok).toBe(false);
  });
});

describe("who can comment", () => {
  it("lets a signed-in donor comment, under their first name and last initial", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);

    const id = await comment(s.donor, s.ids.fundraiserId);

    expect(await listRows(s.stranger, s.ids.fundraiserId)).toMatchObject([
      { _id: id, authorName: "Wanjiru K.", body: GOOD, editedAt: null },
    ]);
    expect(await count(s)).toBe(1);
  });

  it("refuses someone who is signed out", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await expect(comment(s.t, s.ids.fundraiserId)).rejects.toThrow(/signed in/);
    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([]);
  });

  it("refuses someone who hasn't donated", async () => {
    const s = await setup();
    await expect(comment(s.stranger, s.ids.fundraiserId)).rejects.toThrow(
      /Only people who have donated/,
    );
    expect(await count(s)).toBe(0);
  });

  it("refuses the creator unless they donated too", async () => {
    const s = await setup();
    await expect(comment(s.owner, s.ids.fundraiserId)).rejects.toThrow(
      /Only people who have donated/,
    );
  });

  it("refuses a donation that didn't go through", async () => {
    const s = await setup();
    for (const status of [
      "PENDING",
      "FAILED",
      "CANCELLED",
      "REFUNDED",
    ] as const) {
      await donate(s, s.ids.fundraiserId, s.ids.donor, { status });
    }
    await expect(comment(s.donor, s.ids.fundraiserId)).rejects.toThrow(
      /Only people who have donated/,
    );
  });

  it("does not count a donation to a different fundraiser", async () => {
    const s = await setup();
    await donate(s, s.ids.otherFundraiserId, s.ids.donor);
    await expect(comment(s.donor, s.ids.fundraiserId)).rejects.toThrow(
      /Only people who have donated/,
    );
  });

  it("does not count somebody else's donation, or a guest donation", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor2);
    // A guest gave with the same email as the donor's account: an email
    // address isn't proof of who is signed in, so it doesn't count.
    await donate(s, s.ids.fundraiserId, undefined, {
      donorEmail: "auth_donor@example.test",
    });
    await expect(comment(s.donor, s.ids.fundraiserId)).rejects.toThrow(
      /Only people who have donated/,
    );
  });

  it("only needs one completed donation among any number of others", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor, { status: "FAILED" });
    await donate(s, s.ids.fundraiserId, s.ids.donor, { status: "COMPLETED" });
    await donate(s, s.ids.fundraiserId, s.ids.donor, { status: "PENDING" });
    await expect(comment(s.donor, s.ids.fundraiserId)).resolves.toBeTruthy();
  });

  it("shows 'Anonymous donor' when every donation they made here was anonymous", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor, { isAnonymous: true });
    await donate(s, s.ids.fundraiserId, s.ids.donor, { isAnonymous: true });

    await comment(s.donor, s.ids.fundraiserId);

    const [row] = await listRows(s.stranger, s.ids.fundraiserId);
    expect(row.authorName).toBe(ANONYMOUS_DONOR_NAME);
    expect(JSON.stringify(row)).not.toMatch(/Wanjiru|Kamau/);
  });

  it("uses their name when at least one donation here was not anonymous", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor, { isAnonymous: true });
    await donate(s, s.ids.fundraiserId, s.ids.donor, { isAnonymous: false });

    await comment(s.donor, s.ids.fundraiserId);

    const [row] = await listRows(s.stranger, s.ids.fundraiserId);
    expect(row.authorName).toBe("Wanjiru K.");
  });

  it("never shows a user id, an email address or the donation to readers", async () => {
    const s = await setup();
    await withComment(s);
    const [row] = await listRows(s.stranger, s.ids.fundraiserId);
    expect(Object.keys(row).sort()).toEqual([
      "_id",
      "authorName",
      "body",
      "createdAt",
      "editedAt",
      "mine",
    ]);
  });
});

describe("what the comment box says to each visitor", () => {
  it("is open to a donor, closed to a stranger, and asks a signed-out visitor to sign in", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    const access = (client: Client) =>
      client.query(api.fundraiserComments.myAccess, {
        fundraiserId: s.ids.fundraiserId,
      });

    expect(await access(s.donor)).toBe("CAN_COMMENT");
    expect(await access(s.stranger)).toBe("NOT_A_DONOR");
    expect(await access(s.owner)).toBe("NOT_A_DONOR");
    expect(await access(s.t)).toBe("SIGNED_OUT");
  });

  it("is closed for everyone where comments can't be left", async () => {
    const s = await setup();
    const closed = [
      s.ids.privateId,
      s.ids.draftId,
      s.ids.pendingId,
      s.ids.rejectedId,
      s.ids.cancelledId,
      s.ids.flaggedId,
      s.ids.commentsOffId,
    ];
    for (const id of closed) {
      await donate(s, id, s.ids.donor);
      expect(
        await s.donor.query(api.fundraiserComments.myAccess, {
          fundraiserId: id,
        }),
      ).toBe("CLOSED");
    }
  });

  it("is closed for a fundraiser that has been deleted", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.delete(s.ids.fundraiserId));
    expect(
      await s.donor.query(api.fundraiserComments.myAccess, {
        fundraiserId: s.ids.fundraiserId,
      }),
    ).toBe("CLOSED");
  });
});

describe("which fundraisers take comments", () => {
  it("takes them while it is open, paused, finished or ended", async () => {
    const s = await setup();
    for (const id of [
      s.ids.fundraiserId,
      s.ids.pausedId,
      s.ids.completedId,
      s.ids.expiredId,
    ]) {
      await donate(s, id, s.ids.donor);
      await expect(comment(s.donor, id)).resolves.toBeTruthy();
    }
  });

  it("refuses them while it is cancelled or has comments switched off", async () => {
    const s = await setup();
    for (const id of [s.ids.cancelledId, s.ids.commentsOffId]) {
      await donate(s, id, s.ids.donor);
      await expect(comment(s.donor, id)).rejects.toThrow(/closed/);
    }
  });

  it("answers 'not found' for one the person can't see, not 'closed'", async () => {
    const s = await setup();
    // A suspended fundraiser is one of these: off the public site, as if it
    // weren't there, while staff look into a report.
    for (const id of [
      s.ids.privateId,
      s.ids.draftId,
      s.ids.pendingId,
      s.ids.rejectedId,
      s.ids.flaggedId,
    ]) {
      await donate(s, id, s.ids.donor);
      await expect(comment(s.donor, id)).rejects.toThrow(/not found/);
    }
  });
});

describe("what a posted comment looks like", () => {
  it("is tidied, and a bad one is refused without using up the day's allowance", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);

    for (let i = 0; i < MAX_COMMENTS_PER_DAY * 2; i++) {
      await expect(comment(s.donor, s.ids.fundraiserId, "no")).rejects.toThrow(
        /at least 3/,
      );
    }
    await comment(
      s.donor,
      s.ids.fundraiserId,
      "  Great\r\n\r\n\r\n\r\nwork \u0000 ",
    );

    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([
      "Great\n\nwork",
    ]);
  });

  it("is refused when it is too long", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await expect(
      comment(s.donor, s.ids.fundraiserId, "x".repeat(MAX_COMMENT_LENGTH + 1)),
    ).rejects.toThrow(/under 500/);
  });

  it("keeps markup as plain text", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await comment(s.donor, s.ids.fundraiserId, `<script>alert(1)</script> Hi`);
    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([
      "<script>alert(1)</script> Hi",
    ]);
  });
});

describe("how often someone can comment", () => {
  it("allows a handful a day on one fundraiser, then asks them to wait", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);

    for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) {
      await comment(s.donor, s.ids.fundraiserId, `Comment number ${i}`);
    }
    await expect(comment(s.donor, s.ids.fundraiserId)).rejects.toThrow(
      /Please try again tomorrow/,
    );
    expect(await count(s)).toBe(MAX_COMMENTS_PER_DAY);
  });

  it("starts again the next day", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) {
      await comment(s.donor, s.ids.fundraiserId, `Comment number ${i}`);
    }

    vi.advanceTimersByTime(COMMENT_RATE_WINDOW_MS + 1000);

    await expect(comment(s.donor, s.ids.fundraiserId)).resolves.toBeTruthy();
  });

  it("counts each person and each fundraiser on its own", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await donate(s, s.ids.otherFundraiserId, s.ids.donor);
    await donate(s, s.ids.fundraiserId, s.ids.donor2);
    for (let i = 0; i < MAX_COMMENTS_PER_DAY; i++) {
      await comment(s.donor, s.ids.fundraiserId, `Comment number ${i}`);
    }

    await expect(
      comment(s.donor, s.ids.otherFundraiserId),
    ).resolves.toBeTruthy();
    await expect(comment(s.donor2, s.ids.fundraiserId)).resolves.toBeTruthy();
  });
});

describe("reading the comments", () => {
  it("lists the newest first", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await comment(s.donor, s.ids.fundraiserId, "The first one");
    vi.advanceTimersByTime(1000);
    await comment(s.donor, s.ids.fundraiserId, "The second one");
    vi.advanceTimersByTime(1000);
    await comment(s.donor, s.ids.fundraiserId, "The third one");

    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([
      "The third one",
      "The second one",
      "The first one",
    ]);
  });

  it("is open to a visitor who isn't signed in", async () => {
    const s = await setup();
    await withComment(s);
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([GOOD]);
  });

  it("marks the reader's own comments as theirs, and nobody else's", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await donate(s, s.ids.fundraiserId, s.ids.donor2);
    await comment(s.donor, s.ids.fundraiserId, "From the first donor");
    await comment(s.donor2, s.ids.fundraiserId, "From the second donor");

    const mine = async (client: Client) =>
      (await listRows(client, s.ids.fundraiserId)).map((row) => [
        row.body,
        row.mine,
      ]);

    expect(await mine(s.donor)).toEqual([
      ["From the second donor", false],
      ["From the first donor", true],
    ]);
    expect(await mine(s.stranger)).toEqual([
      ["From the second donor", false],
      ["From the first donor", false],
    ]);
    expect((await mine(s.t)).every(([, isMine]) => isMine === false)).toBe(
      true,
    );
  });

  it("leaves out hidden and removed comments", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    const hidden = await comment(s.donor, s.ids.fundraiserId, "To be hidden");
    const removed = await comment(s.donor, s.ids.fundraiserId, "To be removed");
    await comment(s.donor, s.ids.fundraiserId, "Stays up");
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: hidden,
    });
    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: removed,
    });

    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([
      "Stays up",
    ]);
  });

  it("gives nothing for a fundraiser the reader may not see, and shows it to the creator", async () => {
    const s = await setup();
    await withComment(s);
    // The fundraiser goes private after the comment was left.
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { isPrivate: true }),
    );

    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([]);
    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([]);
    expect(await listBodies(s.owner, s.ids.fundraiserId)).toEqual([GOOD]);
    expect(await listBodies(s.mod, s.ids.fundraiserId)).toEqual([GOOD]);
  });

  it("gives nothing for a fundraiser that doesn't exist any more", async () => {
    const s = await setup();
    await withComment(s);
    await s.t.run((ctx) => ctx.db.delete(s.ids.fundraiserId));
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([]);
  });

  it("caps a page at 50, whatever is asked for", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("fundraiserComments", {
          fundraiserId: s.ids.fundraiserId,
          authorUserId: s.ids.donor,
          donationId: await ctx.db.insert("donations", {
            fundraiserId: s.ids.fundraiserId,
            isAnonymous: false,
            grossAmount: 1,
            currency: "KES",
            platformFeeRate: 0,
            platformFeeAmount: 0,
            netAmount: 1,
            status: "COMPLETED",
            payoutStatus: "PENDING_PAYOUT",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
          authorName: "Wanjiru K.",
          body: `Comment ${i}`,
          status: "PUBLISHED",
          createdAt: Date.now() + i,
        });
      }
    });

    const first = await s.t.query(api.fundraiserComments.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(1000),
    });
    expect(first.page).toHaveLength(50);
    expect(first.isDone).toBe(false);

    const second = await s.t.query(api.fundraiserComments.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(1000, first.continueCursor),
    });
    expect(second.page).toHaveLength(5);
  });
});

describe("editing and removing your own comment", () => {
  it("lets the author change the text, and says it was edited", async () => {
    const s = await setup();
    const id = await withComment(s);
    const postedAt = (await stored(s, id))!.createdAt;
    vi.advanceTimersByTime(60_000);

    await s.donor.mutation(api.fundraiserComments.editComment, {
      commentId: id,
      body: "  A better thought.  ",
    });

    const [row] = await listRows(s.stranger, s.ids.fundraiserId);
    expect(row.body).toBe("A better thought.");
    // The test clock can move a millisecond or two on its own, so check it
    // is about a minute after posting rather than an exact value.
    expect(row.editedAt).toBeGreaterThan(postedAt + 59_000);
    expect(row.editedAt).toBeLessThan(postedAt + 61_000);
  });

  it("does nothing, and doesn't say edited, when the text is the same", async () => {
    const s = await setup();
    const id = await withComment(s);
    vi.advanceTimersByTime(5000);

    await s.donor.mutation(api.fundraiserComments.editComment, {
      commentId: id,
      body: ` ${GOOD} `,
    });

    expect((await stored(s, id))?.editedAt).toBeUndefined();
  });

  it("checks the new text like a new comment", async () => {
    const s = await setup();
    const id = await withComment(s);
    await expect(
      s.donor.mutation(api.fundraiserComments.editComment, {
        commentId: id,
        body: "no",
      }),
    ).rejects.toThrow(/at least 3/);
    expect((await stored(s, id))?.body).toBe(GOOD);
  });

  it("is only for the author: everyone else is told it isn't there", async () => {
    const s = await setup();
    const id = await withComment(s);

    for (const who of [s.stranger, s.owner, s.mod, s.admin, s.t]) {
      await expect(
        who.mutation(api.fundraiserComments.editComment, {
          commentId: id,
          body: "Changed by someone else",
        }),
      ).rejects.toThrow(/not found|signed in/);
      await expect(
        who.mutation(api.fundraiserComments.removeComment, { commentId: id }),
      ).rejects.toThrow(/not found|signed in/);
    }
    expect((await stored(s, id))?.body).toBe(GOOD);
    expect((await stored(s, id))?.status).toBe("PUBLISHED");
  });

  it("takes the comment down when the author removes it, and the count follows", async () => {
    const s = await setup();
    const id = await withComment(s);
    expect(await count(s)).toBe(1);

    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: id,
    });

    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([]);
    expect((await stored(s, id))?.status).toBe("REMOVED");
    expect(await count(s)).toBe(0);
  });

  it("never lets the count fall below zero, even if it had got out of step", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { commentsCount: 0 }),
    );

    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: id,
    });

    expect(await count(s)).toBe(0);
  });

  it("can't be edited or removed again once removed", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: id,
    });

    await expect(
      s.donor.mutation(api.fundraiserComments.removeComment, { commentId: id }),
    ).rejects.toThrow(/can't be removed/);
    await expect(
      s.donor.mutation(api.fundraiserComments.editComment, {
        commentId: id,
        body: "Back from the dead",
      }),
    ).rejects.toThrow(/can't be edited/);
    expect(await count(s)).toBe(0);
  });

  it("can't be changed by the author once someone has hidden it", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
    });

    await expect(
      s.donor.mutation(api.fundraiserComments.editComment, {
        commentId: id,
        body: "Sneaking an edit in",
      }),
    ).rejects.toThrow(/can't be edited/);
    await expect(
      s.donor.mutation(api.fundraiserComments.removeComment, { commentId: id }),
    ).rejects.toThrow(/can't be removed/);
  });
});

describe("the creator hiding a comment", () => {
  it("takes it off the page without a reason, and the count follows", async () => {
    const s = await setup();
    const id = await withComment(s);

    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
    });

    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([]);
    expect(await stored(s, id)).toMatchObject({
      status: "HIDDEN",
      hiddenBy: "CREATOR",
      hiddenByUserId: s.ids.owner,
    });
    expect(await count(s)).toBe(0);
  });

  it("is only for the creator of that fundraiser", async () => {
    const s = await setup();
    const id = await withComment(s);
    // Someone who owns a different fundraiser has no say here.
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.otherFundraiserId, { creatorId: s.ids.stranger }),
    );

    for (const who of [s.donor, s.stranger, s.t]) {
      await expect(
        who.mutation(api.fundraiserComments.hideComment, { commentId: id }),
      ).rejects.toThrow(/not found|signed in/);
    }
    expect((await stored(s, id))?.status).toBe("PUBLISHED");
    expect(await count(s)).toBe(1);
  });

  it("can't hide one that is already hidden or removed, so the count stays right", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
    });
    await expect(
      s.owner.mutation(api.fundraiserComments.hideComment, { commentId: id }),
    ).rejects.toThrow(/Only a published comment/);
    expect(await count(s)).toBe(0);
  });

  it("can put back one they hid", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
    });

    await s.owner.mutation(api.fundraiserComments.restoreComment, {
      commentId: id,
    });

    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([GOOD]);
    expect(await stored(s, id)).toMatchObject({ status: "PUBLISHED" });
    expect((await stored(s, id))?.hiddenBy).toBeUndefined();
    expect(await count(s)).toBe(1);
  });

  it("can't put back one that staff hid", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.mod.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
      reason: "Asks donors to send money to a number",
    });

    await expect(
      s.owner.mutation(api.fundraiserComments.restoreComment, {
        commentId: id,
      }),
    ).rejects.toThrow(/Only GoUplift staff/);
    expect(await listBodies(s.stranger, s.ids.fundraiserId)).toEqual([]);
  });

  it("is not something the author or a stranger can undo", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
    });

    for (const who of [s.donor, s.stranger, s.t]) {
      await expect(
        who.mutation(api.fundraiserComments.restoreComment, { commentId: id }),
      ).rejects.toThrow(/not found|signed in/);
    }
    expect((await stored(s, id))?.status).toBe("HIDDEN");
  });

  it("can't restore a comment that isn't hidden", async () => {
    const s = await setup();
    const id = await withComment(s);
    await expect(
      s.owner.mutation(api.fundraiserComments.restoreComment, {
        commentId: id,
      }),
    ).rejects.toThrow(/Only a hidden comment/);
    expect(await count(s)).toBe(1);
  });
});

describe("staff hiding a comment", () => {
  it("needs a reason, and writes it in the audit log", async () => {
    const s = await setup();
    const id = await withComment(s);

    await expect(
      s.mod.mutation(api.fundraiserComments.hideComment, { commentId: id }),
    ).rejects.toThrow(/reason/);
    await expect(
      s.mod.mutation(api.fundraiserComments.hideComment, {
        commentId: id,
        reason: "too short",
      }),
    ).rejects.toThrow(/at least 10/);
    expect((await stored(s, id))?.status).toBe("PUBLISHED");

    await s.mod.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
      reason: "  Asks donors to send money to a number  ",
    });

    expect(await stored(s, id)).toMatchObject({
      status: "HIDDEN",
      hiddenBy: "STAFF",
      hiddenReason: "Asks donors to send money to a number",
    });
    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log).toMatchObject([
      {
        actorId: s.ids.mod,
        action: "FUNDRAISER_COMMENT_HIDDEN",
        fundraiserId: s.ids.fundraiserId,
        fundraiserCommentId: id,
        statusBefore: "PUBLISHED",
        statusAfter: "HIDDEN",
        note: "Asks donors to send money to a number",
      },
    ]);
    expect(await count(s)).toBe(0);
  });

  it("can put back any hidden comment, creator-hidden ones too, and logs it", async () => {
    const s = await setup();
    const byCreator = await withComment(s, "Hidden by the creator");
    const byStaff = await comment(
      s.donor,
      s.ids.fundraiserId,
      "Hidden by staff",
    );
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: byCreator,
    });
    await s.admin.mutation(api.fundraiserComments.hideComment, {
      commentId: byStaff,
      reason: "Abusive towards the organizer",
    });

    await s.mod.mutation(api.fundraiserComments.restoreComment, {
      commentId: byCreator,
    });
    await s.admin.mutation(api.fundraiserComments.restoreComment, {
      commentId: byStaff,
    });

    expect((await listBodies(s.t, s.ids.fundraiserId)).sort()).toEqual([
      "Hidden by staff",
      "Hidden by the creator",
    ]);
    expect(await count(s)).toBe(2);
    const actions = (
      await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect())
    ).map((row) => row.action);
    expect(actions).toContain("FUNDRAISER_COMMENT_RESTORED");
  });
});

describe("who sees the hidden comments", () => {
  async function hiddenSetup() {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    await donate(s, s.ids.fundraiserId, s.ids.donor2);
    const byCreator = await comment(
      s.donor,
      s.ids.fundraiserId,
      "Hidden by the creator",
    );
    const byStaff = await comment(
      s.donor2,
      s.ids.fundraiserId,
      "Hidden by staff",
    );
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: byCreator,
    });
    await s.mod.mutation(api.fundraiserComments.hideComment, {
      commentId: byStaff,
      reason: "Shares a private phone number",
    });
    return { s, byCreator, byStaff };
  }
  const hidden = (s: S, client: Client) =>
    client.query(api.fundraiserComments.listHidden, {
      fundraiserId: s.ids.fundraiserId,
    });

  it("shows staff all of them, with who hid them and why", async () => {
    const { s } = await hiddenSetup();
    const rows = await hidden(s, s.admin);
    expect(
      rows.map((row) => [row.body, row.hiddenBy, row.reason, row.canRestore]),
    ).toEqual(
      expect.arrayContaining([
        ["Hidden by the creator", "CREATOR", null, true],
        ["Hidden by staff", "STAFF", "Shares a private phone number", true],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("shows the creator all of them, without the reason, and lets them restore only their own", async () => {
    const { s } = await hiddenSetup();
    const rows = await hidden(s, s.owner);
    expect(
      rows.map((row) => [row.body, row.hiddenBy, row.reason, row.canRestore]),
    ).toEqual(
      expect.arrayContaining([
        ["Hidden by the creator", "CREATOR", null, true],
        ["Hidden by staff", "STAFF", null, false],
      ]),
    );
    expect(JSON.stringify(rows)).not.toMatch(/private phone number/);
  });

  it("shows an author only their own, without saying who hid it", async () => {
    const { s } = await hiddenSetup();
    const rows = await hidden(s, s.donor);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      body: "Hidden by the creator",
      hiddenBy: null,
      reason: null,
      canRestore: false,
      mine: true,
    });
  });

  it("shows nobody else anything", async () => {
    const { s } = await hiddenSetup();
    expect(await hidden(s, s.stranger)).toEqual([]);
    expect(await hidden(s, s.t)).toEqual([]);
  });
});

describe("reporting a comment", () => {
  const reportAs = (client: Client, commentId: Id<"fundraiserComments">) =>
    client.mutation(api.fundraiserComments.reportComment, {
      commentId,
      reason: "SPAM",
    });
  const reports = (s: S) =>
    s.t.run((ctx) => ctx.db.query("fundraiserCommentReports").collect());

  it("needs someone signed in, but not a donor", async () => {
    const s = await setup();
    const id = await withComment(s);

    await expect(reportAs(s.t, id)).rejects.toThrow(/signed in/);
    await reportAs(s.stranger, id);

    expect(await reports(s)).toMatchObject([
      {
        commentId: id,
        fundraiserId: s.ids.fundraiserId,
        reporterUserId: s.ids.stranger,
        reason: "SPAM",
        status: "OPEN",
      },
    ]);
  });

  it("accepts each reason the form offers", async () => {
    const s = await setup();
    const id = await withComment(s);
    const reporters = [s.stranger, s.donor2, s.owner, s.mod, s.admin];
    expect(REPORT_REASONS).toHaveLength(5);
    for (const [index, reason] of REPORT_REASONS.entries()) {
      await reporters[index].mutation(api.fundraiserComments.reportComment, {
        commentId: id,
        reason,
      });
    }
    expect((await reports(s)).map((row) => row.reason).sort()).toEqual(
      [...REPORT_REASONS].sort(),
    );
  });

  it("refuses a reason that isn't one of them", async () => {
    const s = await setup();
    const id = await withComment(s);
    await expect(
      s.stranger.mutation(api.fundraiserComments.reportComment, {
        commentId: id,
        // @ts-expect-error not one of the reasons
        reason: "I just don't like it",
      }),
    ).rejects.toThrow();
    expect(await reports(s)).toHaveLength(0);
  });

  it("can't be about your own comment", async () => {
    const s = await setup();
    const id = await withComment(s);
    await expect(reportAs(s.donor, id)).rejects.toThrow(/your own comment/);
  });

  it("can't be about a comment that isn't showing", async () => {
    const s = await setup();
    const hidden = await withComment(s, "Hidden one");
    const removed = await comment(s.donor, s.ids.fundraiserId, "Removed one");
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: hidden,
    });
    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: removed,
    });

    await expect(reportAs(s.stranger, hidden)).rejects.toThrow(/not found/);
    await expect(reportAs(s.stranger, removed)).rejects.toThrow(/not found/);
    expect(await reports(s)).toHaveLength(0);
  });

  it("can't be about a comment on a fundraiser the reporter may not see", async () => {
    const s = await setup();
    const id = await withComment(s);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { isPrivate: true }),
    );
    await expect(reportAs(s.stranger, id)).rejects.toThrow(/not found/);
  });

  it("changes nothing the second time, and doesn't count against the limit", async () => {
    const s = await setup();
    const id = await withComment(s);

    for (let i = 0; i < MAX_REPORTS_PER_DAY * 2; i++) {
      await reportAs(s.stranger, id);
    }

    expect(await reports(s)).toHaveLength(1);
  });

  it("is limited to a number a day per person", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    const ids: Id<"fundraiserComments">[] = [];
    // Several comments from one donor, spread over days so they aren't limited.
    for (let i = 0; i < MAX_REPORTS_PER_DAY + 1; i++) {
      ids.push(await comment(s.donor, s.ids.fundraiserId, `Comment ${i} here`));
      if (i % MAX_COMMENTS_PER_DAY === MAX_COMMENTS_PER_DAY - 1) {
        vi.advanceTimersByTime(COMMENT_RATE_WINDOW_MS + 1000);
      }
    }
    // The reporter's own day starts now.
    vi.advanceTimersByTime(1000);

    for (const id of ids.slice(0, MAX_REPORTS_PER_DAY)) {
      await reportAs(s.stranger, id);
    }
    await expect(
      reportAs(s.stranger, ids[MAX_REPORTS_PER_DAY]),
    ).rejects.toThrow(/Please try again tomorrow/);
    // Someone else's allowance is their own.
    await expect(
      reportAs(s.donor2, ids[MAX_REPORTS_PER_DAY]),
    ).resolves.toBeNull();
  });
});

describe("the staff queue of reported comments", () => {
  const queue = (client: Client) =>
    client.query(api.fundraiserComments.listReported, {});
  const report = (
    client: Client,
    commentId: Id<"fundraiserComments">,
    reason: (typeof REPORT_REASONS)[number] = "SPAM",
  ) =>
    client.mutation(api.fundraiserComments.reportComment, {
      commentId,
      reason,
    });

  it("is for staff only", async () => {
    const s = await setup();
    const id = await withComment(s);
    await report(s.stranger, id);

    expect(await queue(s.mod)).toHaveLength(1);
    expect(await queue(s.admin)).toHaveLength(1);
    for (const who of [s.owner, s.donor, s.stranger, s.t]) {
      expect(await queue(who)).toEqual([]);
    }
  });

  it("has one entry per comment, with how many reports and for what", async () => {
    const s = await setup();
    const id = await withComment(s, "A reported comment");
    await report(s.stranger, id, "SPAM");
    await report(s.donor2, id, "SPAM");
    await report(s.owner, id, "ABUSIVE");

    expect(await queue(s.mod)).toMatchObject([
      {
        commentId: id,
        fundraiserId: s.ids.fundraiserId,
        fundraiserTitle: "Water for Kajiado",
        authorName: "Wanjiru K.",
        body: "A reported comment",
        reportCount: 3,
      },
    ]);
    const [row] = await queue(s.mod);
    expect(row.reasons).toEqual(
      expect.arrayContaining([
        { reason: "SPAM", count: 2 },
        { reason: "ABUSIVE", count: 1 },
      ]),
    );
    expect(row.reasons).toHaveLength(2);
  });

  it("puts the comment reported longest ago first, dated from its first report", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    const older = await comment(s.donor, s.ids.fundraiserId, "Reported first");
    const newer = await comment(s.donor, s.ids.fundraiserId, "Reported second");
    const start = Date.now();
    await report(s.stranger, older);
    vi.advanceTimersByTime(60_000);
    await report(s.stranger, newer);
    vi.advanceTimersByTime(60_000);
    // A second report on the newer one doesn't push it ahead of the older.
    await report(s.donor2, newer);

    const rows = await queue(s.mod);
    expect(rows.map((row) => row.body)).toEqual([
      "Reported first",
      "Reported second",
    ]);
    // The queue says when each was first reported, not when last.
    expect(Math.abs(rows[0].firstReportedAt - start)).toBeLessThan(1000);
    expect(Math.abs(rows[1].firstReportedAt - (start + 60_000))).toBeLessThan(
      1000,
    );
  });

  it("leaves out a comment that is no longer showing", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId, s.ids.donor);
    const hidden = await comment(s.donor, s.ids.fundraiserId, "Hidden one");
    const removed = await comment(s.donor, s.ids.fundraiserId, "Removed one");
    const showing = await comment(s.donor, s.ids.fundraiserId, "Still up");
    for (const id of [hidden, removed, showing]) await report(s.stranger, id);

    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: hidden,
    });
    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: removed,
    });

    expect((await queue(s.mod)).map((row) => row.body)).toEqual(["Still up"]);
  });

  it("is cleared by hiding the comment, which marks its reports as acted on", async () => {
    const s = await setup();
    const id = await withComment(s);
    await report(s.stranger, id);
    await report(s.donor2, id);

    await s.mod.mutation(api.fundraiserComments.hideComment, {
      commentId: id,
      reason: "Abusive towards the organizer",
    });

    expect(await queue(s.mod)).toEqual([]);
    const rows = await s.t.run((ctx) =>
      ctx.db.query("fundraiserCommentReports").collect(),
    );
    expect(rows.map((row) => row.status)).toEqual(["ACTIONED", "ACTIONED"]);
    expect(rows.every((row) => row.resolvedBy === s.ids.mod)).toBe(true);
  });

  it("is cleared by dismissing the reports, which leaves the comment up", async () => {
    const s = await setup();
    const id = await withComment(s);
    await report(s.stranger, id);

    await s.mod.mutation(api.fundraiserComments.dismissReports, {
      commentId: id,
    });

    expect(await queue(s.mod)).toEqual([]);
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([GOOD]);
    const [row] = await s.t.run((ctx) =>
      ctx.db.query("fundraiserCommentReports").collect(),
    );
    expect(row.status).toBe("DISMISSED");
    const log = await s.t.run((ctx) => ctx.db.query("adminAuditLog").collect());
    expect(log).toMatchObject([
      {
        actorId: s.ids.mod,
        action: "FUNDRAISER_COMMENT_REPORTS_DISMISSED",
        fundraiserCommentId: id,
      },
    ]);
  });

  it("brings a comment back to the queue when someone reports it again after a dismissal", async () => {
    const s = await setup();
    const id = await withComment(s);
    await report(s.stranger, id);
    await s.mod.mutation(api.fundraiserComments.dismissReports, {
      commentId: id,
    });

    await report(s.donor2, id);

    expect(await queue(s.mod)).toMatchObject([
      { commentId: id, reportCount: 1 },
    ]);
  });

  it("only lets staff dismiss", async () => {
    const s = await setup();
    const id = await withComment(s);
    await report(s.stranger, id);

    for (const who of [s.owner, s.donor, s.stranger, s.t]) {
      await expect(
        who.mutation(api.fundraiserComments.dismissReports, { commentId: id }),
      ).rejects.toThrow(/permission|signed in/);
    }
    expect(await queue(s.mod)).toHaveLength(1);
  });

  it("keeps working for a fundraiser that has since been deleted", async () => {
    const s = await setup();
    const id = await withComment(s);
    await report(s.stranger, id);
    await s.t.run((ctx) => ctx.db.delete(s.ids.fundraiserId));

    expect(await queue(s.mod)).toMatchObject([
      { commentId: id, fundraiserTitle: "Deleted fundraiser" },
    ]);
  });
});
