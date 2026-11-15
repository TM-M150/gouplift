/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { EMAIL_FROM, MAX_EMAIL_ATTEMPTS } from "./lib/email";
import {
  FANOUT_PAGE_SIZE,
  MAX_RECIPIENTS_PER_UPDATE,
  SEND_SPACING_MS,
} from "./lib/updateEmail";
import { SITE_URL } from "../lib/site";

// Nothing here signs anyone in.
vi.mock("./auth", () => ({
  authComponent: { safeGetAuthUser: async () => null },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const CONVEX_SITE = "https://example-123.convex.site";
const SECRET_TEXT = "SECRET-UPDATE-TEXT: send the rest to 0712 000 000";

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
    const fundraiser = (extra: Partial<Doc<"fundraisers">> = {}) =>
      ctx.db.insert("fundraisers", {
        creatorId: owner,
        beneficiaryType: "SELF",
        title: "Water for Kajiado",
        story: "A story that is long enough to be a story.",
        type: "COMMUNITY_HARAMBEE",
        goalAmount: 100000,
        currency: "KES",
        amountRaised: 45000,
        donorCount: 3,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const update = (fundraiserId: Id<"fundraisers">) =>
      ctx.db.insert("fundraiserUpdates", {
        fundraiserId,
        authorUserId: owner,
        body: SECRET_TEXT,
        status: "PUBLISHED",
        createdAt: now,
      });

    const fundraiserId = await fundraiser();
    const otherFundraiserId = await fundraiser({ title: "School fees" });
    return {
      owner,
      fundraiserId,
      otherFundraiserId,
      updateId: await update(fundraiserId),
      otherUpdateId: await update(otherFundraiserId),
    };
  });
  return { t, ids };
}
type S = Awaited<ReturnType<typeof setup>>;

type DonationOverrides = Partial<
  Omit<Doc<"donations">, "_id" | "_creationTime">
>;

/** A paid donation with an email address, as the payment paths leave it. */
function donation(
  s: S,
  donorEmail: string | undefined,
  overrides: DonationOverrides = {},
) {
  return s.t.run((ctx) => {
    const now = Date.now();
    const doc = {
      fundraiserId: s.ids.fundraiserId,
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES" as const,
      platformFeeRate: 0.0425,
      platformFeeAmount: 42.5,
      netAmount: 957.5,
      status: "COMPLETED" as const,
      payoutStatus: "PENDING_PAYOUT" as const,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    return ctx.db.insert(
      "donations",
      donorEmail === undefined ? doc : { ...doc, donorEmail },
    );
  });
}

const fanOut = (s: S, updateId = s.ids.updateId) =>
  s.t.action(internal.updateEmails.fanOut, { updateId, cursor: null });

const deliveries = (t: T) =>
  t.run((ctx) => ctx.db.query("updateEmailDeliveries").collect());

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

const recipients = () =>
  sentEmails()
    .flatMap((email) => email.body.to)
    .sort();

describe("emailing donors about an update", () => {
  it("emails each donor once, however often they gave and however they typed it", async () => {
    const s = await setup();
    await donation(s, "wanjiru@example.test");
    await donation(s, "wanjiru@example.test");
    await donation(s, "  Wanjiru@Example.TEST ");
    await donation(s, "otieno@example.test");

    await fanOut(s);
    await settle(s.t);

    expect(recipients()).toEqual([
      "otieno@example.test",
      "wanjiru@example.test",
    ]);
    const rows = await deliveries(s.t);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "SENT")).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);

    const update = await s.t.run((ctx) => ctx.db.get(s.ids.updateId));
    expect(update?.emailQueuedCount).toBe(2);
  });

  it("only emails people whose donation was paid and who left a usable address", async () => {
    const s = await setup();
    await donation(s, "paid@example.test");
    await donation(s, "pending@example.test", { status: "PENDING" });
    await donation(s, "failed@example.test", { status: "FAILED" });
    await donation(s, "cancelled@example.test", { status: "CANCELLED" });
    await donation(s, "refunded@example.test", { status: "REFUNDED" });
    await donation(s, undefined);
    await donation(s, "not-an-email");
    await donation(s, "", {});
    // Somebody else's fundraiser.
    await donation(s, "elsewhere@example.test", {
      fundraiserId: s.ids.otherFundraiserId,
    });

    await fanOut(s);
    await settle(s.t);

    expect(recipients()).toEqual(["paid@example.test"]);
  });

  it("sends from GoUplift, and points at the page, not at the text", async () => {
    const s = await setup();
    await donation(s, "wanjiru@example.test");

    await fanOut(s);
    await settle(s.t);

    const [email] = sentEmails();
    expect(email.url).toBe("https://api.resend.com/emails");
    expect(email.body.from).toBe(EMAIL_FROM);
    expect(email.body.subject).toBe("New update on Water for Kajiado");
    expect(email.body.html).toContain(
      `${SITE_URL}/fundraiser/${s.ids.fundraiserId}#updates`,
    );

    // What the creator typed never rides in an email from us.
    for (const part of [email.body.subject, email.body.html, email.body.text]) {
      expect(part).not.toContain("SECRET-UPDATE-TEXT");
      expect(part).not.toContain("0712");
    }
  });

  it("gives each donor their own unsubscribe link, which never contains the address", async () => {
    const s = await setup();
    await donation(s, "wanjiru@example.test");
    await donation(s, "otieno@example.test");

    await fanOut(s);
    await settle(s.t);

    const rows = await deliveries(s.t);
    expect(new Set(rows.map((row) => row.token)).size).toBe(2);
    for (const row of rows) {
      expect(row.token).toMatch(/^[A-Za-z0-9_-]{30,}$/);
      expect(row.token).not.toContain("example");

      const email = sentEmails().find((e) => e.body.to[0] === row.email);
      expect(email?.body.html).toContain(
        `${SITE_URL}/unsubscribe/${row.token}`,
      );
      expect(email?.body.text).toContain(
        `${SITE_URL}/unsubscribe/${row.token}`,
      );
      // The mail app's own button, which unsubscribes without a page.
      expect(email?.body.headers).toEqual({
        "List-Unsubscribe": `<${CONVEX_SITE}/email/unsubscribe/${row.token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
    }
  });

  it("leaves out the one-click headers when it doesn't know its own address", async () => {
    const s = await setup();
    vi.stubEnv("CONVEX_SITE_URL", "");
    await donation(s, "wanjiru@example.test");

    await fanOut(s);
    await settle(s.t);

    const [email] = sentEmails();
    expect(email.body.headers).toBeUndefined();
    expect(email.body.html).toContain("/unsubscribe/");
  });

  it("goes through a big fundraiser page by page, and a donor on two pages is emailed once", async () => {
    const s = await setup();
    const unique = FANOUT_PAGE_SIZE * 2 + 20;
    for (let i = 0; i < unique; i++) {
      await donation(s, `donor${i}@example.test`);
    }
    // Gave again later, so on a later page than their first donation.
    for (let i = 0; i < 25; i++) {
      await donation(s, `DONOR${i}@example.test`);
    }

    await fanOut(s);
    await settle(s.t);

    expect(sentEmails()).toHaveLength(unique);
    expect(new Set(recipients()).size).toBe(unique);
    expect((await deliveries(s.t)).every((row) => row.status === "SENT")).toBe(
      true,
    );
    const update = await s.t.run((ctx) => ctx.db.get(s.ids.updateId));
    expect(update?.emailQueuedCount).toBe(unique);
  });

  it("spaces the sends out, so a big list doesn't go as one burst", async () => {
    const s = await setup();
    const emails = ["a@example.test", "b@example.test", "c@example.test"];

    const result = await s.t.mutation(internal.updateEmails.queueDeliveries, {
      updateId: s.ids.updateId,
      emails,
    });
    expect(result).toEqual({ queued: 3, stop: false });

    const jobs = await s.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const times = jobs
      .filter((job) => job.name.includes("send"))
      .map((job) => job.scheduledTime)
      .sort((a, b) => a - b);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBe(SEND_SPACING_MS);
    expect(times[2] - times[1]).toBe(SEND_SPACING_MS);
  });

  it("does nothing when asked again for the same addresses", async () => {
    const s = await setup();
    const args = {
      updateId: s.ids.updateId,
      emails: ["a@example.test", "b@example.test"],
    };

    await s.t.mutation(internal.updateEmails.queueDeliveries, args);
    const again = await s.t.mutation(
      internal.updateEmails.queueDeliveries,
      args,
    );
    await settle(s.t);

    expect(again.queued).toBe(0);
    expect(await deliveries(s.t)).toHaveLength(2);
    expect(sentEmails()).toHaveLength(2);
  });

  it("emails a donor once per fundraiser, each time with its own link", async () => {
    const s = await setup();
    await donation(s, "wanjiru@example.test");
    await donation(s, "wanjiru@example.test", {
      fundraiserId: s.ids.otherFundraiserId,
    });

    await fanOut(s);
    await fanOut(s, s.ids.otherUpdateId);
    await settle(s.t);

    // One email about each fundraiser, and each with its own link.
    expect(sentEmails()).toHaveLength(2);
    const rows = await deliveries(s.t);
    expect(new Set(rows.map((row) => row.token)).size).toBe(2);
  });

  it("stops at the limit for one update and says so in the log", async () => {
    const s = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.updateId, {
        emailQueuedCount: MAX_RECIPIENTS_PER_UPDATE - 1,
      }),
    );

    const result = await s.t.mutation(internal.updateEmails.queueDeliveries, {
      updateId: s.ids.updateId,
      emails: ["a@example.test", "b@example.test", "c@example.test"],
    });

    expect(result).toEqual({ queued: 1, stop: true });
    expect(await deliveries(s.t)).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain("@");
  });
});

describe("who is not emailed", () => {
  it("skips someone who unsubscribed from this fundraiser, and someone who unsubscribed from all", async () => {
    const s = await setup();
    await donation(s, "stays@example.test");
    await donation(s, "left-this-one@example.test");
    await donation(s, "left-all@example.test");
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("updateEmailOptOuts", {
        email: "left-this-one@example.test",
        fundraiserId: s.ids.fundraiserId,
        createdAt: now,
      });
      await ctx.db.insert("updateEmailOptOuts", {
        email: "left-all@example.test",
        createdAt: now,
      });
    });

    await fanOut(s);
    await settle(s.t);

    expect(recipients()).toEqual(["stays@example.test"]);
    // No email, so no row and no link to keep alive.
    expect(await deliveries(s.t)).toHaveLength(1);
  });

  it("only honours an opt-out for the fundraiser it was made for", async () => {
    const s = await setup();
    await donation(s, "wanjiru@example.test", {
      fundraiserId: s.ids.otherFundraiserId,
    });
    await s.t.run((ctx) =>
      ctx.db.insert("updateEmailOptOuts", {
        email: "wanjiru@example.test",
        fundraiserId: s.ids.fundraiserId,
        createdAt: Date.now(),
      }),
    );

    await fanOut(s, s.ids.otherUpdateId);
    await settle(s.t);

    expect(recipients()).toEqual(["wanjiru@example.test"]);
  });

  it("still honours an opt-out made after the email was queued", async () => {
    const s = await setup();
    await s.t.mutation(internal.updateEmails.queueDeliveries, {
      updateId: s.ids.updateId,
      emails: ["wanjiru@example.test"],
    });
    await s.t.run((ctx) =>
      ctx.db.insert("updateEmailOptOuts", {
        email: "wanjiru@example.test",
        createdAt: Date.now(),
      }),
    );

    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await deliveries(s.t)).toMatchObject([
      { status: "SKIPPED", skippedReason: "OPTED_OUT" },
    ]);
  });

  it("doesn't send for an update that was hidden or removed after it was queued", async () => {
    for (const status of ["HIDDEN", "REMOVED"] as const) {
      const s = await setup();
      await s.t.mutation(internal.updateEmails.queueDeliveries, {
        updateId: s.ids.updateId,
        emails: ["wanjiru@example.test"],
      });
      await s.t.run((ctx) => ctx.db.patch(s.ids.updateId, { status }));

      await settle(s.t);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await deliveries(s.t)).toMatchObject([
        { status: "SKIPPED", skippedReason: "UPDATE_NOT_PUBLISHED" },
      ]);
    }
  });

  it("doesn't send once the fundraiser has gone private or been flagged", async () => {
    for (const change of [{ isPrivate: true }, { isFlagged: true }]) {
      const s = await setup();
      await s.t.mutation(internal.updateEmails.queueDeliveries, {
        updateId: s.ids.updateId,
        emails: ["wanjiru@example.test"],
      });
      await s.t.run((ctx) => ctx.db.patch(s.ids.fundraiserId, change));

      await settle(s.t);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await deliveries(s.t)).toMatchObject([
        { status: "SKIPPED", skippedReason: "NOT_VISIBLE" },
      ]);
    }
  });

  it("starts nothing for an update that isn't published or a fundraiser that can't email", async () => {
    for (const [label, change] of [
      ["hidden update", () => ({ update: { status: "HIDDEN" as const } })],
      ["private", () => ({ fundraiser: { isPrivate: true } })],
      ["flagged", () => ({ fundraiser: { isFlagged: true } })],
      [
        "in review",
        () => ({ fundraiser: { status: "PENDING_REVIEW" as const } }),
      ],
    ] as const) {
      const s = await setup();
      await donation(s, "wanjiru@example.test");
      const { update, fundraiser } = change() as {
        update?: Partial<Doc<"fundraiserUpdates">>;
        fundraiser?: Partial<Doc<"fundraisers">>;
      };
      await s.t.run(async (ctx) => {
        if (update) await ctx.db.patch(s.ids.updateId, update);
        if (fundraiser) await ctx.db.patch(s.ids.fundraiserId, fundraiser);
      });

      await fanOut(s);
      await settle(s.t);

      expect(fetchMock, label).not.toHaveBeenCalled();
      expect(await deliveries(s.t), label).toHaveLength(0);
    }
  });

  it("does not send a second time for a delivery that is already done", async () => {
    const s = await setup();
    await donation(s, "wanjiru@example.test");
    await fanOut(s);
    await settle(s.t);
    const [row] = await deliveries(s.t);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await s.t.action(internal.updateEmails.send, { deliveryId: row._id });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("when sending goes wrong", () => {
  it("tries again after a rate limit and still emails the donor once", async () => {
    const s = await setup();
    fetchMock.mockImplementationOnce(async () => reply(429, "slow down"));
    await donation(s, "wanjiru@example.test");

    await fanOut(s);
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [row] = await deliveries(s.t);
    expect(row).toMatchObject({ status: "SENT", attempts: 2 });
    // The same key both times: Resend ignores a repeat of a request it has
    // already carried out.
    const keys = sentEmails().map((e) => e.headers["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(`update-email-${row._id}-0`);
  });

  it("gives up straight away on an address the service refuses", async () => {
    const s = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async () =>
      reply(422, "The to address wanjiru@example.test is invalid"),
    );
    await donation(s, "wanjiru@example.test");

    await fanOut(s);
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [row] = await deliveries(s.t);
    expect(row).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastStatusCode: 422,
    });
    // The log says what happened, never to whom.
    for (const call of error.mock.calls) {
      expect(call.join(" ")).not.toContain("wanjiru@example.test");
    }
    expect(row.lastError).not.toContain("wanjiru@example.test");
  });

  it("gives up after the last retry", async () => {
    const s = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async () => reply(500, "oops"));
    await donation(s, "wanjiru@example.test");

    await fanOut(s);
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_EMAIL_ATTEMPTS);
    expect((await deliveries(s.t))[0]).toMatchObject({
      status: "FAILED",
      attempts: MAX_EMAIL_ATTEMPTS,
      lastStatusCode: 500,
    });
  });

  it("fails cleanly, and says why, when no email key is set up", async () => {
    const s = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "");
    await donation(s, "wanjiru@example.test");

    await fanOut(s);
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await deliveries(s.t);
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/RESEND_API_KEY/);
  });

  it("can try the failed ones again once the cause is fixed, under a new key", async () => {
    const s = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async () => reply(422, "refused"));
    await donation(s, "wanjiru@example.test");
    await fanOut(s);
    await settle(s.t);
    const [failed] = await deliveries(s.t);
    expect(failed.status).toBe("FAILED");

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ok());
    const result = await s.t.mutation(internal.updateEmails.requeueFailed, {});
    await settle(s.t);

    expect(result).toEqual({ requeued: 1, more: false });
    const [row] = await deliveries(s.t);
    expect(row).toMatchObject({ status: "SENT", generation: 1, attempts: 1 });
    expect(sentEmails()[0].headers["Idempotency-Key"]).toBe(
      `update-email-${row._id}-1`,
    );
  });

  it("works through a long list of failed ones in batches", async () => {
    const s = await setup();
    const total = 120;
    await s.t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert("updateEmailDeliveries", {
          updateId: s.ids.updateId,
          fundraiserId: s.ids.fundraiserId,
          email: `donor${i}@example.test`,
          token: `token-${i}`,
          status: "FAILED",
          attempts: 1,
          generation: 0,
          createdAt: Date.now(),
        });
      }
    });

    const first = await s.t.mutation(internal.updateEmails.requeueFailed, {});
    expect(first).toEqual({ requeued: 50, more: true });
    await settle(s.t);

    expect(sentEmails()).toHaveLength(total);
    expect((await deliveries(s.t)).every((row) => row.status === "SENT")).toBe(
      true,
    );
  });
});
