import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  MAX_DELIVERY_ATTEMPTS,
  MAX_WEBHOOK_ENDPOINTS,
  RETRY_DELAYS_MS,
} from "./lib/webhookConfig";
import {
  buildDonationCompletedEvent,
  buildDonationRefundedEvent,
} from "./lib/webhookPayloads";
import { queueDelivery } from "./lib/webhookQueue";
import { sendWebhook, type SendOutcome } from "./lib/webhookSend";
import {
  webhookErrorValidator,
  type WebhookDeliveryStatus,
} from "./lib/webhookValidators";

// Everything that moves an event from "something happened" to "the
// organization's server has it". The management side (creating endpoints,
// reading the log) lives in webhooks.ts.

const PURGE_BATCH = 100;

// Called, through the scheduler, by the three places that mark a donation
// completed. Scheduling it (instead of calling it inline) means:
//  - it only runs if the donation really did commit as completed, and
//  - a problem in here can never undo or delay recording a payment.
export const enqueueDonationCompleted = internalMutation({
  args: { donationId: v.id("donations") },
  handler: async (ctx, args): Promise<null> => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation || donation.status !== "COMPLETED") return null;

    await enqueueForOrganization(ctx, donation, (organizationId, createdAt) =>
      buildDonationCompletedEvent({ donation, organizationId, createdAt }),
    );
    return null;
  },
});

// The same, for a donation that was refunded or reversed. Scheduled by
// convex/lib/refunds.ts, so a webhook problem can never undo a refund.
export const enqueueDonationRefunded = internalMutation({
  args: { donationId: v.id("donations") },
  handler: async (ctx, args): Promise<null> => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation || donation.status !== "REFUNDED") return null;

    await enqueueForOrganization(ctx, donation, (organizationId, createdAt) =>
      buildDonationRefundedEvent({ donation, organizationId, createdAt }),
    );
    return null;
  },
});

// Queues one event to every active endpoint of the fundraiser's organization,
// when it has a verified one. Nothing happens for a personal fundraiser.
async function enqueueForOrganization(
  ctx: MutationCtx,
  donation: Doc<"donations">,
  build: (
    organizationId: Doc<"organizations">["_id"],
    createdAt: number,
  ) => { id: string; type: Doc<"webhookDeliveries">["eventType"] },
) {
  const fundraiser = await ctx.db.get(donation.fundraiserId);
  if (!fundraiser?.organizationId) return;

  const organization = await ctx.db.get(fundraiser.organizationId);
  if (!organization || organization.verificationStatus !== "VERIFIED") return;

  const endpoints = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organization._id),
    )
    .take(MAX_WEBHOOK_ENDPOINTS);
  const active = endpoints.filter((endpoint) => endpoint.isActive);
  if (active.length === 0) return;

  const now = Date.now();
  const event = build(organization._id, now);
  const payload = JSON.stringify(event);

  for (const endpoint of active) {
    await queueDelivery(ctx, {
      endpoint,
      eventId: event.id,
      eventType: event.type,
      payload,
      now,
    });
  }
}

type DeliveryJob = {
  status: WebhookDeliveryStatus;
  eventId: string;
  eventType: string;
  payload: string;
  url: string;
  secret: string;
  isActive: boolean;
};

// The one place a signing secret is read for sending. Internal, so it can't
// be called from a browser.
export const getDeliveryJob = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args): Promise<DeliveryJob | null> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return null;

    // The endpoint was deleted after this was queued: nothing left to send to.
    const endpoint = await ctx.db.get(delivery.endpointId);
    if (!endpoint) return null;

    return {
      status: delivery.status,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      payload: delivery.payload,
      url: endpoint.url,
      secret: endpoint.secret,
      isActive: endpoint.isActive,
    };
  },
});

const outcomeValidator = v.union(
  v.object({ kind: v.literal("success"), statusCode: v.number() }),
  v.object({
    kind: v.literal("failure"),
    error: webhookErrorValidator,
    statusCode: v.optional(v.number()),
  }),
);

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const job: DeliveryJob | null = await ctx.runQuery(
      internal.webhookDelivery.getDeliveryJob,
      { deliveryId: args.deliveryId },
    );
    if (!job) return null;
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return null;

    // Paused after this was queued: stop here rather than keep retrying.
    const outcome: SendOutcome = job.isActive
      ? await sendWebhook(job, Date.now())
      : { kind: "failure", error: "endpoint_disabled" };

    await ctx.runMutation(internal.webhookDelivery.recordAttempt, {
      deliveryId: args.deliveryId,
      outcome,
    });
    return null;
  },
});

export const recordAttempt = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), outcome: outcomeValidator },
  handler: async (ctx, args): Promise<null> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return null;
    if (delivery.status === "SUCCEEDED" || delivery.status === "FAILED") {
      return null;
    }

    const now = Date.now();
    const attempts = delivery.attempts + 1;
    const { outcome } = args;

    if (outcome.kind === "success") {
      await ctx.db.patch(args.deliveryId, {
        status: "SUCCEEDED",
        attempts,
        lastAttemptAt: now,
        deliveredAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: undefined,
        nextAttemptAt: undefined,
      });
      return null;
    }

    const giveUp =
      outcome.error === "endpoint_disabled" || attempts >= MAX_DELIVERY_ATTEMPTS;
    if (giveUp) {
      await ctx.db.patch(args.deliveryId, {
        status: "FAILED",
        attempts,
        lastAttemptAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error,
        nextAttemptAt: undefined,
      });
      return null;
    }

    const delay = RETRY_DELAYS_MS[attempts - 1];
    await ctx.db.patch(args.deliveryId, {
      status: "RETRYING",
      attempts,
      lastAttemptAt: now,
      lastStatusCode: outcome.statusCode,
      lastError: outcome.error,
      nextAttemptAt: now + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.webhookDelivery.deliver, {
      deliveryId: args.deliveryId,
    });
    return null;
  },
});

// Clears the log of a deleted endpoint a batch at a time, so a long history
// can't run into a single transaction's limits.
export const purgeDeliveries = internalMutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<null> => {
    const batch = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_endpointId", (q) => q.eq("endpointId", args.endpointId))
      .take(PURGE_BATCH);

    for (const delivery of batch) {
      await ctx.db.delete(delivery._id);
    }

    if (batch.length === PURGE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.purgeDeliveries, {
        endpointId: args.endpointId,
      });
    }
    return null;
  },
});
