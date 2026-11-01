import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Puts one event on one endpoint's queue and starts delivery. Both real events
// and the owner's test pings go through here.
//
// The same event is never queued twice for the same endpoint, so enqueueing
// is safe to repeat (a retried callback, a double click).
export async function queueDelivery(
  ctx: MutationCtx,
  args: {
    endpoint: Doc<"webhookEndpoints">;
    eventId: string;
    eventType: Doc<"webhookDeliveries">["eventType"];
    payload: string;
    now: number;
  },
): Promise<Id<"webhookDeliveries"> | null> {
  const existing = await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_endpointId_and_eventId", (q) =>
      q.eq("endpointId", args.endpoint._id).eq("eventId", args.eventId),
    )
    .unique();
  if (existing) return null;

  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    endpointId: args.endpoint._id,
    organizationId: args.endpoint.organizationId,
    eventId: args.eventId,
    eventType: args.eventType,
    payload: args.payload,
    status: "PENDING",
    attempts: 0,
    createdAt: args.now,
  });

  await ctx.scheduler.runAfter(0, internal.webhookDelivery.deliver, {
    deliveryId,
  });
  return deliveryId;
}
