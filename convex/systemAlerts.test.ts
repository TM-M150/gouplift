/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  SYSTEM_ALERT_DETAIL_MAX_LENGTH,
  SYSTEM_ALERT_EMAIL_COOLDOWN_MS,
  SYSTEM_ALERT_EMAILS_PER_KIND,
  SYSTEM_ALERT_KEEP_RESOLVED_MS,
  SYSTEM_ALERT_KINDS,
  SYSTEM_ALERT_THROTTLE_MS,
  SYSTEM_ALERTS,
  type SystemAlertKind,
} from "../lib/system-alerts";
import { SITE_URL } from "../lib/site";
import {
  cleanAlertDetail,
  describeError,
  reportProblem,
} from "./lib/systemAlerts";

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
    registerRoutes: () => {},
  },
  createAuth: () => ({}),
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const NOW = Date.parse("2026-11-23T09:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const OPS = "ops@example.test";
const RESEND_URL = "https://api.resend.com/emails";
const SASAPAY_SECRET = "callback-secret";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

// What the outside world answers, changed per test.
let verifyAnswer: () => Response;
let tokenAnswer: () => Response;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("ALERT_EMAIL_TO", OPS);
  vi.stubEnv("SASAPAY_CALLBACK_SECRET", SASAPAY_SECRET);
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-TEST");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");

  verifyAnswer = () => json({ verification_status: "SUCCESS" });
  tokenAnswer = () => json({ access_token: "paypal-token" });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === RESEND_URL) return json({ id: "em_1" });
    if (url.endsWith("/v1/oauth2/token")) return tokenAnswer();
    if (url.endsWith("/verify-webhook-signature")) return verifyAnswer();
    if (url.includes("frankfurter")) return json({ rate: 129 });
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** Emails sent to the alert address (not the receipts donors get). */
function alertEmails() {
  return fetchMock.mock.calls
    .filter(([url]) => url === RESEND_URL)
    .map(
      ([, init]) =>
        JSON.parse(init.body as string) as {
          to: string[];
          subject: string;
          text: string;
          html: string;
        },
    )
    .filter((body) => body.to.includes(OPS));
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const user = (
      authUserId: string,
      displayName: string,
      role: Doc<"users">["role"],
    ) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: NOW - 30 * DAY,
        updatedAt: NOW - 30 * DAY,
      });
    const owner = await user("auth_owner", "Fund Raiser", "USER");
    return {
      owner,
      alice: await user("auth_alice", "Alice Wanjiru", "USER"),
      mod: await user("auth_mod", "Mo Derator", "MODERATOR"),
      admin: await user("auth_admin", "Ad Min", "ADMIN"),
      fundraiser: await ctx.db.insert("fundraisers", {
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
        createdAt: NOW - 10 * DAY,
        updatedAt: NOW - 10 * DAY,
      }),
    };
  });
  return {
    t,
    ids,
    alice: t.withIdentity({ subject: "auth_alice" }),
    mod: t.withIdentity({ subject: "auth_mod" }),
    admin: t.withIdentity({ subject: "auth_admin" }),
  };
}

const record = (
  t: T,
  kind: SystemAlertKind,
  extra: { reference?: string; detail?: string } = {},
) => t.mutation(internal.systemAlerts.record, { kind, ...extra });

const allAlerts = (t: T) =>
  t.run((ctx) => ctx.db.query("systemAlerts").collect());

// ---- What goes in the details ----------------------------------------

describe("cleanAlertDetail", () => {
  it("takes out email addresses", () => {
    expect(
      cleanAlertDetail("No donor with email wanjiru.k+give@example.co.ke."),
    ).toBe("No donor with email [email].");
  });

  it("takes out phone numbers however they are written", () => {
    for (const number of [
      "0712345678",
      "0712 345 678",
      "0712-345-678",
      "254712345678",
      "+254 712 345 678",
      "+1 415 555 0132",
    ]) {
      expect(cleanAlertDetail(`Paid by ${number} today`)).toBe(
        "Paid by [number] today",
      );
    }
  });

  it("leaves the ids that find a payment in the provider's dashboard", () => {
    const detail =
      "CheckoutRequestID ws_CO_0712345678, event WH-1AB23456CD789012E, sale 9XY12345AB678901C.";
    expect(cleanAlertDetail(detail)).toBe(detail);
  });

  it("puts it on one line and cuts it short", () => {
    expect(cleanAlertDetail("  one\n\ttwo   three  ")).toBe("one two three");
    const long = cleanAlertDetail("x".repeat(2000));
    expect(long).toHaveLength(SYSTEM_ALERT_DETAIL_MAX_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("describeError", () => {
  it("drops the request id Convex adds, which differs every time", () => {
    expect(
      describeError(
        new Error("[Request ID: 1a2b3c4d] Server Error: Donation not found"),
      ),
    ).toBe("Server Error: Donation not found");
  });

  it("copes with something that isn't an Error", () => {
    expect(describeError("plain text")).toBe("plain text");
    expect(describeError(new Error(""))).toBe("Unknown error");
  });
});

describe("reporting from an HTTP action", () => {
  it("passes the problem on to be recorded", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    await reportProblem(
      { runMutation },
      { kind: "SASAPAY_PAYMENT_UNMATCHED", reference: "ws_CO_1", detail: "x" },
    );
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toEqual({
      kind: "SASAPAY_PAYMENT_UNMATCHED",
      reference: "ws_CO_1",
      detail: "x",
    });
  });

  // The webhook is about to answer SasaPay or PayPal. A database hiccup while
  // writing the alert must not turn that answer into a different one.
  it("never throws, even when the alert itself can't be recorded", async () => {
    const runMutation = vi
      .fn()
      .mockRejectedValue(new Error("Database is down"));
    await expect(
      reportProblem({ runMutation }, { kind: "SASAPAY_CALLBACK_FAILED" }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("SASAPAY_CALLBACK_FAILED"),
      "Database is down",
    );
  });
});

describe("the catalogue", () => {
  it("says what each kind is and what to do about it", () => {
    for (const kind of SYSTEM_ALERT_KINDS) {
      const { severity, title, help } = SYSTEM_ALERTS[kind];
      expect(["ERROR", "WARNING"]).toContain(severity);
      expect(title.length).toBeGreaterThan(10);
      expect(help.length).toBeGreaterThan(40);
    }
  });
});

// ---- Recording ------------------------------------------------------

describe("recording a problem", () => {
  it("makes an open alert", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", {
      reference: "ws_CO_1",
      detail: "CheckoutRequestID ws_CO_1.",
    });

    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "SASAPAY_PAYMENT_UNMATCHED",
      reference: "ws_CO_1",
      detail: "CheckoutRequestID ws_CO_1.",
      status: "OPEN",
      count: 1,
    });
    expect(alert.firstSeenAt).toBe(alert.lastSeenAt);
  });

  it("scrubs the details before keeping them", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_WEBHOOK_FAILED", {
      detail: "Could not email donor@example.test or call 0712 345 678",
    });
    const [alert] = await allAlerts(s.t);
    expect(alert.detail).toBe("Could not email [email] or call [number]");
  });

  it("counts the same problem again instead of adding a row", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await record(s.t, "PAYPAL_NOT_CONFIGURED");

    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(3);
    expect(alerts[0].lastSeenAt).toBeGreaterThan(alerts[0].firstSeenAt);
  });

  it("keeps the latest details when it happens again", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_WEBHOOK_FAILED", { detail: "HTTP 503." });
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await record(s.t, "PAYPAL_WEBHOOK_FAILED", { detail: "HTTP 502." });
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await record(s.t, "PAYPAL_WEBHOOK_FAILED");

    const [alert] = await allAlerts(s.t);
    expect(alert.detail).toBe("HTTP 502.");
  });

  it("counts a burst once, so a flood of bad requests is not a flood of writes", async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) {
      await record(s.t, "SASAPAY_CALLBACK_REJECTED");
    }
    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(1);
  });

  it("keeps a separate alert for each payment of one kind", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", { reference: "ws_CO_1" });
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", { reference: "ws_CO_2" });
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", { reference: "ws_CO_1" });

    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(2);
    expect(alerts.find((alert) => alert.reference === "ws_CO_1")?.count).toBe(
      2,
    );
    expect(alerts.find((alert) => alert.reference === "ws_CO_2")?.count).toBe(
      1,
    );
  });

  it("keeps different kinds apart", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_NOT_CONFIGURED");
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    expect(await allAlerts(s.t)).toHaveLength(2);
  });

  it("starts a new alert once the old one has been resolved", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_NOT_CONFIGURED");
    const [first] = await allAlerts(s.t);
    await s.mod.mutation(api.systemAlerts.resolve, { alertId: first._id });

    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await record(s.t, "SASAPAY_NOT_CONFIGURED");

    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(2);
    expect(alerts.filter((alert) => alert.status === "OPEN")).toHaveLength(1);
    expect(alerts.find((alert) => alert.status === "OPEN")?.count).toBe(1);
  });

  it("does not grow without limit when everything is failing", async () => {
    const s = await setup();
    for (let i = 0; i < 55; i++) {
      await record(s.t, "SASAPAY_CALLBACK_FAILED", { reference: `ws_CO_${i}` });
      later(SYSTEM_ALERT_THROTTLE_MS * 2);
    }
    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(50);
    // The ones past the limit were counted on the newest alert.
    expect(alerts.reduce((total, alert) => total + alert.count, 0)).toBe(55);
  });

  it("cuts a long reference down", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", {
      reference: "r".repeat(500),
    });
    const [alert] = await allAlerts(s.t);
    expect(alert.reference).toHaveLength(100);
  });
});

// ---- Email ----------------------------------------------------------

describe("emailing staff", () => {
  it("emails an error with what to do about it", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", {
      reference: "ws_CO_9",
      detail: "CheckoutRequestID ws_CO_9.",
    });
    await settle(s.t);

    const [email] = alertEmails();
    expect(alertEmails()).toHaveLength(1);
    expect(email.subject).toBe(
      `[GoUplift] ${SYSTEM_ALERTS.SASAPAY_PAYMENT_UNMATCHED.title}`,
    );
    expect(email.text).toContain("CheckoutRequestID ws_CO_9.");
    expect(email.text).toContain("Reference: ws_CO_9");
    expect(email.text).toContain(`${SITE_URL}/admin/alerts`);
    expect(email.text).toContain("SasaPay dashboard");
    expect(email.html).toContain(`${SITE_URL}/admin/alerts`);
  });

  it("writes setup commands without the markdown backticks", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_NOT_CONFIGURED");
    await settle(s.t);
    const [email] = alertEmails();
    expect(email.text).toContain(
      "npx convex env set SASAPAY_CALLBACK_SECRET <value>",
    );
    expect(email.text).not.toContain("`");
  });

  it("escapes what it quotes in the html", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_WEBHOOK_FAILED", {
      detail: "<script>alert(1)</script>",
    });
    await settle(s.t);
    const [email] = alertEmails();
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("doesn't email a warning", async () => {
    const s = await setup();
    for (const kind of SYSTEM_ALERT_KINDS) {
      if (SYSTEM_ALERTS[kind].severity === "WARNING") {
        await record(s.t, kind);
      }
    }
    await settle(s.t);
    expect((await allAlerts(s.t)).length).toBeGreaterThan(0);
    expect(alertEmails()).toHaveLength(0);
  });

  it("emails every error kind", async () => {
    const s = await setup();
    const errors = SYSTEM_ALERT_KINDS.filter(
      (kind) => SYSTEM_ALERTS[kind].severity === "ERROR",
    );
    for (const kind of errors) await record(s.t, kind);
    await settle(s.t);
    expect(alertEmails().map((email) => email.subject)).toEqual(
      expect.arrayContaining(
        errors.map((kind) => `[GoUplift] ${SYSTEM_ALERTS[kind].title}`),
      ),
    );
  });

  it("doesn't email the same problem again within the hour", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    later(10 * MINUTE);
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    later(10 * MINUTE);
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    await settle(s.t);

    expect(alertEmails()).toHaveLength(1);
    expect((await allAlerts(s.t))[0].count).toBe(3);
  });

  it("emails again once the hour is up and it is still happening", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    await settle(s.t);
    later(SYSTEM_ALERT_EMAIL_COOLDOWN_MS + MINUTE);
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    await settle(s.t);

    expect(alertEmails()).toHaveLength(2);
    expect(alertEmails()[1].text).toContain("Seen 2 times");
  });

  it("emails about each payment's problem, not only the first of its kind", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", { reference: "ws_CO_1" });
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", { reference: "ws_CO_2" });
    await settle(s.t);
    expect(alertEmails()).toHaveLength(2);
  });

  it("stops at a few emails for one kind when everything is failing", async () => {
    const s = await setup();
    for (let i = 0; i < SYSTEM_ALERT_EMAILS_PER_KIND + 4; i++) {
      await record(s.t, "SASAPAY_CALLBACK_FAILED", { reference: `ws_CO_${i}` });
    }
    await settle(s.t);

    expect(alertEmails()).toHaveLength(SYSTEM_ALERT_EMAILS_PER_KIND);
    // All of them are still on the admin page.
    expect(await allAlerts(s.t)).toHaveLength(SYSTEM_ALERT_EMAILS_PER_KIND + 4);

    // And the limit is per hour, not for ever.
    later(SYSTEM_ALERT_EMAIL_COOLDOWN_MS + MINUTE);
    await record(s.t, "SASAPAY_CALLBACK_FAILED", { reference: "ws_CO_new" });
    await settle(s.t);
    expect(alertEmails()).toHaveLength(SYSTEM_ALERT_EMAILS_PER_KIND + 1);
  });

  it("emails every address in ALERT_EMAIL_TO", async () => {
    vi.stubEnv("ALERT_EMAIL_TO", ` ${OPS}, second@example.test ,`);
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    await settle(s.t);

    const recipients = fetchMock.mock.calls
      .filter(([url]) => url === RESEND_URL)
      .flatMap(([, init]) => JSON.parse(init.body as string).to);
    expect(recipients.sort()).toEqual([OPS, "second@example.test"].sort());
  });

  it("records the problem even when no one is set up to be emailed", async () => {
    vi.stubEnv("ALERT_EMAIL_TO", "");
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    await settle(s.t);

    expect(await allAlerts(s.t)).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("ALERT_EMAIL_TO isn't set"),
    );
  });

  it("records the problem even when the email can't be sent", async () => {
    const s = await setup();
    fetchMock.mockImplementation(async () => json({ message: "down" }, 500));
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    await settle(s.t);

    expect(await allAlerts(s.t)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not email the PAYPAL_NOT_CONFIGURED"),
      expect.stringContaining("Resend 500"),
    );
  });

  it("doesn't email about one that was resolved before the email went out", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    const [alert] = await allAlerts(s.t);
    await s.mod.mutation(api.systemAlerts.resolve, { alertId: alert._id });
    await settle(s.t);
    expect(alertEmails()).toHaveLength(0);
  });
});

// ---- SasaPay notifications ------------------------------------------

const settled = <R>(promise: Promise<R>) =>
  promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

function callback(
  s: { t: T },
  body: unknown,
  token: string | null = SASAPAY_SECRET,
) {
  return s.t.fetch(
    `/sasapay/donations/callback${token === null ? "" : `?token=${token}`}`,
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

async function seedPendingDonation(s: Awaited<ReturnType<typeof setup>>) {
  return await s.t.run((ctx) =>
    ctx.db.insert("donations", {
      fundraiserId: s.ids.fundraiser,
      donorEmail: "donor@example.test",
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES",
      provider: "SASAPAY",
      checkoutRequestId: "ws_CO_PENDING",
      platformFeeRate: 0.0425,
      platformFeeAmount: 42.5,
      netAmount: 957.5,
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

describe("SasaPay payment notifications", () => {
  it("raises an error when the secret isn't set, and still turns the request away", async () => {
    vi.stubEnv("SASAPAY_CALLBACK_SECRET", "");
    const s = await setup();
    const response = await callback(s, { CheckoutRequestID: "x" });
    await settle(s.t);

    expect(response.status).toBe(401);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("SASAPAY_NOT_CONFIGURED");
    expect(alertEmails()).toHaveLength(1);
  });

  it("raises a warning, not an email, for a wrong or missing token", async () => {
    const s = await setup();
    expect((await callback(s, {}, "wrong")).status).toBe(401);
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    expect((await callback(s, {}, null)).status).toBe(401);
    await settle(s.t);

    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "SASAPAY_CALLBACK_REJECTED",
      count: 2,
    });
    // What the caller sent is never kept.
    expect(alert.detail).not.toContain("wrong");
    expect(alertEmails()).toHaveLength(0);
  });

  it("says nothing when a notification is handled", async () => {
    const s = await setup();
    const donationId = await seedPendingDonation(s);
    const response = await callback(s, {
      CheckoutRequestID: "ws_CO_PENDING",
      ResultCode: 0,
      TransactionCode: "RKT1",
      SourceChannel: "M-PESA",
    });
    await settle(s.t);

    expect(response.status).toBe(200);
    const donation = await s.t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.status).toBe("COMPLETED");
    expect(await allAlerts(s.t)).toHaveLength(0);
  });

  it("says nothing when a payment fails or is cancelled", async () => {
    const s = await setup();
    await seedPendingDonation(s);
    const response = await callback(s, {
      CheckoutRequestID: "ws_CO_PENDING",
      ResultCode: "1032",
      ResultDesc: "Request cancelled by user",
    });
    expect(response.status).toBe(200);
    expect(await allAlerts(s.t)).toHaveLength(0);
  });

  it("raises an error when a successful payment matches no donation, and still answers 200", async () => {
    const s = await setup();
    const response = await callback(s, {
      CheckoutRequestID: "ws_CO_0712345678",
      ResultCode: 0,
      TransactionCode: "RKT2",
      // Nothing from the payload but its ids may be kept.
      CustomerMobile: "254712345678",
      TransAmount: "1500",
    });
    await settle(s.t);

    expect(response.status).toBe(200);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "SASAPAY_PAYMENT_UNMATCHED",
      reference: "ws_CO_0712345678",
      detail: "CheckoutRequestID ws_CO_0712345678, transaction RKT2.",
    });
    expect(JSON.stringify(alert)).not.toContain("254712345678");
    expect(JSON.stringify(alert)).not.toContain("1500");
    expect(alertEmails()).toHaveLength(1);
  });

  it("is quiet about a failed payment that matches no donation (a stale callback)", async () => {
    const s = await setup();
    const response = await callback(s, {
      CheckoutRequestID: "ws_CO_STALE",
      ResultCode: "1",
    });
    expect(response.status).toBe(200);
    expect(await allAlerts(s.t)).toHaveLength(0);
  });

  it("counts a retried notification on the same alert", async () => {
    const s = await setup();
    const body = { CheckoutRequestID: "ws_CO_RETRY", ResultCode: 0 };
    await callback(s, body);
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await callback(s, body);
    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(2);
  });

  it("raises an error when a notification has no CheckoutRequestID, naming its fields but not their values", async () => {
    const s = await setup();
    const response = await callback(s, {
      ResultCode: 0,
      CustomerMobile: "254712345678",
    });
    await settle(s.t);

    expect(response.status).toBe(400);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("SASAPAY_CALLBACK_FAILED");
    expect(alert.detail).toContain("ResultCode, CustomerMobile");
    expect(alert.detail).not.toContain("254712345678");
    expect(alertEmails()).toHaveLength(1);
  });

  it("raises an error when handling a notification breaks, and still fails the way it did", async () => {
    const s = await setup();
    await seedPendingDonation(s);

    // A description that isn't text is refused when the donation is updated.
    const outcome = await settled(
      callback(s, {
        CheckoutRequestID: "ws_CO_PENDING",
        ResultCode: "1",
        ResultDesc: 12345,
      }),
    );
    await settle(s.t);

    // Either way the caller doesn't get a 200, so SasaPay can try again.
    expect("error" in outcome || outcome.value.status >= 500).toBe(true);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("SASAPAY_CALLBACK_FAILED");
    expect(alert.detail).toBeTruthy();
    expect(alertEmails()).toHaveLength(1);
  });

  it("raises an error when the body can't be read", async () => {
    const s = await setup();
    const outcome = await settled(callback(s, "this is not json"));
    await settle(s.t);

    expect("error" in outcome || outcome.value.status >= 500).toBe(true);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("SASAPAY_CALLBACK_FAILED");
  });
});

// ---- PayPal notifications -------------------------------------------

const PAYPAL_HEADERS = {
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-time": "2026-11-23T09:00:00Z",
  "paypal-transmission-sig": "sig",
  "paypal-cert-url": "https://api.paypal.com/cert.pem",
  "paypal-auth-algo": "SHA256withRSA",
};

function paypal(
  s: { t: T },
  event: unknown,
  headers: Record<string, string> = PAYPAL_HEADERS,
) {
  return s.t.fetch("/paypal/webhook", {
    method: "POST",
    headers,
    body: typeof event === "string" ? event : JSON.stringify(event),
  });
}

const saleCompleted = {
  id: "WH-SALE-1",
  event_type: "PAYMENT.SALE.COMPLETED",
  resource: {
    id: "SALE-1",
    billing_agreement_id: "I-UNKNOWN",
    amount: { total: "10.00", currency: "USD" },
  },
};

describe("PayPal notifications", () => {
  it("raises an error when the webhook id isn't set, and still turns the request away", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    const s = await setup();
    const response = await paypal(s, saleCompleted);
    await settle(s.t);

    expect(response.status).toBe(401);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("PAYPAL_NOT_CONFIGURED");
    expect(alertEmails()).toHaveLength(1);
  });

  it("raises a warning, not an email, for a request with no signature", async () => {
    const s = await setup();
    const response = await paypal(s, saleCompleted, {});
    await settle(s.t);

    expect(response.status).toBe(401);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "PAYPAL_WEBHOOK_REJECTED",
      detail: "It had no PayPal signature headers.",
    });
    expect(alertEmails()).toHaveLength(0);
    // PayPal wasn't even asked.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raises a warning for a body that isn't JSON, without asking PayPal", async () => {
    const s = await setup();
    const response = await paypal(s, "garbage");
    expect(response.status).toBe(401);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "PAYPAL_WEBHOOK_REJECTED",
      detail: "Its body wasn't JSON.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raises a warning when PayPal says the signature is wrong", async () => {
    const s = await setup();
    verifyAnswer = () => json({ verification_status: "FAILURE" });
    const response = await paypal(s, saleCompleted);
    await settle(s.t);

    expect(response.status).toBe(401);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("PAYPAL_WEBHOOK_REJECTED");
    expect(alertEmails()).toHaveLength(0);
  });

  it("treats PayPal refusing what was sent (a wrong webhook id) as a rejection", async () => {
    const s = await setup();
    verifyAnswer = () => json({ name: "INVALID_RESOURCE_ID" }, 400);
    const response = await paypal(s, saleCompleted);
    expect(response.status).toBe(401);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "PAYPAL_WEBHOOK_REJECTED",
      detail: "PayPal's signature check refused it (HTTP 400).",
    });
  });

  it("raises an error when PayPal's signature check is down", async () => {
    const s = await setup();
    for (const status of [500, 503, 429]) {
      verifyAnswer = () => json({}, status);
      later(SYSTEM_ALERT_THROTTLE_MS * 2);
      expect((await paypal(s, saleCompleted)).status).toBe(401);
    }
    await settle(s.t);

    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "PAYPAL_WEBHOOK_FAILED",
      count: 3,
      detail: "PayPal's signature check answered HTTP 429.",
    });
    expect(alertEmails()).toHaveLength(1);
  });

  it("raises an error when we can't sign in to PayPal, and still fails the way it did", async () => {
    const s = await setup();
    tokenAnswer = () => json({ error: "invalid_client" }, 401);
    const outcome = await settled(paypal(s, saleCompleted));
    await settle(s.t);

    expect("error" in outcome || outcome.value.status >= 500).toBe(true);
    const [alert] = await allAlerts(s.t);
    expect(alert.kind).toBe("PAYPAL_WEBHOOK_FAILED");
    expect(alert.detail).toContain("Could not check the signature");
    expect(alert.detail).toContain("Failed to obtain PayPal OAuth token");
    expect(alertEmails()).toHaveLength(1);
  });

  it("says nothing when a notification is valid and handled", async () => {
    const s = await setup();
    const response = await paypal(s, {
      id: "WH-OTHER",
      event_type: "SOMETHING.ELSE",
      resource: { id: "X" },
    });
    expect(response.status).toBe(200);
    expect(await allAlerts(s.t)).toHaveLength(0);
  });

  it("raises an error for a recurring payment with no subscription, and still answers 200", async () => {
    const s = await setup();
    const response = await paypal(s, saleCompleted);
    await settle(s.t);

    expect(response.status).toBe(200);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "PAYPAL_PAYMENT_UNMATCHED",
      reference: "SALE-1",
      detail: "Sale SALE-1 for subscription I-UNKNOWN.",
    });
    expect(alertEmails()).toHaveLength(1);
  });

  it("raises a warning for a refund of a payment we can't find, and still answers 404", async () => {
    const s = await setup();
    const response = await paypal(s, {
      id: "WH-REFUND-1",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REFUND-1",
        links: [
          {
            rel: "up",
            href: "https://api.paypal.com/v2/payments/captures/CAPTURE-404",
          },
        ],
      },
    });
    await settle(s.t);

    expect(response.status).toBe(404);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "PAYPAL_REFUND_UNMATCHED",
      reference: "REFUND-1",
      detail: "PAYMENT.CAPTURE.REFUNDED, PayPal id REFUND-1.",
    });
    expect(alertEmails()).toHaveLength(0);
  });

  it("raises an error when handling a notification breaks, naming the event, and still fails the way it did", async () => {
    const s = await setup();
    // A refund with no resource fails inside the handler.
    const outcome = await settled(
      paypal(s, { id: "WH-BROKEN", event_type: "PAYMENT.CAPTURE.REFUNDED" }),
    );
    await settle(s.t);

    expect("error" in outcome || outcome.value.status >= 500).toBe(true);
    const [alert] = await allAlerts(s.t);
    expect(alert).toMatchObject({
      kind: "PAYPAL_WEBHOOK_FAILED",
      reference: "WH-BROKEN",
    });
    expect(alert.detail).toContain("PAYMENT.CAPTURE.REFUNDED:");
    expect(alertEmails()).toHaveLength(1);
  });

  it("counts PayPal sending the same failing notification again on one alert", async () => {
    const s = await setup();
    const broken = { id: "WH-AGAIN", event_type: "PAYMENT.CAPTURE.REFUNDED" };
    await settled(paypal(s, broken));
    later(SYSTEM_ALERT_THROTTLE_MS * 2);
    await settled(paypal(s, broken));

    const alerts = await allAlerts(s.t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].count).toBe(2);
  });
});

// ---- What staff see -------------------------------------------------

describe("the alerts page", () => {
  it("is for staff only", async () => {
    const s = await setup();
    for (const call of [
      () => s.alice.query(api.systemAlerts.listOpen, {}),
      () => s.alice.query(api.systemAlerts.listResolved, {}),
      () => s.alice.query(api.systemAlerts.emailsOn, {}),
      () => s.t.query(api.systemAlerts.listOpen, {}),
    ]) {
      await expect(call()).rejects.toThrow();
    }
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    const [alert] = await allAlerts(s.t);
    await expect(
      s.alice.mutation(api.systemAlerts.resolve, { alertId: alert._id }),
    ).rejects.toThrow("You don't have permission to do that.");
    expect((await allAlerts(s.t))[0].status).toBe("OPEN");
  });

  it("lists open alerts, the one seen most recently first", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_NOT_CONFIGURED");
    later(MINUTE);
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    later(MINUTE);
    await record(s.t, "SASAPAY_NOT_CONFIGURED");

    const open = await s.mod.query(api.systemAlerts.listOpen, {});
    expect(open.map((alert) => alert.kind)).toEqual([
      "SASAPAY_NOT_CONFIGURED",
      "PAYPAL_NOT_CONFIGURED",
    ]);
    expect(open[0]).toMatchObject({
      count: 2,
      reference: null,
      detail: null,
      resolvedAt: null,
    });
  });

  it("lets a moderator resolve one, with a note, and shows it as resolved", async () => {
    const s = await setup();
    await record(s.t, "SASAPAY_PAYMENT_UNMATCHED", { reference: "ws_CO_1" });
    const [alert] = await s.mod.query(api.systemAlerts.listOpen, {});

    await s.mod.mutation(api.systemAlerts.resolve, {
      alertId: alert._id,
      note: "  Recorded by hand, see SasaPay RKT1. ",
    });

    expect(await s.mod.query(api.systemAlerts.listOpen, {})).toEqual([]);
    const [resolved] = await s.mod.query(api.systemAlerts.listResolved, {});
    expect(resolved).toMatchObject({
      _id: alert._id,
      resolvedByName: "Mo Derator",
      resolveNote: "Recorded by hand, see SasaPay RKT1.",
    });
    expect(resolved.resolvedAt).toBeGreaterThanOrEqual(NOW);
  });

  it("won't resolve one twice, or one that is gone, or take an essay as a note", async () => {
    const s = await setup();
    await record(s.t, "PAYPAL_NOT_CONFIGURED");
    const [alert] = await allAlerts(s.t);

    await expect(
      s.mod.mutation(api.systemAlerts.resolve, {
        alertId: alert._id,
        note: "n".repeat(1001),
      }),
    ).rejects.toThrow("Keep notes under 1000 characters.");

    await s.mod.mutation(api.systemAlerts.resolve, { alertId: alert._id });
    await expect(
      s.admin.mutation(api.systemAlerts.resolve, { alertId: alert._id }),
    ).rejects.toThrow("Someone has already resolved this alert.");

    await s.t.run((ctx) => ctx.db.delete(alert._id));
    await expect(
      s.admin.mutation(api.systemAlerts.resolve, { alertId: alert._id }),
    ).rejects.toThrow("That alert no longer exists.");
  });

  it("shows only the latest few resolved ones", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("systemAlerts", {
          kind: "PAYPAL_REFUND_UNMATCHED",
          reference: `R-${i}`,
          status: "RESOLVED",
          count: 1,
          firstSeenAt: NOW - DAY + i,
          lastSeenAt: NOW - DAY + i,
          resolvedAt: NOW,
        });
      }
    });
    const resolved = await s.mod.query(api.systemAlerts.listResolved, {});
    expect(resolved).toHaveLength(20);
    expect(resolved[0].reference).toBe("R-24");
  });

  it("says whether alert emails will actually be sent", async () => {
    const s = await setup();
    expect(await s.mod.query(api.systemAlerts.emailsOn, {})).toBe(true);

    vi.stubEnv("ALERT_EMAIL_TO", "");
    expect(await s.mod.query(api.systemAlerts.emailsOn, {})).toBe(false);

    vi.stubEnv("ALERT_EMAIL_TO", OPS);
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await s.mod.query(api.systemAlerts.emailsOn, {})).toBe(false);
  });
});

describe("the count on the admin overview", () => {
  it("counts open alerts, and how many of them are errors", async () => {
    const s = await setup();
    const attention = () => s.mod.query(api.admin.getAttentionCounts, {});
    expect((await attention()).systemAlerts).toEqual({
      count: 0,
      capped: false,
      errors: 0,
    });

    await record(s.t, "SASAPAY_CALLBACK_REJECTED"); // a warning
    expect((await attention()).systemAlerts).toEqual({
      count: 1,
      capped: false,
      errors: 0,
    });

    await record(s.t, "PAYPAL_NOT_CONFIGURED"); // an error
    expect((await attention()).systemAlerts).toEqual({
      count: 2,
      capped: false,
      errors: 1,
    });

    const [error] = (await allAlerts(s.t)).filter(
      (alert) => alert.kind === "PAYPAL_NOT_CONFIGURED",
    );
    await s.mod.mutation(api.systemAlerts.resolve, { alertId: error._id });
    expect((await attention()).systemAlerts).toMatchObject({
      count: 1,
      errors: 0,
    });
  });

  it("counts up to a hundred, then says there are more", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("systemAlerts", {
          kind: "PAYPAL_REFUND_UNMATCHED",
          reference: `R-${i}`,
          status: "OPEN",
          count: 1,
          firstSeenAt: NOW,
          lastSeenAt: NOW,
        });
      }
    });
    expect(
      (await s.mod.query(api.admin.getAttentionCounts, {})).systemAlerts,
    ).toMatchObject({ count: 100, capped: true });
  });
});

// ---- Clean-up -------------------------------------------------------

describe("clearing out old alerts", () => {
  const row = (
    status: "OPEN" | "RESOLVED",
    lastSeenAt: number,
    reference: string,
  ) => ({
    kind: "PAYPAL_REFUND_UNMATCHED" as const,
    reference,
    status,
    count: 1,
    firstSeenAt: lastSeenAt,
    lastSeenAt,
  });

  it("deletes resolved alerts after ninety days and nothing else", async () => {
    const s = await setup();
    const old = NOW - SYSTEM_ALERT_KEEP_RESOLVED_MS - DAY;
    await s.t.run(async (ctx) => {
      await ctx.db.insert("systemAlerts", row("RESOLVED", old, "old-resolved"));
      await ctx.db.insert(
        "systemAlerts",
        row("RESOLVED", NOW - DAY, "recent-resolved"),
      );
      // Still open, however old: someone has yet to deal with it.
      await ctx.db.insert("systemAlerts", row("OPEN", old, "old-open"));
    });

    await s.t.mutation(internal.systemAlerts.prune, {});

    const left = (await allAlerts(s.t)).map((alert) => alert.reference).sort();
    expect(left).toEqual(["old-open", "recent-resolved"]);
  });

  it("keeps going when there are more than one batch", async () => {
    const s = await setup();
    const old = NOW - SYSTEM_ALERT_KEEP_RESOLVED_MS - DAY;
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 230; i++) {
        await ctx.db.insert("systemAlerts", row("RESOLVED", old, `r-${i}`));
      }
    });
    await s.t.mutation(internal.systemAlerts.prune, {});
    expect(await allAlerts(s.t)).toHaveLength(30);
    await settle(s.t);
    expect(await allAlerts(s.t)).toHaveLength(0);
  });

  it("runs every day", async () => {
    const crons = (await import("./crons")).default;
    expect(crons.crons["delete old resolved system alerts"]).toMatchObject({
      name: "guardedJobs:pruneAlerts",
      schedule: { type: "interval", hours: 24 },
    });
  });
});
