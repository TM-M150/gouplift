/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  MAX_DELIVERY_ATTEMPTS,
  MAX_WEBHOOK_ENDPOINTS,
  RETRY_DELAYS_MS,
} from "./lib/webhookConfig";
import { sendWebhook } from "./lib/webhookSend";
import { verifySignatureHeader } from "./lib/webhookSignature";

// The real auth component needs a running Better Auth deployment. Everything
// here only uses `safeGetAuthUser`, so it is replaced with a stand-in that
// reads the identity convex-test attaches. Which user is the owner, an admin,
// a stranger etc. is still decided by the real tables and the real code.
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
const SECRET = "whsec_fixed_secret_for_tests";
const URL_A = "https://hooks.example.org/a";
const URL_B = "https://hooks.example.org/b";

type T = TestConvex<typeof schema>;

// A response that fails the test if anything reads its body: the receiving
// server's answer must never be read, stored or shown.
function reply(status: number) {
  const unreadable = () => {
    throw new Error("the response body must never be read");
  };
  return {
    status,
    body: { cancel: async () => undefined },
    text: unreadable,
    json: unreadable,
    arrayBuffer: unreadable,
    blob: unreadable,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => reply(200));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (authUserId: string) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName: authUserId,
        role: "USER",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });
    const owner = await user("auth_owner");
    const admin = await user("auth_admin");
    const member = await user("auth_member");
    await user("auth_stranger");
    const otherOwner = await user("auth_other_owner");

    const org = (slug: string, status: "VERIFIED" | "PENDING_REVIEW") =>
      ctx.db.insert("organizations", {
        name: slug,
        slug,
        verificationStatus: status,
        createdBy: owner,
        createdAt: now,
        updatedAt: now,
      });
    const verifiedOrg = await org("verified-org", "VERIFIED");
    const pendingOrg = await org("pending-org", "PENDING_REVIEW");
    const otherOrg = await org("other-org", "VERIFIED");

    const join = (
      organizationId: Id<"organizations">,
      userId: Id<"users">,
      role: "OWNER" | "ADMIN" | "MEMBER",
    ) =>
      ctx.db.insert("organizationMembers", {
        organizationId,
        userId,
        role,
        joinedAt: now,
      });
    await join(verifiedOrg, owner, "OWNER");
    await join(verifiedOrg, admin, "ADMIN");
    await join(verifiedOrg, member, "MEMBER");
    await join(pendingOrg, owner, "OWNER");
    await join(otherOrg, otherOwner, "OWNER");

    const fundraiser = (organizationId?: Id<"organizations">) =>
      ctx.db.insert("fundraisers", {
        creatorId: owner,
        organizationId,
        beneficiaryType: "ORGANIZATION",
        title: "Clean water",
        story: "story",
        type: "NONPROFIT",
        goalAmount: 100000,
        currency: "KES",
        amountRaised: 0,
        donorCount: 0,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: true,
        createdAt: now,
        updatedAt: now,
      });

    return {
      verifiedOrg,
      pendingOrg,
      otherOrg,
      verifiedFundraiser: await fundraiser(verifiedOrg),
      pendingFundraiser: await fundraiser(pendingOrg),
      noOrgFundraiser: await fundraiser(undefined),
    };
  });

  const as = (subject: string) => t.withIdentity({ subject });
  return {
    t,
    ids,
    asOwner: as("auth_owner"),
    asAdmin: as("auth_admin"),
    asMember: as("auth_member"),
    asStranger: as("auth_stranger"),
    asOtherOwner: as("auth_other_owner"),
  };
}

function addEndpoint(
  t: T,
  organizationId: Id<"organizations">,
  over: { url?: string; isActive?: boolean; secret?: string } = {},
) {
  return t.run(async (ctx) => {
    const user = (await ctx.db.query("users").first())!;
    return ctx.db.insert("webhookEndpoints", {
      organizationId,
      url: over.url ?? URL_A,
      secret: over.secret ?? SECRET,
      isActive: over.isActive ?? true,
      createdBy: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

function pendingDonation(
  t: T,
  fundraiserId: Id<"fundraisers">,
  over: Record<string, unknown> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("donations", {
      fundraiserId,
      isAnonymous: false,
      grossAmount: 1000,
      currency: "KES",
      donorName: "Amina Wanjiru",
      donorEmail: "amina@private.example",
      donorPhone: "+254700111222",
      message: "Keep going",
      platformFeeRate: 0.05,
      platformFeeAmount: 50,
      netAmount: 950,
      status: "PENDING",
      payoutStatus: "NOT_YET_PAYABLE",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...over,
    }),
  );
}

const complete = (t: T, donationId: Id<"donations">) =>
  t.mutation(internal.donations.markDonationCompleted, {
    donationId,
    providerTransactionCode: "TX-SECRET-1",
  });
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const allDeliveries = (t: T) =>
  t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
const sentBodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));

// ============================================================ emission

describe("event emission at the three completion paths", () => {
  it("SasaPay: one delivery per ACTIVE endpoint, none for a paused one", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg, { url: URL_A });
    await addEndpoint(t, ids.verifiedOrg, { url: URL_B });
    await addEndpoint(t, ids.verifiedOrg, {
      url: "https://paused.example.org/hook",
      isActive: false,
    });

    const donationId = await pendingDonation(t, ids.verifiedFundraiser);
    await complete(t, donationId);
    await settle(t);

    const urls = fetchMock.mock.calls.map(([url]) => url).sort();
    expect(urls).toEqual([URL_A, URL_B]);
    const deliveries = await allDeliveries(t);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "SUCCEEDED")).toBe(true);

    const [body] = sentBodies();
    expect(body).toMatchObject({
      id: `evt_donation_completed_${donationId}`,
      type: "donation.completed",
      data: {
        donation: {
          id: donationId,
          fundraiserId: ids.verifiedFundraiser,
          organizationId: ids.verifiedOrg,
          amount: 1000,
          currency: "KES",
          donorName: "Amina Wanjiru",
          message: "Keep going",
        },
      },
    });
  });

  it("a redelivered callback does not queue a second event", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg);
    const donationId = await pendingDonation(t, ids.verifiedFundraiser);

    await complete(t, donationId);
    await settle(t);
    await complete(t, donationId); // the gateway sends the same callback again
    await settle(t);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await allDeliveries(t)).toHaveLength(1);
  });

  it("enqueueing the same donation twice still queues once per endpoint", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg);
    const donationId = await pendingDonation(t, ids.verifiedFundraiser);
    await t.run((ctx) => ctx.db.patch(donationId, { status: "COMPLETED" }));

    await t.mutation(internal.webhookDelivery.enqueueDonationCompleted, { donationId });
    await t.mutation(internal.webhookDelivery.enqueueDonationCompleted, { donationId });
    await settle(t);

    expect(await allDeliveries(t)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PayPal one-time donation", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg);
    const donationId = await pendingDonation(t, ids.verifiedFundraiser, {
      provider: "PAYPAL",
      originalCurrency: "USD",
      originalAmount: 25,
      grossAmount: 3250,
    });

    await t.mutation(internal.paypal.completePayPalDonation, {
      donationId,
      paypalCaptureId: "CAPTURE-1",
    });
    await settle(t);
    // a repeated PayPal notification
    await t.mutation(internal.paypal.completePayPalDonation, {
      donationId,
      paypalCaptureId: "CAPTURE-1",
    });
    await settle(t);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBodies()[0].data.donation).toMatchObject({
      amount: 25,
      currency: "USD",
    });
  });

  it("PayPal subscription payment (created already completed)", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg);
    await t.run((ctx) =>
      ctx.db.insert("paypalSubscriptions", {
        fundraiserId: ids.verifiedFundraiser,
        donorEmail: "monthly@private.example",
        donorName: "Monthly Giver",
        isAnonymous: false,
        message: "every month",
        paypalSubscriptionId: "I-SUB1",
        paypalPlanId: "P-1",
        monthlyAmountUsd: 10,
        status: "ACTIVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const args = {
      paypalSubscriptionId: "I-SUB1",
      paypalSaleId: "SALE-1",
      grossAmountUsd: 10,
      exchangeRate: 130,
    };
    await t.mutation(internal.paypal.recordSubscriptionPayment, args);
    await settle(t);
    await t.mutation(internal.paypal.recordSubscriptionPayment, args); // repeat
    await settle(t);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = sentBodies()[0].data.donation;
    expect(sent).toMatchObject({
      amount: 10,
      currency: "USD",
      donorName: "Monthly Giver",
      message: "every month",
    });
    expect(JSON.stringify(sentBodies())).not.toContain("monthly@private.example");
  });

  it.each([
    ["an organization that isn't verified", "pendingFundraiser"],
    ["a fundraiser with no organization", "noOrgFundraiser"],
  ] as const)("sends nothing for %s", async (_name, key) => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.pendingOrg);
    await addEndpoint(t, ids.verifiedOrg);
    const donationId = await pendingDonation(t, ids[key]);
    await complete(t, donationId);
    await settle(t);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await allDeliveries(t)).toHaveLength(0);
  });

  it("sends nothing when the organization has no endpoints", async () => {
    const { t, ids } = await setup();
    const donationId = await pendingDonation(t, ids.verifiedFundraiser);
    await complete(t, donationId);
    await settle(t);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a donation that failed or is still pending", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg);
    const failed = await pendingDonation(t, ids.verifiedFundraiser);
    await t.mutation(internal.donations.markDonationFailed, {
      donationId: failed,
      status: "FAILED",
    });
    const pending = await pendingDonation(t, ids.verifiedFundraiser);
    await t.mutation(internal.webhookDelivery.enqueueDonationCompleted, {
      donationId: pending,
    });
    await settle(t);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recording the payment does not depend on the webhook succeeding", async () => {
    const { t, ids } = await setup();
    await addEndpoint(t, ids.verifiedOrg);
    fetchMock.mockImplementation(async () => {
      throw new TypeError("receiver is down");
    });
    const donationId = await pendingDonation(t, ids.verifiedFundraiser);
    await complete(t, donationId);
    await settle(t);

    const { donation, fundraiser } = await t.run(async (ctx) => ({
      donation: await ctx.db.get(donationId),
      fundraiser: await ctx.db.get(ids.verifiedFundraiser),
    }));
    expect(donation?.status).toBe("COMPLETED");
    expect(fundraiser?.amountRaised).toBe(1000);
    expect(fundraiser?.donorCount).toBe(1);
  });
});

// ============================================================ delivery

describe("delivery", () => {
  async function queued(over: { isActive?: boolean } = {}) {
    const world = await setup();
    const endpointId = await addEndpoint(world.t, world.ids.verifiedOrg, over);
    const deliveryId = await world.t.run((ctx) =>
      ctx.db.insert("webhookDeliveries", {
        endpointId,
        organizationId: world.ids.verifiedOrg,
        eventId: "evt_test_1",
        eventType: "ping",
        payload: '{"id":"evt_test_1","type":"ping"}',
        status: "PENDING",
        attempts: 0,
        createdAt: Date.now(),
      }),
    );
    return { ...world, endpointId, deliveryId };
  }
  const row = (t: T, id: Id<"webhookDeliveries">) =>
    t.run((ctx) => ctx.db.get(id));

  it("posts the stored body with a signature the receiver can verify", async () => {
    const { t, deliveryId } = await queued();
    await t.action(internal.webhookDelivery.deliver, { deliveryId });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_A);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeDefined();
    expect(init.body).toBe('{"id":"evt_test_1","type":"ping"}');
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "GoUplift-Event-Id": "evt_test_1",
      "GoUplift-Event-Type": "ping",
    });
    expect(
      await verifySignatureHeader(
        SECRET,
        init.headers["GoUplift-Signature"],
        init.body,
        Math.floor(Date.now() / 1000),
      ),
    ).toBe(true);

    const after = await row(t, deliveryId);
    expect(after).toMatchObject({ status: "SUCCEEDED", attempts: 1, lastStatusCode: 200 });
    expect(after?.deliveredAt).toBeTypeOf("number");
  });

  it.each([200, 201, 202, 204, 299])("%i counts as delivered", async (status) => {
    const { t, deliveryId } = await queued();
    fetchMock.mockImplementation(async () => reply(status));
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    expect((await row(t, deliveryId))?.status).toBe("SUCCEEDED");
  });

  it.each([199, 300, 301, 302, 400, 401, 404, 410, 429, 500, 503])(
    "%i counts as a failed attempt and is retried",
    async (status) => {
      const { t, deliveryId } = await queued();
      fetchMock.mockImplementation(async () => reply(status));
      await t.action(internal.webhookDelivery.deliver, { deliveryId });
      expect(await row(t, deliveryId)).toMatchObject({
        status: "RETRYING",
        attempts: 1,
        lastStatusCode: status,
        lastError: "http_error",
      });
    },
  );

  it("treats a connection failure as a retryable network error", async () => {
    const { t, deliveryId } = await queued();
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    expect(await row(t, deliveryId)).toMatchObject({
      status: "RETRYING",
      lastError: "network_error",
    });
  });

  it("backs off on the documented schedule, then gives up", async () => {
    const { t, deliveryId } = await queued();
    fetchMock.mockImplementation(async () => reply(500));
    await settle(t);
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    await settle(t);

    expect(fetchMock).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
    expect(await row(t, deliveryId)).toMatchObject({
      status: "FAILED",
      attempts: MAX_DELIVERY_ATTEMPTS,
      lastError: "http_error",
      lastStatusCode: 500,
    });
    expect((await row(t, deliveryId))?.nextAttemptAt).toBeUndefined();

    // Same event and body every time; each attempt signed at its own time,
    // spaced by exactly the configured delays.
    const calls = fetchMock.mock.calls.map(([, init]) => init);
    expect(new Set(calls.map((c) => c.body)).size).toBe(1);
    expect(new Set(calls.map((c) => c.headers["GoUplift-Event-Id"])).size).toBe(1);
    const stamps = calls.map((c) =>
      Number(/t=(\d+)/.exec(c.headers["GoUplift-Signature"])![1]),
    );
    const gaps = stamps.slice(1).map((s, i) => s - stamps[i]);
    expect(gaps).toEqual(RETRY_DELAYS_MS.map((ms) => ms / 1000));
  });

  it("stops retrying as soon as one attempt succeeds", async () => {
    const { t, deliveryId } = await queued();
    fetchMock
      .mockImplementationOnce(async () => reply(503))
      .mockImplementationOnce(async () => reply(500))
      .mockImplementation(async () => reply(200));
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    await settle(t);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await row(t, deliveryId)).toMatchObject({
      status: "SUCCEEDED",
      attempts: 3,
      lastStatusCode: 200,
    });
    expect((await row(t, deliveryId))?.lastError).toBeUndefined();
  });

  it("records the next attempt time when it schedules a retry", async () => {
    const { t, deliveryId } = await queued();
    fetchMock.mockImplementation(async () => reply(500));
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    const first = await row(t, deliveryId);
    expect(first!.nextAttemptAt! - first!.lastAttemptAt!).toBe(RETRY_DELAYS_MS[0]);
  });

  it("does not send to an endpoint paused after the event was queued", async () => {
    const { t, deliveryId } = await queued({ isActive: false });
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await row(t, deliveryId)).toMatchObject({
      status: "FAILED",
      lastError: "endpoint_disabled",
    });
  });

  it("does nothing when the endpoint has been deleted", async () => {
    const { t, deliveryId, endpointId } = await queued();
    await t.run((ctx) => ctx.db.delete(endpointId));
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["SUCCEEDED", "FAILED"] as const)("never re-sends a %s delivery", async (status) => {
    const { t, deliveryId } = await queued();
    await t.run((ctx) => ctx.db.patch(deliveryId, { status }));
    await t.action(internal.webhookDelivery.deliver, { deliveryId });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an attempt that outlives the timeout is cut off and counted as a timeout", async () => {
    // Signing is real async work, so wait until fetch has actually been called
    // (the timeout timer is started just before it) before moving the clock.
    let fetchCalled!: () => void;
    const started = new Promise<void>((resolve) => (fetchCalled = resolve));
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) => {
        fetchCalled();
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
    );
    const pending = sendWebhook(
      { url: URL_A, secret: SECRET, payload: "{}", eventId: "e", eventType: "ping" },
      Date.now(),
    );
    await started;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(vi.getTimerCount()).toBe(1); // still waiting
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "failure", error: "timeout" });
  });

  it("clears its timeout timer when the request finishes", async () => {
    await sendWebhook(
      { url: URL_A, secret: SECRET, payload: "{}", eventId: "e", eventType: "ping" },
      Date.now(),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ================================================== management: who may do what

describe("management is owner-only", () => {
  it("lists endpoints for the owner, without the secret", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    const list = await asOwner.query(api.webhooks.listEndpoints, {
      organizationId: ids.verifiedOrg,
    });
    expect(list).toHaveLength(1);
    expect(list![0]).toMatchObject({ _id: endpointId, url: URL_A, isActive: true });
    expect(Object.keys(list![0]).sort()).toEqual(["_id", "createdAt", "isActive", "url"]);
    expect(JSON.stringify(list)).not.toContain(SECRET);
  });

  it.each(["asAdmin", "asMember", "asStranger", "asOtherOwner"] as const)(
    "%s gets nothing from the lists",
    async (who) => {
      const world = await setup();
      const endpointId = await addEndpoint(world.t, world.ids.verifiedOrg);
      expect(
        await world[who].query(api.webhooks.listEndpoints, {
          organizationId: world.ids.verifiedOrg,
        }),
      ).toBeNull();
      expect(await world[who].query(api.webhooks.listDeliveries, { endpointId })).toBeNull();
    },
  );

  it("signed-out callers get nothing from the lists", async () => {
    const { t, ids } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    expect(await t.query(api.webhooks.listEndpoints, { organizationId: ids.verifiedOrg })).toBeNull();
    expect(await t.query(api.webhooks.listDeliveries, { endpointId })).toBeNull();
  });

  const NOT_OWNER = /Only the organization's owner/;

  it.each(["asAdmin", "asMember", "asStranger", "asOtherOwner"] as const)(
    "%s cannot create, change, test or delete anything",
    async (who) => {
      const world = await setup();
      const { t, ids } = world;
      const endpointId = await addEndpoint(t, ids.verifiedOrg);
      const deliveryId = await t.run((ctx) =>
        ctx.db.insert("webhookDeliveries", {
          endpointId,
          organizationId: ids.verifiedOrg,
          eventId: "evt_x",
          eventType: "ping",
          payload: "{}",
          status: "FAILED",
          attempts: 7,
          createdAt: Date.now(),
        }),
      );
      const me = world[who];

      await expect(
        me.action(api.webhooks.createEndpoint, { organizationId: ids.verifiedOrg, url: URL_B }),
      ).rejects.toThrow(NOT_OWNER);
      await expect(me.action(api.webhooks.rollSecret, { endpointId })).rejects.toThrow(NOT_OWNER);
      await expect(
        me.mutation(api.webhooks.setEndpointActive, { endpointId, isActive: false }),
      ).rejects.toThrow(NOT_OWNER);
      await expect(me.mutation(api.webhooks.sendTestEvent, { endpointId })).rejects.toThrow(NOT_OWNER);
      await expect(me.mutation(api.webhooks.resendDelivery, { deliveryId })).rejects.toThrow(NOT_OWNER);
      await expect(me.mutation(api.webhooks.deleteEndpoint, { endpointId })).rejects.toThrow(NOT_OWNER);

      // ...and nothing changed.
      const after = await t.run((ctx) => ctx.db.get(endpointId));
      expect(after).toMatchObject({ url: URL_A, secret: SECRET, isActive: true });
      expect((await t.run((ctx) => ctx.db.get(deliveryId)))?.status).toBe("FAILED");
      expect(await t.run((ctx) => ctx.db.query("webhookEndpoints").collect())).toHaveLength(1);
    },
  );

  it("signed-out callers cannot do anything either", async () => {
    const { t, ids } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    await expect(
      t.action(api.webhooks.createEndpoint, { organizationId: ids.verifiedOrg, url: URL_B }),
    ).rejects.toThrow(NOT_OWNER);
    await expect(t.action(api.webhooks.rollSecret, { endpointId })).rejects.toThrow(NOT_OWNER);
    await expect(t.mutation(api.webhooks.deleteEndpoint, { endpointId })).rejects.toThrow(NOT_OWNER);
  });

  it("a missing endpoint looks the same as one you don't own", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    await t.run((ctx) => ctx.db.delete(endpointId));
    await expect(asOwner.action(api.webhooks.rollSecret, { endpointId })).rejects.toThrow(NOT_OWNER);
    await expect(asOwner.mutation(api.webhooks.deleteEndpoint, { endpointId })).rejects.toThrow(NOT_OWNER);
  });

  it("an owner of another organization cannot touch this one's endpoint, and vice versa", async () => {
    const { t, ids, asOwner, asOtherOwner } = await setup();
    const mine = await addEndpoint(t, ids.verifiedOrg);
    const theirs = await addEndpoint(t, ids.otherOrg, { url: "https://other.example.org/x" });
    await expect(asOtherOwner.mutation(api.webhooks.deleteEndpoint, { endpointId: mine })).rejects.toThrow(NOT_OWNER);
    await expect(asOwner.mutation(api.webhooks.deleteEndpoint, { endpointId: theirs })).rejects.toThrow(NOT_OWNER);
    expect(await t.run((ctx) => ctx.db.query("webhookEndpoints").collect())).toHaveLength(2);
  });
});

describe("creating and rolling endpoints", () => {
  it("gives the owner a secret once and stores the URL normalised", async () => {
    const { t, ids, asOwner } = await setup();
    const { endpointId, secret } = await asOwner.action(api.webhooks.createEndpoint, {
      organizationId: ids.verifiedOrg,
      url: "  https://HOOKS.example.org:443/a  ",
    });
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const stored = await t.run((ctx) => ctx.db.get(endpointId));
    expect(stored).toMatchObject({
      url: "https://hooks.example.org/a",
      secret,
      isActive: true,
      organizationId: ids.verifiedOrg,
    });

    const listed = await asOwner.query(api.webhooks.listEndpoints, {
      organizationId: ids.verifiedOrg,
    });
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("refuses unsafe or invalid URLs on the server, with a message that says why", async () => {
    const { t, ids, asOwner } = await setup();
    const cases: [string, RegExp][] = [
      ["http://hooks.example.org/a", /must start with https/],
      ["https://127.0.0.1/a", /domain name, not an IP/],
      ["https://169.254.169.254/latest", /domain name, not an IP/],
      ["https://localhost/a", /public domain name/],
      ["https://intranet.internal/a", /private network/],
      ["https://user:pw@hooks.example.org/a", /username and password/],
      ["https://hooks.example.org:8443/a", /standard HTTPS port/],
      ["not a url", /valid URL/],
    ];
    for (const [url, why] of cases) {
      await expect(
        asOwner.action(api.webhooks.createEndpoint, { organizationId: ids.verifiedOrg, url }),
      ).rejects.toThrow(why);
    }
    expect(await t.run((ctx) => ctx.db.query("webhookEndpoints").collect())).toHaveLength(0);
  });

  it("is only available to verified organizations", async () => {
    const { t, ids, asOwner } = await setup();
    await expect(
      asOwner.action(api.webhooks.createEndpoint, { organizationId: ids.pendingOrg, url: URL_A }),
    ).rejects.toThrow(/verified/);
    expect(await t.run((ctx) => ctx.db.query("webhookEndpoints").collect())).toHaveLength(0);
  });

  it("caps endpoints per organization and refuses a duplicate URL", async () => {
    const { t, ids, asOwner } = await setup();
    for (let i = 0; i < MAX_WEBHOOK_ENDPOINTS; i++) {
      await asOwner.action(api.webhooks.createEndpoint, {
        organizationId: ids.verifiedOrg,
        url: `https://hooks.example.org/${i}`,
      });
    }
    await expect(
      asOwner.action(api.webhooks.createEndpoint, {
        organizationId: ids.verifiedOrg,
        url: "https://hooks.example.org/extra",
      }),
    ).rejects.toThrow(/up to 5/);

    // another organization has its own allowance
    expect(
      await t.run((ctx) => ctx.db.query("webhookEndpoints").collect()),
    ).toHaveLength(MAX_WEBHOOK_ENDPOINTS);

    const world = await setup();
    await world.asOwner.action(api.webhooks.createEndpoint, { organizationId: world.ids.verifiedOrg, url: URL_A });
    await expect(
      world.asOwner.action(api.webhooks.createEndpoint, { organizationId: world.ids.verifiedOrg, url: URL_A }),
    ).rejects.toThrow(/already registered/);
  });

  it("rolling replaces the secret immediately", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    const { secret } = await asOwner.action(api.webhooks.rollSecret, { endpointId });
    expect(secret).toMatch(/^whsec_/);
    expect(secret).not.toBe(SECRET);
    expect((await t.run((ctx) => ctx.db.get(endpointId)))?.secret).toBe(secret);
  });
});

describe("managing endpoints", () => {
  it("pauses and resumes; a paused endpoint stops receiving events", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    await asOwner.mutation(api.webhooks.setEndpointActive, { endpointId, isActive: false });
    const donationId = await pendingDonation(t, ids.verifiedFundraiser);
    await complete(t, donationId);
    await settle(t);
    expect(fetchMock).not.toHaveBeenCalled();

    await asOwner.mutation(api.webhooks.setEndpointActive, { endpointId, isActive: true });
    const second = await pendingDonation(t, ids.verifiedFundraiser);
    await complete(t, second);
    await settle(t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deleting removes the endpoint and its whole log, and nothing else", async () => {
    const { t, ids, asOwner } = await setup();
    const doomed = await addEndpoint(t, ids.verifiedOrg, { url: URL_A });
    const kept = await addEndpoint(t, ids.verifiedOrg, { url: URL_B });
    await t.run(async (ctx) => {
      const add = (endpointId: Id<"webhookEndpoints">, n: number) =>
        ctx.db.insert("webhookDeliveries", {
          endpointId,
          organizationId: ids.verifiedOrg,
          eventId: `evt_${n}`,
          eventType: "ping",
          payload: "{}",
          status: "SUCCEEDED",
          attempts: 1,
          createdAt: Date.now(),
        });
      for (let i = 0; i < 250; i++) await add(doomed, i); // more than one purge batch
      for (let i = 0; i < 3; i++) await add(kept, i);
    });

    await asOwner.mutation(api.webhooks.deleteEndpoint, { endpointId: doomed });
    await settle(t);

    expect(await t.run((ctx) => ctx.db.get(doomed))).toBeNull();
    const left = await allDeliveries(t);
    expect(left).toHaveLength(3);
    expect(left.every((d) => d.endpointId === kept)).toBe(true);
  });

  it("test events: delivered as a ping, rate limited, refused while paused", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);

    await asOwner.mutation(api.webhooks.sendTestEvent, { endpointId });
    await settle(t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBodies()[0]).toMatchObject({ type: "ping", data: { message: expect.any(String) } });

    await expect(asOwner.mutation(api.webhooks.sendTestEvent, { endpointId })).rejects.toThrow(/Wait a few seconds/);
    vi.advanceTimersByTime(10_000);
    await asOwner.mutation(api.webhooks.sendTestEvent, { endpointId });
    await settle(t);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBodies()[0].id).not.toBe(sentBodies()[1].id);

    await asOwner.mutation(api.webhooks.setEndpointActive, { endpointId, isActive: false });
    vi.advanceTimersByTime(10_000);
    await expect(asOwner.mutation(api.webhooks.sendTestEvent, { endpointId })).rejects.toThrow(/Resume/);
  });

  it("resend works for a failed delivery only", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    const make = (status: "FAILED" | "SUCCEEDED" | "RETRYING") =>
      t.run((ctx) =>
        ctx.db.insert("webhookDeliveries", {
          endpointId,
          organizationId: ids.verifiedOrg,
          eventId: `evt_${status}`,
          eventType: "ping",
          payload: '{"id":"x"}',
          status,
          attempts: 7,
          lastError: "http_error",
          lastStatusCode: 500,
          createdAt: Date.now(),
        }),
      );
    const failed = await make("FAILED");
    const done = await make("SUCCEEDED");
    const retrying = await make("RETRYING");

    await expect(asOwner.mutation(api.webhooks.resendDelivery, { deliveryId: done })).rejects.toThrow(/Only a failed/);
    await expect(asOwner.mutation(api.webhooks.resendDelivery, { deliveryId: retrying })).rejects.toThrow(/Only a failed/);

    await asOwner.mutation(api.webhooks.resendDelivery, { deliveryId: failed });
    await settle(t);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await t.run((ctx) => ctx.db.get(failed))).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
  });

  it("the delivery log is newest first, capped, and carries no payload", async () => {
    const { t, ids, asOwner } = await setup();
    const endpointId = await addEndpoint(t, ids.verifiedOrg);
    await t.run(async (ctx) => {
      for (let i = 0; i < 30; i++) {
        await ctx.db.insert("webhookDeliveries", {
          endpointId,
          organizationId: ids.verifiedOrg,
          eventId: `evt_${i}`,
          eventType: "donation.completed",
          payload: '{"data":{"donation":{"donorName":"Amina Wanjiru"}}}',
          status: "SUCCEEDED",
          attempts: 1,
          createdAt: 1000 + i,
        });
      }
    });
    const log = await asOwner.query(api.webhooks.listDeliveries, { endpointId });
    expect(log).toHaveLength(25);
    expect(log![0].eventId).toBe("evt_29");
    expect(log![24].eventId).toBe("evt_5");
    expect(JSON.stringify(log)).not.toContain("Amina");
    expect(Object.keys(log![0])).not.toContain("payload");
  });
});
