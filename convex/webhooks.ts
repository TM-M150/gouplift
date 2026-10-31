import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { checkWebhookUrl } from "../lib/validations/webhook";
import {
  NOT_ORGANIZATION_OWNER,
  getOwnerAccess,
  requireOwnerAccess,
} from "./lib/orgAccess";
import {
  DELIVERY_LOG_LIMIT,
  MAX_WEBHOOK_ENDPOINTS,
  TEST_EVENT_COOLDOWN_MS,
} from "./lib/webhookConfig";
import { buildPingEvent } from "./lib/webhookPayloads";
import { queueDelivery } from "./lib/webhookQueue";
import { generateWebhookSecret } from "./lib/webhookSignature";

// What an organization's owner can do with webhooks from the dashboard. Only
// OWNERs may: events carry donors' names and messages to a server we don't
// control, which is the organization's call to make, not any member's.
//
// A signing secret is shown exactly once, in the result of the call that makes
// it. Nothing here reads one back.

// Names the endpoint's organization, or null if there is no such endpoint.
export const getEndpointOrganization = internalQuery({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<Id<"organizations"> | null> => {
    const endpoint = await ctx.db.get(args.endpointId);
    return endpoint?.organizationId ?? null;
  },
});

// Actions have no database, so they ask a query who the caller is and what
// they own. Same answer for "not signed in", "not a member", "not the owner"
// and "no such thing", so none of those can be told apart from outside.
async function requireOwnerInAction(
  ctx: ActionCtx,
  organizationId: Id<"organizations">,
): Promise<Id<"users">> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) throw new ConvexError(NOT_ORGANIZATION_OWNER);

  const user = await ctx.runQuery(internal.organizations.getUserByAuthUserId, {
    authUserId: authUser._id,
  });
  if (!user) throw new ConvexError(NOT_ORGANIZATION_OWNER);

  const membership = await ctx.runQuery(
    internal.organizations.getMembershipInternal,
    { organizationId, userId: user._id },
  );
  if (membership?.role !== "OWNER") {
    throw new ConvexError(NOT_ORGANIZATION_OWNER);
  }
  return user._id;
}

async function requireOwnedEndpoint(
  ctx: MutationCtx,
  endpointId: Id<"webhookEndpoints">,
): Promise<Doc<"webhookEndpoints">> {
  const endpoint = await ctx.db.get(endpointId);
  if (!endpoint) throw new ConvexError(NOT_ORGANIZATION_OWNER);
  await requireOwnerAccess(ctx, endpoint.organizationId);
  return endpoint;
}

// ---------------------------------------------------------------- reading

export const listEndpoints = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    // null, not an error, for a non-owner: the page shows nothing instead of
    // crashing, and still learns nothing.
    if (!(await getOwnerAccess(ctx, args.organizationId))) return null;

    const endpoints = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .take(MAX_WEBHOOK_ENDPOINTS);

    // Listed field by field so the secret can't ride along.
    return endpoints.map((endpoint) => ({
      _id: endpoint._id,
      url: endpoint.url,
      isActive: endpoint.isActive,
      createdAt: endpoint.createdAt,
    }));
  },
});

export const listDeliveries = query({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args) => {
    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint) return null;
    if (!(await getOwnerAccess(ctx, endpoint.organizationId))) return null;

    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_endpointId", (q) => q.eq("endpointId", args.endpointId))
      .order("desc")
      .take(DELIVERY_LOG_LIMIT);

    // The payload is left out: it is only the event, which the organization
    // already receives, and the log doesn't need to carry it.
    return deliveries.map((delivery) => ({
      _id: delivery._id,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      status: delivery.status,
      attempts: delivery.attempts,
      lastStatusCode: delivery.lastStatusCode ?? null,
      lastError: delivery.lastError ?? null,
      nextAttemptAt: delivery.nextAttemptAt ?? null,
      deliveredAt: delivery.deliveredAt ?? null,
      createdAt: delivery.createdAt,
    }));
  },
});

// ------------------------------------------------------- creating / rolling

export const insertEndpoint = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    url: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"webhookEndpoints">> => {
    const checked = checkWebhookUrl(args.url);
    if (!checked.ok) throw new ConvexError(checked.message);

    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.verificationStatus !== "VERIFIED") {
      throw new ConvexError(
        "Webhooks are available once your organization is verified.",
      );
    }

    const existing = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .take(MAX_WEBHOOK_ENDPOINTS + 1);
    if (existing.length >= MAX_WEBHOOK_ENDPOINTS) {
      throw new ConvexError(
        `An organization can have up to ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints.`,
      );
    }
    if (existing.some((endpoint) => endpoint.url === checked.url)) {
      throw new ConvexError("This URL is already registered.");
    }

    const now = Date.now();
    return await ctx.db.insert("webhookEndpoints", {
      organizationId: args.organizationId,
      url: checked.url,
      secret: args.secret,
      isActive: true,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createEndpoint = action({
  args: { organizationId: v.id("organizations"), url: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ endpointId: Id<"webhookEndpoints">; secret: string }> => {
    const userId = await requireOwnerInAction(ctx, args.organizationId);

    // Made here, not in a mutation, so it comes from the platform's secure
    // random generator rather than a replayable one.
    const secret = generateWebhookSecret();
    const endpointId: Id<"webhookEndpoints"> = await ctx.runMutation(
      internal.webhooks.insertEndpoint,
      { organizationId: args.organizationId, userId, url: args.url, secret },
    );
    return { endpointId, secret };
  },
});

export const replaceSecret = internalMutation({
  args: { endpointId: v.id("webhookEndpoints"), secret: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.endpointId, {
      secret: args.secret,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// The old secret stops working straight away; there is no overlap period.
export const rollSecret = action({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<{ secret: string }> => {
    const organizationId: Id<"organizations"> | null = await ctx.runQuery(
      internal.webhooks.getEndpointOrganization,
      { endpointId: args.endpointId },
    );
    if (!organizationId) throw new ConvexError(NOT_ORGANIZATION_OWNER);
    await requireOwnerInAction(ctx, organizationId);

    const secret = generateWebhookSecret();
    await ctx.runMutation(internal.webhooks.replaceSecret, {
      endpointId: args.endpointId,
      secret,
    });
    return { secret };
  },
});

// --------------------------------------------------------------- managing

export const setEndpointActive = mutation({
  args: { endpointId: v.id("webhookEndpoints"), isActive: v.boolean() },
  handler: async (ctx, args): Promise<null> => {
    await requireOwnedEndpoint(ctx, args.endpointId);
    await ctx.db.patch(args.endpointId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteEndpoint = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<null> => {
    await requireOwnedEndpoint(ctx, args.endpointId);
    await ctx.db.delete(args.endpointId);
    await ctx.scheduler.runAfter(0, internal.webhookDelivery.purgeDeliveries, {
      endpointId: args.endpointId,
    });
    return null;
  },
});

export const sendTestEvent = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, args): Promise<null> => {
    const endpoint = await requireOwnedEndpoint(ctx, args.endpointId);
    if (!endpoint.isActive) {
      throw new ConvexError("Resume this endpoint before sending a test.");
    }

    const now = Date.now();
    const recent = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_endpointId", (q) => q.eq("endpointId", args.endpointId))
      .order("desc")
      .take(5);
    if (
      recent.some(
        (delivery) =>
          delivery.eventType === "ping" &&
          now - delivery.createdAt < TEST_EVENT_COOLDOWN_MS,
      )
    ) {
      throw new ConvexError("Wait a few seconds before sending another test.");
    }

    const event = buildPingEvent({
      eventId: `evt_ping_${crypto.randomUUID()}`,
      createdAt: now,
    });
    await queueDelivery(ctx, {
      endpoint,
      eventId: event.id,
      eventType: event.type,
      payload: JSON.stringify(event),
      now,
    });
    return null;
  },
});

// Only a delivery that has given up can be sent again; one still retrying
// already has an attempt scheduled and would otherwise be sent twice.
export const resendDelivery = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args): Promise<null> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) throw new ConvexError(NOT_ORGANIZATION_OWNER);
    const endpoint = await requireOwnedEndpoint(ctx, delivery.endpointId);

    if (delivery.status !== "FAILED") {
      throw new ConvexError("Only a failed delivery can be sent again.");
    }
    if (!endpoint.isActive) {
      throw new ConvexError("Resume this endpoint before sending again.");
    }

    await ctx.db.patch(args.deliveryId, {
      status: "PENDING",
      attempts: 0,
      lastError: undefined,
      lastStatusCode: undefined,
      lastAttemptAt: undefined,
      nextAttemptAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.webhookDelivery.deliver, {
      deliveryId: args.deliveryId,
    });
    return null;
  },
});
