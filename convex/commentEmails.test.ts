/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { EMAIL_FROM, MAX_EMAIL_ATTEMPTS } from "./lib/email";
import {
  COMMENT_EMAIL_BATCH_DELAY_MS,
  COMMENT_EMAIL_MAX_COUNT,
  COMMENT_EMAIL_MIN_GAP_MS,
  COMMENT_EMAIL_STALE_MS,
} from "../lib/comment-emails";
import { SITE_URL } from "../lib/site";

// Identity comes from convex-test; the HTTP router registers the sign-in
// routes when it loads, so the mock offers that too.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
    registerRoutes: () => {},
  },
  createAuth: () => ({}),
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const CONVEX_SITE = "https://example-123.convex.site";
const SECRET_TEXT = "SECRET-COMMENT-TEXT: send the rest to 0712 000 000";
const GOOD = "Thank you for doing this. The pump will change so much.";

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
const reply = (status: number, body = "") => new Response(body, { status });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T09:00:00Z"));
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
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
    const owner = await user("auth_owner", "Grace Wanjiku");
    const donor = await user("auth_donor", "Wanjiru Kamau");
    const donor2 = await user("auth_donor2", "Otieno Odhiambo");
    const other = await user("auth_other", "Other Organizer");

    const fundraiser = (
      creatorId: Id<"users">,
      title: string,
      extra: Partial<Doc<"fundraisers">> = {},
    ) =>
      ctx.db.insert("fundraisers", {
        creatorId,
        beneficiaryType: "SELF",
        title,
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
      other,
      fundraiserId: await fundraiser(owner, "Water for Kajiado"),
      secondId: await fundraiser(owner, "School fees"),
      othersId: await fundraiser(other, "Someone else's fundraiser"),
    };
  });

  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "auth_owner" }),
    donor: t.withIdentity({ subject: "auth_donor" }),
    donor2: t.withIdentity({ subject: "auth_donor2" }),
  };
}
type S = Awaited<ReturnType<typeof setup>>;
type Client = S["donor"];

/** A completed donation, which is what lets a signed-in donor comment. */
function donate(
  s: S,
  fundraiserId: Id<"fundraisers">,
  donorUserId: Id<"users">,
) {
  return s.t.run((ctx) => {
    const now = Date.now();
    return ctx.db.insert("donations", {
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
    });
  });
}

/** Everyone who might comment has given to every fundraiser here. */
async function everyoneDonates(s: S) {
  for (const fundraiserId of [
    s.ids.fundraiserId,
    s.ids.secondId,
    s.ids.othersId,
  ]) {
    for (const who of [s.ids.donor, s.ids.donor2, s.ids.owner]) {
      await donate(s, fundraiserId, who);
    }
  }
}

function comment(client: Client, fundraiserId: Id<"fundraisers">, body = GOOD) {
  return client.mutation(api.fundraiserComments.postComment, {
    fundraiserId,
    body,
  });
}

const deliveries = (t: T) =>
  t.run((ctx) => ctx.db.query("commentEmailDeliveries").collect());
const states = (t: T) =>
  t.run((ctx) => ctx.db.query("commentEmailState").collect());
const userDoc = (t: T, id: Id<"users">) => t.run((ctx) => ctx.db.get(id));
const patchUser = (t: T, id: Id<"users">, patch: Partial<Doc<"users">>) =>
  t.run((ctx) => ctx.db.patch(id, patch));
const patchFundraiser = (
  t: T,
  id: Id<"fundraisers">,
  patch: Partial<Doc<"fundraisers">>,
) => t.run((ctx) => ctx.db.patch(id, patch));

/** The planned digests that haven't run yet. */
const plannedDigests = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name.includes("queueDigest") && job.state.kind === "pending",
    ),
  );

/** What was handed to Resend, call by call. */
const sentEmails = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
      headers?: Record<string, string>;
    },
  }));

/** Within a second: the test clock drifts a little as scheduled work runs. */
function expectAround(actual: number | undefined, expected: number) {
  expect(actual).toBeDefined();
  expect(actual!).toBeGreaterThanOrEqual(expected);
  expect(actual!).toBeLessThan(expected + 1000);
}

/** Posts one comment from a donor and lets the digest go out. */
async function oneDigest(s: S, fundraiserId = s.ids.fundraiserId) {
  await comment(s.donor, fundraiserId);
  await settle(s.t);
}

const MIN = 60_000;
const DAY = COMMENT_EMAIL_MIN_GAP_MS;

describe("emailing the organizer about a new comment", () => {
  it("sends one email, a few minutes after the first comment", async () => {
    const s = await setup();
    await everyoneDonates(s);
    const posted = Date.now();

    await comment(s.donor, s.ids.fundraiserId);
    // Nothing yet: it waits so a burst of comments can share one email.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);

    await settle(s.t);

    const [row] = await deliveries(s.t);
    expect(row).toMatchObject({
      fundraiserId: s.ids.fundraiserId,
      recipientUserId: s.ids.owner,
      count: 1,
      hasMore: false,
      status: "SENT",
      attempts: 1,
      generation: 0,
    });
    expect(row.createdAt - posted).toBeGreaterThanOrEqual(
      COMMENT_EMAIL_BATCH_DELAY_MS,
    );
    expect(row.createdAt - posted).toBeLessThan(
      COMMENT_EMAIL_BATCH_DELAY_MS + 1000,
    );

    const [email] = sentEmails();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(email.body).toMatchObject({
      from: EMAIL_FROM,
      to: ["auth_owner@example.test"],
      subject: "1 new comment on Water for Kajiado",
    });
    expect(email.body.text).toContain(
      `${SITE_URL}/fundraiser/${s.ids.fundraiserId}#comments`,
    );
  });

  it("puts a burst of comments in the one email", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    vi.advanceTimersByTime(2 * MIN);
    await comment(s.donor2, s.ids.fundraiserId);
    vi.advanceTimersByTime(2 * MIN);
    await comment(s.donor, s.ids.fundraiserId, "A second thought, same donor.");
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEmails()[0].body.subject).toBe(
      "3 new comments on Water for Kajiado",
    );
    expect(await deliveries(s.t)).toMatchObject([{ count: 3 }]);
  });

  it("plans one digest, however many comments come in while it waits", async () => {
    const s = await setup();
    await everyoneDonates(s);
    const start = Date.now();

    await comment(s.donor, s.ids.fundraiserId);
    await comment(s.donor2, s.ids.fundraiserId);
    await comment(s.donor, s.ids.fundraiserId, "Another from the same donor.");

    expect(await plannedDigests(s.t)).toHaveLength(1);
    // Set by the first comment; the later ones don't push it back.
    const [state] = await states(s.t);
    expectAround(state.pendingFor, start + COMMENT_EMAIL_BATCH_DELAY_MS);
  });

  it("never carries what a comment says, or who wrote it", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId, SECRET_TEXT);
    await comment(s.donor2, s.ids.fundraiserId, `${SECRET_TEXT} again`);
    await settle(s.t);

    const [email] = sentEmails();
    for (const part of [email.body.subject, email.body.html, email.body.text]) {
      expect(part).not.toContain("SECRET-COMMENT-TEXT");
      expect(part).not.toContain("0712");
      expect(part).not.toContain("Wanjiru");
      expect(part).not.toContain("Otieno");
    }
  });

  it("says nothing about comments the organizer made on their own fundraiser", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.owner, s.ids.fundraiserId, "Thank you all so much!");
    await settle(s.t);

    // Nothing is planned for it, and nothing is sent.
    expect(await states(s.t)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);
  });

  it("does not count the organizer's own comments among the donors'", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    await comment(s.owner, s.ids.fundraiserId, "Thank you all so much!");
    await comment(s.owner, s.ids.fundraiserId, "I will post a photo soon.");
    await settle(s.t);

    expect(sentEmails()[0].body.subject).toBe(
      "1 new comment on Water for Kajiado",
    );
  });

  it("leaves out comments from before emails started, and counts only the new ones", async () => {
    const s = await setup();
    await everyoneDonates(s);
    // Two comments written before anything was tracked for this fundraiser.
    await s.t.run(async (ctx) => {
      const donation = (await ctx.db.query("donations").first())!;
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("fundraiserComments", {
          fundraiserId: s.ids.fundraiserId,
          authorUserId: s.ids.donor2,
          donationId: donation._id,
          authorName: "Otieno O.",
          body: `An old comment, number ${i}.`,
          status: "PUBLISHED",
          createdAt: Date.now() - (i + 1) * DAY,
        });
      }
    });

    await comment(s.donor, s.ids.fundraiserId);
    await settle(s.t);

    expect(sentEmails()[0].body.subject).toBe(
      "1 new comment on Water for Kajiado",
    );
  });

  it("keeps each fundraiser's emails separate", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    await comment(s.donor, s.ids.secondId);
    await comment(s.donor2, s.ids.othersId);
    await settle(s.t);

    const sent = sentEmails().map((e) => ({
      to: e.body.to[0],
      subject: e.body.subject,
    }));
    expect(sent).toHaveLength(3);
    expect(sent).toEqual(
      expect.arrayContaining([
        {
          to: "auth_owner@example.test",
          subject: "1 new comment on Water for Kajiado",
        },
        {
          to: "auth_owner@example.test",
          subject: "1 new comment on School fees",
        },
        {
          to: "auth_other@example.test",
          subject: "1 new comment on Someone else's fundraiser",
        },
      ]),
    );
  });

  it("counts only the first 100, and says there are more", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await comment(s.donor, s.ids.fundraiserId);
    await s.t.run(async (ctx) => {
      const donation = (await ctx.db.query("donations").first())!;
      for (let i = 0; i < COMMENT_EMAIL_MAX_COUNT + 4; i++) {
        await ctx.db.insert("fundraiserComments", {
          fundraiserId: s.ids.fundraiserId,
          authorUserId: s.ids.donor2,
          donationId: donation._id,
          authorName: "Otieno O.",
          body: `Comment number ${i}.`,
          status: "PUBLISHED",
          createdAt: Date.now() + i + 1,
        });
      }
    });
    await settle(s.t);

    expect(await deliveries(s.t)).toMatchObject([
      { count: COMMENT_EMAIL_MAX_COUNT, hasMore: true },
    ]);
    expect(sentEmails()[0].body.subject).toBe(
      "100+ new comments on Water for Kajiado",
    );
  });

  it("gives every email its own unsubscribe code", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    await comment(s.donor, s.ids.secondId);
    await settle(s.t);

    const [a, b] = await deliveries(s.t);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(b.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.token).not.toBe(b.token);
  });
});

describe("at most one email a day for a fundraiser", () => {
  it("holds a later comment until a day after the last email", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);
    const [first] = await deliveries(s.t);

    // An hour after the first comment, a donor comments again.
    vi.advanceTimersByTime(50 * MIN);
    await comment(s.donor2, s.ids.fundraiserId);

    const [state] = await states(s.t);
    expect(state.pendingFor).toBe(first.createdAt + DAY);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await settle(s.t);

    const rows = await deliveries(s.t);
    expect(rows).toHaveLength(2);
    expect(rows[1].createdAt).toBeGreaterThanOrEqual(first.createdAt + DAY);
    expect(rows[1].count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends nothing for the comments of a whole day but that one email", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);

    // A comment every few hours for a day.
    for (let hour = 3; hour <= 21; hour += 3) {
      vi.advanceTimersByTime(3 * 60 * MIN);
      // Two donors, so neither runs into the limit on comments per day.
      const who = (hour / 3) % 2 === 1 ? s.donor2 : s.donor;
      await comment(who, s.ids.fundraiserId, `Comment at hour ${hour}.`);
    }
    // Everything in this loop is inside the day after the first email.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await plannedDigests(s.t)).toHaveLength(1);

    await settle(s.t);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentEmails()[1].body.subject).toBe(
      "7 new comments on Water for Kajiado",
    );
  });

  it("waits only the usual few minutes when the day has already passed", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);

    vi.advanceTimersByTime(3 * DAY);
    const before = Date.now();
    await comment(s.donor2, s.ids.fundraiserId);

    const [state] = await states(s.t);
    expectAround(state.pendingFor, before + COMMENT_EMAIL_BATCH_DELAY_MS);

    await settle(s.t);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not count a comment twice: the next email is about what is new since the last", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await comment(s.donor, s.ids.fundraiserId);
    await comment(s.donor2, s.ids.fundraiserId);
    await settle(s.t);

    vi.advanceTimersByTime(2 * DAY);
    await comment(s.donor, s.ids.fundraiserId, "Just the one this time.");
    await settle(s.t);

    expect(sentEmails().map((e) => e.body.subject)).toEqual([
      "2 new comments on Water for Kajiado",
      "1 new comment on Water for Kajiado",
    ]);
  });

  it("plans again if a planned digest never ran", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await comment(s.donor, s.ids.fundraiserId);

    // Its time came and went more than the allowed lateness ago.
    const [state] = await states(s.t);
    await s.t.run((ctx) =>
      ctx.db.patch(state._id, {
        pendingFor: Date.now() - COMMENT_EMAIL_STALE_MS - MIN,
      }),
    );
    const before = Date.now();
    await comment(s.donor2, s.ids.fundraiserId);

    expect(await plannedDigests(s.t)).toHaveLength(2);
    const [after] = await states(s.t);
    expectAround(after.pendingFor, before + COMMENT_EMAIL_BATCH_DELAY_MS);

    // Both plans run, and between them the organizer gets one email.
    await settle(s.t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEmails()[0].body.subject).toBe(
      "2 new comments on Water for Kajiado",
    );
  });

  it("trusts a digest that is only a little late", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await comment(s.donor, s.ids.fundraiserId);

    const [state] = await states(s.t);
    await s.t.run((ctx) =>
      ctx.db.patch(state._id, { pendingFor: Date.now() - 5 * MIN }),
    );
    await comment(s.donor2, s.ids.fundraiserId);

    expect(await plannedDigests(s.t)).toHaveLength(1);
    await settle(s.t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a leftover plan: only the live one does the work", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await comment(s.donor, s.ids.fundraiserId);
    const [before] = await states(s.t);

    // Run too early: the plan is for later.
    await s.t.mutation(internal.commentEmails.queueDigest, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(await deliveries(s.t)).toHaveLength(0);
    expect((await states(s.t))[0]).toEqual(before);

    // Run with nothing planned at all.
    await s.t.run((ctx) => ctx.db.patch(before._id, { pendingFor: undefined }));
    await s.t.mutation(internal.commentEmails.queueDigest, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(await deliveries(s.t)).toHaveLength(0);

    // (Nothing is planned any more, so the scheduled one finds nothing to do.)
    await settle(s.t);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for a fundraiser that has no record", async () => {
    const s = await setup();
    await s.t.mutation(internal.commentEmails.queueDigest, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(await deliveries(s.t)).toHaveLength(0);
    expect(await states(s.t)).toHaveLength(0);
  });
});

describe("when there is nothing to tell the organizer", () => {
  it("does not count a comment that was removed before the email", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    const gone = await comment(s.donor2, s.ids.fundraiserId);
    await s.donor2.mutation(api.fundraiserComments.removeComment, {
      commentId: gone,
    });
    await settle(s.t);

    expect(sentEmails()[0].body.subject).toBe(
      "1 new comment on Water for Kajiado",
    );
  });

  it("does not count a comment the organizer hid before the email", async () => {
    const s = await setup();
    await everyoneDonates(s);

    const first = await comment(s.donor, s.ids.fundraiserId);
    await comment(s.donor2, s.ids.fundraiserId);
    await s.owner.mutation(api.fundraiserComments.hideComment, {
      commentId: first,
    });
    await settle(s.t);

    expect(sentEmails()[0].body.subject).toBe(
      "1 new comment on Water for Kajiado",
    );
  });

  it("sends nothing when every comment was taken down", async () => {
    const s = await setup();
    await everyoneDonates(s);

    const id = await comment(s.donor, s.ids.fundraiserId);
    await s.donor.mutation(api.fundraiserComments.removeComment, {
      commentId: id,
    });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);
    // And it didn't use up the day: the next comment is emailed within minutes.
    const [state] = await states(s.t);
    expect(state.lastSentAt).toBeUndefined();
    expect(state.pendingFor).toBeUndefined();
  });

  it("sends nothing to an organizer who has turned the emails off", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await patchUser(s.t, s.ids.owner, { commentEmails: false });

    await comment(s.donor, s.ids.fundraiserId);
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);
  });

  it("does not save comments up for an organizer to get in a surprise when they turn the emails back on", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await patchUser(s.t, s.ids.owner, { commentEmails: false });
    await comment(s.donor, s.ids.fundraiserId);
    await comment(s.donor2, s.ids.fundraiserId);
    await settle(s.t);

    await patchUser(s.t, s.ids.owner, { commentEmails: true });
    vi.advanceTimersByTime(MIN);
    await comment(s.donor, s.ids.fundraiserId, "Now the emails are on.");
    await settle(s.t);

    expect(sentEmails().map((e) => e.body.subject)).toEqual([
      "1 new comment on Water for Kajiado",
    ]);
  });

  it("treats an organizer who never chose as wanting the emails", async () => {
    const s = await setup();
    await everyoneDonates(s);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();

    await oneDigest(s);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing about a fundraiser that is no longer public", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    await patchFundraiser(s.t, s.ids.fundraiserId, { isPrivate: true });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);
  });

  it("sends nothing about a fundraiser that has been deleted", async () => {
    const s = await setup();
    await everyoneDonates(s);

    await comment(s.donor, s.ids.fundraiserId);
    await s.t.run((ctx) => ctx.db.delete(s.ids.fundraiserId));
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);
    // And the plan is cleared, so it isn't left looking as if one is waiting.
    expect((await states(s.t))[0].pendingFor).toBeUndefined();
  });

  it("sends nothing to an organizer whose address isn't an address", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await patchUser(s.t, s.ids.owner, { email: "not an email" });

    await comment(s.donor, s.ids.fundraiserId);
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toHaveLength(0);
  });
});

describe("things that change between queueing and sending", () => {
  /** Queues the digest, and stops before it is sent. */
  async function queuedNotSent(s: S) {
    await everyoneDonates(s);
    await comment(s.donor, s.ids.fundraiserId);
    // A little over the wait, so the digest is due but its send is not yet.
    vi.advanceTimersByTime(COMMENT_EMAIL_BATCH_DELAY_MS + 1000);
    await s.t.finishInProgressScheduledFunctions();
    const [row] = await deliveries(s.t);
    expect(row).toMatchObject({ status: "PENDING" });
    expect(fetchMock).not.toHaveBeenCalled();
    return row;
  }

  it("does not send if the organizer turns the emails off in between", async () => {
    const s = await setup();
    const row = await queuedNotSent(s);

    await patchUser(s.t, s.ids.owner, { commentEmails: false });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
      status: "SKIPPED",
      skippedReason: "OPTED_OUT",
    });
  });

  it("does not send if the fundraiser is taken down in between", async () => {
    const s = await setup();
    const row = await queuedNotSent(s);

    await patchFundraiser(s.t, s.ids.fundraiserId, { status: "REJECTED" });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
      status: "SKIPPED",
      skippedReason: "NOT_VISIBLE",
    });
  });

  it("does not send if the organizer's address stops being one in between", async () => {
    const s = await setup();
    const row = await queuedNotSent(s);

    await patchUser(s.t, s.ids.owner, { email: "" });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.t.run((ctx) => ctx.db.get(row._id))).toMatchObject({
      status: "SKIPPED",
      skippedReason: "NO_EMAIL",
    });
  });

  it("uses the address the organizer has when it is sent, not when it was queued", async () => {
    const s = await setup();
    await queuedNotSent(s);

    await patchUser(s.t, s.ids.owner, { email: "new-address@example.test" });
    await settle(s.t);

    expect(sentEmails()[0].body.to).toEqual(["new-address@example.test"]);
  });
});

describe("the unsubscribe link in the email", () => {
  it("carries a one-click address that points at the comment emails route", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);

    const [row] = await deliveries(s.t);
    const [email] = sentEmails();
    expect(email.body.headers).toEqual({
      "List-Unsubscribe": `<${CONVEX_SITE}/email/unsubscribe-comments/${row.token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(email.body.text).toContain(
      `${SITE_URL}/unsubscribe/comments/${row.token}`,
    );
  });

  it("goes without the one-click headers when the site address isn't known", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "");
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);

    const [email] = sentEmails();
    expect(email.body.headers).toBeUndefined();
    expect(email.body.text).toContain("/unsubscribe/comments/");
  });
});

describe("when sending goes wrong", () => {
  it("tries again after a rate limit and still emails once", async () => {
    const s = await setup();
    await everyoneDonates(s);
    fetchMock.mockImplementationOnce(async () => reply(429, "slow down"));

    await oneDigest(s);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await deliveries(s.t)).toMatchObject([
      { status: "SENT", attempts: 2 },
    ]);
    // The same key both times: the email service ignores a repeat of a
    // request it has already carried out.
    const keys = sentEmails().map((e) => e.headers["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(1);
  });

  it("gives up at once on a refusal that trying again can't fix", async () => {
    const s = await setup();
    await everyoneDonates(s);
    fetchMock.mockImplementation(async () => reply(422, "refused"));

    await oneDigest(s);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await deliveries(s.t)).toMatchObject([
      { status: "FAILED", attempts: 1, lastStatusCode: 422 },
    ]);
  });

  it("gives up after the last attempt when the service keeps failing", async () => {
    const s = await setup();
    await everyoneDonates(s);
    fetchMock.mockImplementation(async () => reply(500, "oops"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await oneDigest(s);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_EMAIL_ATTEMPTS);
    expect(await deliveries(s.t)).toMatchObject([
      { status: "FAILED", attempts: MAX_EMAIL_ATTEMPTS },
    ]);
  });

  it("keeps the address out of the logs when it gives up", async () => {
    const s = await setup();
    await everyoneDonates(s);
    fetchMock.mockImplementation(async () => reply(422, "refused"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await oneDigest(s);

    expect(errors).toHaveBeenCalled();
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).not.toContain("example.test");
  });

  it("fails clearly, and sends nothing, when there is no email key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const s = await setup();
    await everyoneDonates(s);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await oneDigest(s);

    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await deliveries(s.t);
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/RESEND_API_KEY/);
  });

  it("sends the failed ones again once the cause is fixed", async () => {
    const s = await setup();
    await everyoneDonates(s);
    fetchMock.mockImplementation(async () => reply(422, "refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await oneDigest(s);
    const [failed] = await deliveries(s.t);
    expect(failed.status).toBe("FAILED");

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ok());
    const result = await s.t.mutation(internal.commentEmails.requeueFailed, {});
    await settle(s.t);

    expect(result).toEqual({ requeued: 1, more: false });
    expect(await deliveries(s.t)).toMatchObject([
      { status: "SENT", attempts: 1, generation: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A new key, so the service treats it as a new request.
    expect(sentEmails()[0].headers["Idempotency-Key"]).toMatch(/-1$/);
  });

  it("does not send a delivery twice if its send runs again", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);
    const [row] = await deliveries(s.t);

    await s.t.action(internal.commentEmails.send, { deliveryId: row._id });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a late report undo an email that already went out", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);
    const [row] = await deliveries(s.t);
    expect(row.status).toBe("SENT");

    // For instance a second send that raced the first and lost.
    await s.t.mutation(internal.commentEmails.recordAttempt, {
      deliveryId: row._id,
      outcome: {
        kind: "failed",
        retryable: false,
        statusCode: 500,
        error: "late",
      },
    });
    await s.t.mutation(internal.commentEmails.recordAttempt, {
      deliveryId: row._id,
      outcome: { kind: "skipped", reason: "OPTED_OUT" },
    });

    expect(await deliveries(s.t)).toMatchObject([
      { status: "SENT", attempts: 1 },
    ]);
  });

  it("leaves requeueing alone for emails that were sent", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);

    const result = await s.t.mutation(internal.commentEmails.requeueFailed, {});
    await settle(s.t);

    expect(result).toEqual({ requeued: 0, more: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("unsubscribing from the page", () => {
  async function withToken() {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);
    const [row] = await deliveries(s.t);
    return { s, token: row.token };
  }

  it("shows what the link is for", async () => {
    const { s, token } = await withToken();
    expect(await s.t.query(api.commentUnsubscribe.lookup, { token })).toEqual({
      fundraiserTitle: "Water for Kajiado",
      alreadyStopped: false,
    });
  });

  it("says nothing for a link that isn't one of ours", async () => {
    const { s } = await withToken();
    for (const token of ["", "nope", "x".repeat(101)]) {
      expect(
        await s.t.query(api.commentUnsubscribe.lookup, { token }),
      ).toBeNull();
    }
  });

  it("turns the emails off, and the page then says so", async () => {
    const { s, token } = await withToken();

    await s.t.mutation(api.commentUnsubscribe.confirm, { token });

    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBe(false);
    expect(
      await s.t.query(api.commentUnsubscribe.lookup, { token }),
    ).toMatchObject({ alreadyStopped: true });
  });

  it("is safe to do twice", async () => {
    const { s, token } = await withToken();
    await s.t.mutation(api.commentUnsubscribe.confirm, { token });
    await s.t.mutation(api.commentUnsubscribe.confirm, { token });
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBe(false);
  });

  it("refuses a link that isn't valid", async () => {
    const { s } = await withToken();
    await expect(
      s.t.mutation(api.commentUnsubscribe.confirm, { token: "nope" }),
    ).rejects.toThrow(/isn't valid/);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();
  });

  it("stops the emails for every fundraiser, not just the one in the email", async () => {
    const { s, token } = await withToken();
    await s.t.mutation(api.commentUnsubscribe.confirm, { token });

    vi.advanceTimersByTime(2 * DAY);
    await comment(s.donor, s.ids.secondId);
    await settle(s.t);

    // Only the first email went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("touches nobody but the organizer the email was sent to", async () => {
    const { s, token } = await withToken();
    await s.t.mutation(api.commentUnsubscribe.confirm, { token });

    for (const id of [s.ids.donor, s.ids.donor2, s.ids.other]) {
      expect((await userDoc(s.t, id))?.commentEmails).toBeUndefined();
    }
  });

  it("is about whoever the email went to, whichever organizer that is", async () => {
    const { s } = await withToken();
    // A second organizer gets an email of their own, about their fundraiser.
    await comment(s.donor2, s.ids.othersId);
    await settle(s.t);
    const rows = await deliveries(s.t);
    const theirs = rows.find((row) => row.recipientUserId === s.ids.other)!;

    await s.t.mutation(api.commentUnsubscribe.confirm, { token: theirs.token });

    expect((await userDoc(s.t, s.ids.other))?.commentEmails).toBe(false);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();
  });
});

describe("the unsubscribe button in a mail app", () => {
  async function withToken() {
    const s = await setup();
    await everyoneDonates(s);
    await oneDigest(s);
    const [row] = await deliveries(s.t);
    return { s, token: row.token };
  }

  it("unsubscribes when the mail app posts to the link", async () => {
    const { s, token } = await withToken();

    const response = await s.t.fetch(`/email/unsubscribe-comments/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });

    expect(response.status).toBe(200);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBe(false);
  });

  it("says no to a link that isn't valid", async () => {
    const { s } = await withToken();

    const response = await s.t.fetch("/email/unsubscribe-comments/nope", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();
  });

  it("only sends a plain visit to the page: a mail scanner opening the link unsubscribes nobody", async () => {
    const { s, token } = await withToken();

    const response = await s.t.fetch(`/email/unsubscribe-comments/${token}`, {
      method: "GET",
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${SITE_URL}/unsubscribe/comments/${token}`,
    );
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();
  });

  it("is not the route for update emails, and update email links don't work here", async () => {
    const { s, token } = await withToken();

    // A comment email's code means nothing to the update email route.
    const response = await s.t.fetch(`/email/unsubscribe/${token}`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();

    // And an update email's code means nothing to this one.
    const other = await s.t.fetch(
      "/email/unsubscribe-comments/tok_valid-0123456789abcdefghijklmnop",
      { method: "POST" },
    );
    expect(other.status).toBe(404);
  });
});

describe("the setting on the profile", () => {
  it("starts on, and follows what the person chooses", async () => {
    const s = await setup();
    const profile = () => s.owner.query(api.users.getCurrentUserProfile, {});

    expect(await profile()).toMatchObject({ commentEmails: true });

    await s.owner.mutation(api.users.setCommentEmails, { enabled: false });
    expect(await profile()).toMatchObject({ commentEmails: false });
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBe(false);

    await s.owner.mutation(api.users.setCommentEmails, { enabled: true });
    expect(await profile()).toMatchObject({ commentEmails: true });
  });

  it("changes only the signed-in person's own setting", async () => {
    const s = await setup();
    await s.owner.mutation(api.users.setCommentEmails, { enabled: false });

    for (const id of [s.ids.donor, s.ids.donor2, s.ids.other]) {
      expect((await userDoc(s.t, id))?.commentEmails).toBeUndefined();
    }
  });

  it("needs a signed-in person", async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.users.setCommentEmails, { enabled: false }),
    ).rejects.toThrow(/signed in/);
    expect((await userDoc(s.t, s.ids.owner))?.commentEmails).toBeUndefined();
  });

  it("is what decides whether the next comment is emailed", async () => {
    const s = await setup();
    await everyoneDonates(s);
    await s.owner.mutation(api.users.setCommentEmails, { enabled: false });
    await oneDigest(s);
    expect(fetchMock).not.toHaveBeenCalled();

    await s.owner.mutation(api.users.setCommentEmails, { enabled: true });
    vi.advanceTimersByTime(MIN);
    await comment(s.donor2, s.ids.fundraiserId);
    await settle(s.t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
