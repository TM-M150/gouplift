/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { SITE_URL } from "../lib/site";

// Nothing here signs anyone in. The HTTP router registers the sign-in routes
// when it loads, so the mock has to offer that too.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async () => null,
    registerRoutes: () => {},
  },
  createAuth: () => ({}),
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const EMAIL = "wanjiru@example.test";
const TOKEN = "tok_valid-0123456789abcdefghijklmnop";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T09:00:00Z"));
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", {
      authUserId: "auth_owner",
      email: "owner@example.test",
      displayName: "Fund Raiser",
      role: "USER",
      isPrivate: false,
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    const fundraiser = (title: string) =>
      ctx.db.insert("fundraisers", {
        creatorId: owner,
        beneficiaryType: "SELF",
        title,
        story: "A story that is long enough to be a story.",
        type: "COMMUNITY_HARAMBEE",
        goalAmount: 100000,
        currency: "KES",
        amountRaised: 0,
        donorCount: 1,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });
    const update = (fundraiserId: Id<"fundraisers">) =>
      ctx.db.insert("fundraiserUpdates", {
        fundraiserId,
        authorUserId: owner,
        body: "We have reached the first borehole.",
        status: "PUBLISHED",
        createdAt: now,
      });

    const fundraiserId = await fundraiser("Water for Kajiado");
    const otherFundraiserId = await fundraiser("School fees");
    const updateId = await update(fundraiserId);
    const secondUpdateId = await update(fundraiserId);
    const otherUpdateId = await update(otherFundraiserId);

    // An email that was sent about the first update: the link in it.
    await ctx.db.insert("updateEmailDeliveries", {
      updateId,
      fundraiserId,
      email: EMAIL,
      token: TOKEN,
      status: "SENT",
      attempts: 1,
      generation: 0,
      createdAt: now,
    });
    return {
      fundraiserId,
      otherFundraiserId,
      updateId,
      secondUpdateId,
      otherUpdateId,
    };
  });
  return { t, ids };
}
type S = Awaited<ReturnType<typeof setup>>;

const optOuts = (t: T) =>
  t.run((ctx) => ctx.db.query("updateEmailOptOuts").collect());

function donate(s: S, fundraiserId: Id<"fundraisers">) {
  return s.t.run((ctx) => {
    const now = Date.now();
    const doc: Omit<Doc<"donations">, "_id" | "_creationTime"> = {
      fundraiserId,
      donorEmail: EMAIL,
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
    };
    return ctx.db.insert("donations", doc);
  });
}

describe("what the unsubscribe page shows", () => {
  it("says which fundraiser the link is about and that nothing is stopped yet", async () => {
    const { t } = await setup();
    expect(await t.query(api.unsubscribe.lookup, { token: TOKEN })).toEqual({
      fundraiserTitle: "Water for Kajiado",
      stoppedForFundraiser: false,
      stoppedForAll: false,
    });
  });

  it("gives nothing for a link that isn't one of ours", async () => {
    const { t } = await setup();
    for (const token of ["", "nope", `${TOKEN}x`, "x".repeat(500)]) {
      expect(await t.query(api.unsubscribe.lookup, { token })).toBeNull();
    }
  });

  it("still works for a fundraiser that has since been deleted", async () => {
    const { t, ids } = await setup();
    await t.run((ctx) => ctx.db.delete(ids.fundraiserId));
    expect(
      await t.query(api.unsubscribe.lookup, { token: TOKEN }),
    ).toMatchObject({ fundraiserTitle: "this fundraiser" });
  });
});

describe("unsubscribing from the page", () => {
  it("stops emails about this fundraiser, with nobody signed in", async () => {
    const { t, ids } = await setup();

    await t.mutation(api.unsubscribe.confirm, {
      token: TOKEN,
      scope: "FUNDRAISER",
    });

    expect(await optOuts(t)).toMatchObject([
      { email: EMAIL, fundraiserId: ids.fundraiserId },
    ]);
    expect(
      await t.query(api.unsubscribe.lookup, { token: TOKEN }),
    ).toMatchObject({ stoppedForFundraiser: true, stoppedForAll: false });
  });

  it("stops emails about every fundraiser when asked", async () => {
    const { t } = await setup();

    await t.mutation(api.unsubscribe.confirm, { token: TOKEN, scope: "ALL" });

    const rows = await optOuts(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(EMAIL);
    expect(rows[0].fundraiserId).toBeUndefined();
    expect(
      await t.query(api.unsubscribe.lookup, { token: TOKEN }),
    ).toMatchObject({ stoppedForAll: true });
  });

  it("can be done again and again without piling up rows", async () => {
    const { t } = await setup();
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.unsubscribe.confirm, {
        token: TOKEN,
        scope: "FUNDRAISER",
      });
      await t.mutation(api.unsubscribe.confirm, { token: TOKEN, scope: "ALL" });
    }
    expect(await optOuts(t)).toHaveLength(2);
  });

  it("refuses a link that isn't valid, and changes nothing", async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.unsubscribe.confirm, { token: "nope", scope: "ALL" }),
    ).rejects.toThrow(/isn't valid/);
    expect(await optOuts(t)).toHaveLength(0);
  });

  it("then really does stop the next update's email, for this fundraiser only", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId);
    await donate(s, s.ids.otherFundraiserId);

    await s.t.mutation(api.unsubscribe.confirm, {
      token: TOKEN,
      scope: "FUNDRAISER",
    });
    await s.t.action(internal.updateEmails.fanOut, {
      updateId: s.ids.secondUpdateId,
      cursor: null,
    });
    await s.t.action(internal.updateEmails.fanOut, {
      updateId: s.ids.otherUpdateId,
      cursor: null,
    });
    await settle(s.t);

    // Nothing about the fundraiser they left; still the one they didn't.
    const subjects = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init.body as string).subject as string,
    );
    expect(subjects).toEqual(["New update on School fees"]);
  });

  it("and stopping all stops them everywhere", async () => {
    const s = await setup();
    await donate(s, s.ids.fundraiserId);
    await donate(s, s.ids.otherFundraiserId);

    await s.t.mutation(api.unsubscribe.confirm, { token: TOKEN, scope: "ALL" });
    await s.t.action(internal.updateEmails.fanOut, {
      updateId: s.ids.secondUpdateId,
      cursor: null,
    });
    await s.t.action(internal.updateEmails.fanOut, {
      updateId: s.ids.otherUpdateId,
      cursor: null,
    });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the unsubscribe button in a mail app", () => {
  it("unsubscribes from this fundraiser when the mail app posts to the link", async () => {
    const { t, ids } = await setup();

    const response = await t.fetch(`/email/unsubscribe/${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });

    expect(response.status).toBe(200);
    expect(await optOuts(t)).toMatchObject([
      { email: EMAIL, fundraiserId: ids.fundraiserId },
    ]);
  });

  it("says no to a link that isn't valid", async () => {
    const { t } = await setup();

    const response = await t.fetch("/email/unsubscribe/nope", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(await optOuts(t)).toHaveLength(0);
  });

  it("only sends a plain visit to the page: a mail scanner opening the link unsubscribes nobody", async () => {
    const { t } = await setup();

    const response = await t.fetch(`/email/unsubscribe/${TOKEN}`, {
      method: "GET",
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${SITE_URL}/unsubscribe/${TOKEN}`,
    );
    expect(await optOuts(t)).toHaveLength(0);
  });
});
