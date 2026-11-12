/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  EMAIL_FROM,
  EMAIL_RETRY_DELAYS_MS,
  MAX_EMAIL_ATTEMPTS,
} from "./lib/email";

// The donations code reaches the auth component; these tests never sign in.
vi.mock("./auth", () => ({
  authComponent: { safeGetAuthUser: async () => null },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const DONOR_EMAIL = "donor@example.test";

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
const reply = (status: number, body = "") => new Response(body, { status });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T02:49:00Z"));
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok());
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
    const fundraiserId = await ctx.db.insert("fundraisers", {
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
    });
    return { owner, fundraiserId };
  });
  return { t, ids };
}
type S = Awaited<ReturnType<typeof setup>>;

type DonationOverrides = Partial<Omit<Doc<"donations">, "_id" | "_creationTime">>;

/** A donation as the payment paths find it: asked for, not yet paid. */
function pendingDonation(s: S, overrides: DonationOverrides = {}) {
  return s.t.run((ctx) => {
    const now = Date.now();
    const doc = {
      fundraiserId: s.ids.fundraiserId,
      donorName: "Wanjiru Kamau",
      donorEmail: DONOR_EMAIL,
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES" as const,
      platformFeeRate: 0.0425,
      platformFeeAmount: 42.5,
      netAmount: 957.5,
      status: "PENDING" as const,
      payoutStatus: "NOT_YET_PAYABLE" as const,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    // An explicit "no email" means the field is absent, as it is in real data.
    const { donorEmail, ...rest } = doc;
    return ctx.db.insert(
      "donations",
      donorEmail === undefined ? rest : { ...rest, donorEmail },
    );
  });
}

/** A donation that is already paid, for tests that start at the receipt. */
const paidDonation = (s: S, overrides: DonationOverrides = {}) =>
  pendingDonation(s, {
    status: "COMPLETED",
    payoutStatus: "PENDING_PAYOUT",
    paymentMethod: "MPESA",
    providerTransactionCode: "TKB1234XYZ",
    completedAt: Date.now(),
    ...overrides,
  });

const queue = (s: S, donationId: Id<"donations">) =>
  s.t.mutation(internal.receipts.queueReceipt, { donationId });

const receipts = (t: T) =>
  t.run((ctx) => ctx.db.query("donationReceipts").collect());

const receiptFor = async (t: T, donationId: Id<"donations">) =>
  (await receipts(t)).find((r) => r.donationId === donationId);

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
    },
  }));

describe("queueing a receipt", () => {
  it("creates one receipt for the donation and sends it", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    expect(await receiptFor(s.t, donationId)).toMatchObject({
      status: "PENDING",
      attempts: 0,
      generation: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await settle(s.t);

    expect(sentEmails()).toHaveLength(1);
    const [email] = sentEmails();
    expect(email.url).toBe("https://api.resend.com/emails");
    expect(email.body.from).toBe(EMAIL_FROM);
    expect(email.body.to).toEqual([DONOR_EMAIL]);
    expect(email.body.subject).toBe(
      "Your GoUplift receipt: KES 1,000 to Water for Kajiado",
    );
    expect(email.headers["Idempotency-Key"]).toBe(`receipt-${donationId}-0`);

    const row = await receiptFor(s.t, donationId);
    expect(row).toMatchObject({ status: "SENT", attempts: 1, emailId: "em_1" });
    expect(row?.sentAt).toBeTypeOf("number");
    expect(row?.lastError).toBeUndefined();
  });

  it("does nothing the second time it is asked", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);
    await queue(s, donationId);
    await settle(s.t);

    expect(await receipts(s.t)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not queue a receipt for a donation that isn't paid", async () => {
    const s = await setup();
    for (const status of ["PENDING", "FAILED", "CANCELLED", "REFUNDED"] as const) {
      await queue(s, await pendingDonation(s, { status }));
    }
    await settle(s.t);

    expect(await receipts(s.t)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for a donation that no longer exists", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);
    await s.t.run((ctx) => ctx.db.delete(donationId));

    await queue(s, donationId);

    expect(await receipts(s.t)).toHaveLength(0);
  });

  it.each([
    ["has no email", undefined, "NO_EMAIL"],
    ["has an empty email", "", "NO_EMAIL"],
    ["has a blank email", "   ", "NO_EMAIL"],
    ["has an email that can't be right", "not-an-email", "INVALID_EMAIL"],
  ] as const)("records, and sends nothing, when the donor %s", async (_name, email, reason) => {
    const s = await setup();
    const donationId = await paidDonation(s, { donorEmail: email });

    await queue(s, donationId);
    await settle(s.t);

    expect(await receiptFor(s.t, donationId)).toMatchObject({
      status: "SKIPPED",
      skippedReason: reason,
      attempts: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what gets sent", () => {
  it("is a full PayPal monthly receipt, with the figures from the donation", async () => {
    const s = await setup();
    const donationId = await paidDonation(s, {
      provider: "PAYPAL",
      paymentMethod: "PAYPAL",
      providerTransactionCode: "SALE-9",
      originalCurrency: "USD",
      originalAmount: 10,
      exchangeRate: 130,
      grossAmount: 1300,
      platformFeeAmount: 55.25,
      netAmount: 1244.75,
      isSubscriptionPayment: true,
    });

    await queue(s, donationId);
    await settle(s.t);

    const { text, html, subject } = sentEmails()[0].body;
    expect(subject).toContain("KES 1,300");
    for (const part of [
      "Hello Wanjiru,",
      "USD 10.00",
      "KES 130 per US dollar",
      "PayPal transaction ID: SALE-9",
      "Type: Monthly gift",
      "KES 55.25",
      "KES 1,244.75",
      "12 Nov 2026, 05:49 EAT",
    ]) {
      expect(text).toContain(part);
    }
    expect(html).toContain("USD 10.00");
  });

  it("goes to an anonymous donor too, and says how it appears publicly", async () => {
    const s = await setup();
    const donationId = await paidDonation(s, { isAnonymous: true });

    await queue(s, donationId);
    await settle(s.t);

    expect(sentEmails()[0].body.to).toEqual([DONOR_EMAIL]);
    expect(sentEmails()[0].body.text).toContain("Shown publicly as: Anonymous");
  });

  it("escapes a fundraiser title that contains markup", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, {
        title: `<img src=x onerror=alert(1)> Rain & "shine"`,
      }),
    );
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);

    const { html, subject } = sentEmails()[0].body;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("still goes out, with a plain title, if the fundraiser is gone", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);
    await s.t.run((ctx) => ctx.db.delete(s.ids.fundraiserId));

    await queue(s, donationId);
    await settle(s.t);

    expect(sentEmails()[0].body.subject).toContain("a GoUplift fundraiser");
  });

  it("is not sent for a donation refunded after the receipt was queued", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);
    await queue(s, donationId);
    await s.t.run((ctx) => ctx.db.patch(donationId, { status: "REFUNDED" }));

    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await receiptFor(s.t, donationId)).toMatchObject({
      status: "SKIPPED",
      skippedReason: "NOT_COMPLETED",
    });
  });

  it("never stores the donor's address on the receipt, even when an error mentions it", async () => {
    const s = await setup();
    fetchMock.mockImplementation(async () =>
      reply(422, `${DONOR_EMAIL} is not a valid address`),
    );
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);

    const row = await receiptFor(s.t, donationId);
    expect(row?.status).toBe("FAILED");
    expect(row?.lastError).toContain("[email]");
    expect(JSON.stringify(row)).not.toContain(DONOR_EMAIL);
  });
});

describe("when sending doesn't work", () => {
  it("backs off on the schedule, then gives up and says why", async () => {
    const s = await setup();
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return reply(500, "internal error");
    });
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_EMAIL_ATTEMPTS);
    const row = await receiptFor(s.t, donationId);
    expect(row).toMatchObject({
      status: "FAILED",
      attempts: MAX_EMAIL_ATTEMPTS,
      lastStatusCode: 500,
    });
    expect(row?.lastError).toContain("Resend 500");
    expect(row?.nextAttemptAt).toBeUndefined();

    // Each wait is at least the configured delay, and not much more.
    times.slice(1).forEach((time, i) => {
      const gap = time - times[i];
      expect(gap).toBeGreaterThanOrEqual(EMAIL_RETRY_DELAYS_MS[i]);
      expect(gap).toBeLessThan(EMAIL_RETRY_DELAYS_MS[i] + 5_000);
    });

    // Every attempt is the same request, so Resend can tell it's a repeat.
    const emails = sentEmails();
    expect(new Set(emails.map((e) => e.headers["Idempotency-Key"])).size).toBe(1);
    expect(new Set(emails.map((e) => JSON.stringify(e.body))).size).toBe(1);
  });

  it("stops retrying as soon as one attempt gets through", async () => {
    const s = await setup();
    fetchMock
      .mockImplementationOnce(async () => reply(503))
      .mockImplementationOnce(async () => reply(429))
      .mockImplementation(async () => ok());
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const row = await receiptFor(s.t, donationId);
    expect(row).toMatchObject({ status: "SENT", attempts: 3 });
    expect(row?.lastError).toBeUndefined();
    expect(row?.lastStatusCode).toBeUndefined();
    expect(row?.nextAttemptAt).toBeUndefined();
  });

  it("retries after a connection failure", async () => {
    const s = await setup();
    fetchMock
      .mockImplementationOnce(async () => {
        throw new TypeError("fetch failed");
      })
      .mockImplementation(async () => ok());
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await receiptFor(s.t, donationId))?.status).toBe("SENT");
  });

  it("records when the next attempt is due", async () => {
    const s = await setup();
    fetchMock.mockImplementation(async () => reply(500));
    const donationId = await paidDonation(s);
    await queue(s, donationId);
    const receipt = await receiptFor(s.t, donationId);

    await s.t.action(internal.receipts.send, { receiptId: receipt!._id });

    const row = await receiptFor(s.t, donationId);
    expect(row).toMatchObject({ status: "RETRYING", attempts: 1 });
    expect(row!.nextAttemptAt! - row!.lastAttemptAt!).toBe(
      EMAIL_RETRY_DELAYS_MS[0],
    );
  });

  it.each([400, 401, 403, 422])(
    "does not retry a %i, because asking again won't change the answer",
    async (status) => {
      const s = await setup();
      fetchMock.mockImplementation(async () => reply(status));
      const donationId = await paidDonation(s);

      await queue(s, donationId);
      await settle(s.t);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await receiptFor(s.t, donationId)).toMatchObject({
        status: "FAILED",
        attempts: 1,
        lastStatusCode: status,
      });
    },
  );

  it("fails at once, saying what to set, when there is no API key", async () => {
    const s = await setup();
    vi.stubEnv("RESEND_API_KEY", "");
    const donationId = await paidDonation(s);

    await queue(s, donationId);
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    const row = await receiptFor(s.t, donationId);
    expect(row).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(row?.lastError).toContain("RESEND_API_KEY");
  });

  it("does not send again if the send step runs for a receipt that is already sent", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);
    await queue(s, donationId);
    await settle(s.t);
    const receipt = await receiptFor(s.t, donationId);

    await s.t.action(internal.receipts.send, { receiptId: receipt!._id });
    await s.t.action(internal.receipts.send, { receiptId: receipt!._id });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await receiptFor(s.t, donationId))?.attempts).toBe(1);
  });

  it("does not undo a result that arrives late", async () => {
    const s = await setup();
    const donationId = await paidDonation(s);
    await queue(s, donationId);
    await settle(s.t);
    const receipt = await receiptFor(s.t, donationId);

    // A slow attempt reporting failure after another already got through.
    await s.t.mutation(internal.receipts.recordAttempt, {
      receiptId: receipt!._id,
      outcome: { kind: "failed", retryable: true, error: "late" },
    });

    expect(await receiptFor(s.t, donationId)).toMatchObject({
      status: "SENT",
      attempts: 1,
    });
  });
});

describe("trying failed receipts again", () => {
  it("sends them once the cause is fixed, as a new request", async () => {
    const s = await setup();
    fetchMock.mockImplementation(async () => reply(500));
    const donationId = await paidDonation(s);
    await queue(s, donationId);
    await settle(s.t);
    expect((await receiptFor(s.t, donationId))?.status).toBe("FAILED");
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ok());

    const result = await s.t.mutation(internal.receipts.requeueFailed, {});
    await settle(s.t);

    expect(result).toEqual({ requeued: 1, more: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A new key, so Resend doesn't answer with the failure it remembers.
    expect(sentEmails()[0].headers["Idempotency-Key"]).toBe(
      `receipt-${donationId}-1`,
    );
    const row = await receiptFor(s.t, donationId);
    expect(row).toMatchObject({ status: "SENT", attempts: 1, generation: 1 });
    expect(row?.lastError).toBeUndefined();
  });

  it("leaves sent, skipped and in-progress receipts alone", async () => {
    const s = await setup();
    const sent = await paidDonation(s);
    await queue(s, sent);
    await settle(s.t);
    const skipped = await paidDonation(s, { donorEmail: undefined });
    await queue(s, skipped);
    fetchMock.mockClear();

    const result = await s.t.mutation(internal.receipts.requeueFailed, {});
    await settle(s.t);

    expect(result).toEqual({ requeued: 0, more: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await receiptFor(s.t, sent))?.status).toBe("SENT");
    expect((await receiptFor(s.t, skipped))?.status).toBe("SKIPPED");
  });

  it("carries on through more than one batch by itself", async () => {
    const s = await setup();
    const total = 55;
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < total; i++) {
        const donationId = await ctx.db.insert("donations", {
          fundraiserId: s.ids.fundraiserId,
          donorEmail: `donor${i}@example.test`,
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
        await ctx.db.insert("donationReceipts", {
          donationId,
          status: "FAILED",
          attempts: MAX_EMAIL_ATTEMPTS,
          generation: 0,
          lastError: "Resend 500: down",
          createdAt: now,
        });
      }
    });

    const first = await s.t.mutation(internal.receipts.requeueFailed, {});
    expect(first).toEqual({ requeued: 50, more: true });
    await settle(s.t);

    expect(fetchMock).toHaveBeenCalledTimes(total);
    const rows = await receipts(s.t);
    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
  });
});

describe("the payment paths", () => {
  it("send one receipt when a mobile money donation completes, however often the callback arrives", async () => {
    const s = await setup();
    const donationId = await pendingDonation(s);
    const complete = () =>
      s.t.mutation(internal.donations.markDonationCompleted, {
        donationId,
        providerTransactionCode: "TKB1234XYZ",
        paymentMethod: "MPESA",
      });

    await complete();
    await settle(s.t);
    await complete();
    await settle(s.t);

    expect(sentEmails()).toHaveLength(1);
    expect(sentEmails()[0].body.text).toContain("Paid with: M-Pesa");
    expect(sentEmails()[0].body.text).toContain(
      "Payment reference: TKB1234XYZ",
    );
    expect(await receipts(s.t)).toHaveLength(1);
  });

  it("send one receipt when a PayPal donation completes", async () => {
    const s = await setup();
    const donationId = await pendingDonation(s, {
      provider: "PAYPAL",
      originalCurrency: "USD",
      originalAmount: 25,
      exchangeRate: 130,
      grossAmount: 3250,
      paymentMethod: "PAYPAL",
    });
    const complete = () =>
      s.t.mutation(internal.paypal.completePayPalDonation, {
        donationId,
        paypalCaptureId: "CAPTURE-1",
      });

    await complete();
    await settle(s.t);
    await complete(); // a repeated PayPal notification
    await settle(s.t);

    expect(sentEmails()).toHaveLength(1);
    expect(sentEmails()[0].body.text).toContain("USD 25.00");
    expect(sentEmails()[0].body.text).toContain(
      "PayPal transaction ID: CAPTURE-1",
    );
  });

  it("send a receipt for each monthly PayPal payment, once per payment", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.insert("paypalSubscriptions", {
        fundraiserId: s.ids.fundraiserId,
        donorEmail: DONOR_EMAIL,
        donorName: "Monthly Giver",
        isAnonymous: false,
        paypalSubscriptionId: "I-SUB1",
        paypalPlanId: "P-1",
        monthlyAmountUsd: 10,
        status: "ACTIVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const pay = (paypalSaleId: string) =>
      s.t.mutation(internal.paypal.recordSubscriptionPayment, {
        paypalSubscriptionId: "I-SUB1",
        paypalSaleId,
        grossAmountUsd: 10,
        exchangeRate: 130,
      });

    await pay("SALE-1");
    await pay("SALE-1"); // the same payment announced twice
    await settle(s.t);
    await pay("SALE-2"); // next month
    await settle(s.t);

    const emails = sentEmails();
    expect(emails).toHaveLength(2);
    expect(emails[0].body.text).toContain("Hello Monthly,");
    expect(emails[0].body.text).toContain("Type: Monthly gift");
    expect(emails[0].body.text).toContain("PayPal transaction ID: SALE-1");
    expect(emails[1].body.text).toContain("PayPal transaction ID: SALE-2");
  });

  it("record that no receipt was possible when the donor gave no email", async () => {
    const s = await setup();
    const donationId = await pendingDonation(s, { donorEmail: undefined });

    await s.t.mutation(internal.donations.markDonationCompleted, { donationId });
    await settle(s.t);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await receiptFor(s.t, donationId)).toMatchObject({
      status: "SKIPPED",
      skippedReason: "NO_EMAIL",
    });
  });

  it("leave the payment recorded when email is completely down", async () => {
    const s = await setup();
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const donationId = await pendingDonation(s);

    await s.t.mutation(internal.donations.markDonationCompleted, { donationId });
    await settle(s.t);

    const donation = await s.t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.status).toBe("COMPLETED");
    const fundraiser = await s.t.run((ctx) => ctx.db.get(s.ids.fundraiserId));
    expect(fundraiser?.amountRaised).toBe(1000);
    expect(fundraiser?.donorCount).toBe(1);
    expect((await receiptFor(s.t, donationId))?.status).toBe("FAILED");
  });
});
