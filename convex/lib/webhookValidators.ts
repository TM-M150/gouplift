import { v } from "convex/values";

// What a webhook can be about. "ping" is the test event an owner sends from
// the dashboard; everything else is a real thing that happened.
export const webhookEventTypeValidator = v.union(
  v.literal("donation.completed"),
  v.literal("ping"),
);

//   PENDING   — queued, first attempt not made yet
//   RETRYING  — an attempt failed, another is scheduled
//   SUCCEEDED — the receiver answered with a 2xx
//   FAILED    — gave up (out of attempts, or the endpoint was paused)
export const webhookDeliveryStatusValidator = v.union(
  v.literal("PENDING"),
  v.literal("RETRYING"),
  v.literal("SUCCEEDED"),
  v.literal("FAILED"),
);

// Why an attempt failed. A fixed list on purpose: the receiving server's own
// response is never stored or shown, so a webhook URL can't be used to read
// back what is behind it.
export const webhookErrorValidator = v.union(
  v.literal("timeout"),
  v.literal("network_error"), // couldn't connect, TLS failed, or it redirected
  v.literal("http_error"), // answered, but not with a 2xx
  v.literal("endpoint_disabled"),
);

export type WebhookDeliveryStatus =
  typeof webhookDeliveryStatusValidator.type;
export type WebhookError = typeof webhookErrorValidator.type;
