export const MAX_WEBHOOK_ENDPOINTS = 5;

// A receiver that doesn't answer in this long counts as a failed attempt.
export const REQUEST_TIMEOUT_MS = 10_000;

// How long to wait before attempt 2, 3, ... The last retry lands about a day
// and a half after the event, which is enough to ride out a long outage
// without hammering a server that is down.
export const RETRY_DELAYS_MS = [
  30_000, // 30 seconds
  2 * 60_000, // 2 minutes
  10 * 60_000, // 10 minutes
  60 * 60_000, // 1 hour
  6 * 60 * 60_000, // 6 hours
  24 * 60 * 60_000, // 24 hours
];

export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

// Stops a held-down "Send test" button from becoming a request flood.
export const TEST_EVENT_COOLDOWN_MS = 10_000;

export const DELIVERY_LOG_LIMIT = 25;
