// What can go wrong with payments behind the scenes, and what to do about
// each. Shared by the backend (which records them) and the admin page (which
// shows them), so the words live in one place.
//
// An ERROR means money may have moved without the platform recording it, or
// that payments can't be recorded at all: staff are emailed. A WARNING is
// something to look at, often someone probing an address: it shows on the
// admin page and the Overview, and is not emailed.

export const SYSTEM_ALERT_KINDS = [
  "SASAPAY_NOT_CONFIGURED",
  "SASAPAY_CALLBACK_REJECTED",
  "SASAPAY_CALLBACK_FAILED",
  "SASAPAY_PAYMENT_UNMATCHED",
  "PAYPAL_NOT_CONFIGURED",
  "PAYPAL_WEBHOOK_REJECTED",
  "PAYPAL_WEBHOOK_FAILED",
  "PAYPAL_PAYMENT_UNMATCHED",
  "PAYPAL_REFUND_UNMATCHED",
] as const;

export type SystemAlertKind = (typeof SYSTEM_ALERT_KINDS)[number];
export type SystemAlertSeverity = "ERROR" | "WARNING";

export const SYSTEM_ALERTS: Record<
  SystemAlertKind,
  { severity: SystemAlertSeverity; title: string; help: string }
> = {
  SASAPAY_NOT_CONFIGURED: {
    severity: "ERROR",
    title: "SasaPay payment notifications can't be accepted",
    help: "SASAPAY_CALLBACK_SECRET isn't set on this deployment, so every notification from SasaPay is turned away and donations stay pending. Set it with `npx convex env set SASAPAY_CALLBACK_SECRET <value>`, using the same value as the token in the callback address you gave SasaPay.",
  },
  SASAPAY_CALLBACK_REJECTED: {
    severity: "WARNING",
    title: "A SasaPay notification was turned away",
    help: "Its token was missing or wrong. One now and then is probably someone probing the address. If donors are paying and donations stay pending, the token in the callback address given to SasaPay doesn't match SASAPAY_CALLBACK_SECRET.",
  },
  SASAPAY_CALLBACK_FAILED: {
    severity: "ERROR",
    title: "A SasaPay payment notification failed to process",
    help: "It arrived but couldn't be recorded, so a donor may have paid while the donation stays pending. Find the donation from the details, and check it in the SasaPay dashboard. SasaPay may send it again.",
  },
  SASAPAY_PAYMENT_UNMATCHED: {
    severity: "ERROR",
    title: "SasaPay reported a payment we have no donation for",
    help: "SasaPay says a payment succeeded, but no donation has that checkout request. The donor has paid and nothing was recorded. Look the transaction up in the SasaPay dashboard, then record the donation by hand or refund it.",
  },
  PAYPAL_NOT_CONFIGURED: {
    severity: "ERROR",
    title: "PayPal notifications can't be checked",
    help: "PAYPAL_WEBHOOK_ID isn't set on this deployment, so every PayPal notification (refunds, disputes, recurring payments) is turned away. Set it with `npx convex env set PAYPAL_WEBHOOK_ID <id>`, using the ID of the webhook in the PayPal developer dashboard.",
  },
  PAYPAL_WEBHOOK_REJECTED: {
    severity: "WARNING",
    title: "A PayPal notification failed its signature check",
    help: "It didn't come from PayPal, or PAYPAL_WEBHOOK_ID belongs to a different webhook from the one PayPal is sending to. One now and then is probably someone probing the address. If real notifications keep failing, compare the ID in the PayPal dashboard with PAYPAL_WEBHOOK_ID.",
  },
  PAYPAL_WEBHOOK_FAILED: {
    severity: "ERROR",
    title: "A PayPal notification failed to process",
    help: "It couldn't be checked or recorded: PayPal's checking service may have been down, or something broke while recording it. PayPal sends it again for a few days, so read the details and fix the cause.",
  },
  PAYPAL_PAYMENT_UNMATCHED: {
    severity: "ERROR",
    title: "PayPal took a recurring payment we have no subscription for",
    help: "The money reached PayPal but no donation was recorded, because the subscription isn't in our records. Find the sale in the PayPal dashboard.",
  },
  PAYPAL_REFUND_UNMATCHED: {
    severity: "WARNING",
    title: "PayPal refunded or reversed a payment we can't find",
    help: "A refund or dispute for a payment that isn't in our records. A refund can arrive just before its payment's own notification, and PayPal sends it again, so this often clears itself. If it keeps coming back, find the payment in PayPal.",
  },
};

export const SYSTEM_ALERT_DETAIL_MAX_LENGTH = 500;

/** Not another email about the same problem for this long. */
export const SYSTEM_ALERT_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * At most this many emails about one kind of problem in that time, however
 * many payments it touches. Each payment's problem is its own alert, but if
 * everything is failing, an inbox of fifty emails helps nobody.
 */
export const SYSTEM_ALERT_EMAILS_PER_KIND = 5;

/**
 * A problem that repeats faster than this is counted once. Callers can be
 * hit by anyone (a wrong token costs an attacker nothing), so a flood mustn't
 * become a flood of writes.
 */
export const SYSTEM_ALERT_THROTTLE_MS = 5_000;

/** Resolved alerts are kept this long, then deleted. */
export const SYSTEM_ALERT_KEEP_RESOLVED_MS = 90 * 24 * 60 * 60 * 1000;
