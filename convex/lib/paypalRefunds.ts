import type { Doc } from "../_generated/dataModel";

// Reads PayPal's refund and reversal notifications. Pure, so the odd shapes
// PayPal sends can be tested without a database.
//
// The four events, and what their `resource` is:
//   PAYMENT.CAPTURE.REFUNDED / PAYMENT.SALE.REFUNDED   the refund (its own id)
//   PAYMENT.CAPTURE.REVERSED / PAYMENT.SALE.REVERSED   a reversal: a dispute
//                                                      or chargeback that the
//                                                      seller lost
// A refund's id is not the payment's id, so the payment is found by every id
// the notification carries that could be one (see paymentIds).

export const PAYPAL_REFUND_EVENT_TYPES = [
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
] as const;
export type PayPalRefundEventType = (typeof PAYPAL_REFUND_EVENT_TYPES)[number];

export function isPayPalRefundEvent(
  eventType: string,
): eventType is PayPalRefundEventType {
  return (PAYPAL_REFUND_EVENT_TYPES as readonly string[]).includes(eventType);
}

export interface PayPalRefundResource {
  id?: string;
  sale_id?: string;
  capture_id?: string;
  // Capture events use value/currency_code, sale events total/currency.
  amount?: {
    value?: string;
    currency_code?: string;
    total?: string;
    currency?: string;
  };
  links?: Array<{ rel?: string; href?: string }>;
  supplementary_data?: {
    related_ids?: { order_id?: string; capture_id?: string };
  };
}

export interface ParsedPayPalRefund {
  kind: "REFUND" | "REVERSAL";
  /** Every id in the notification that might be the original payment's. */
  paymentIds: string[];
  /** The checkout order, which is how one-off donations are stored. */
  orderId: string | null;
  /** PayPal's id for the refund or reversal itself. */
  providerRefundId: string | null;
  /** What was refunded, in `currency`. Null when it isn't stated. */
  amount: number | null;
  currency: string | null;
}

const MAX_PAYMENT_IDS = 8;

function lastSegment(href: string | undefined): string | null {
  if (!href) return null;
  const path = href.split("?")[0].replace(/\/+$/, "");
  const segment = path.slice(path.lastIndexOf("/") + 1);
  return segment.length > 0 ? segment : null;
}

export function parsePayPalRefund(
  eventType: PayPalRefundEventType,
  resource: PayPalRefundResource | undefined,
): ParsedPayPalRefund {
  const kind = eventType.endsWith(".REVERSED") ? "REVERSAL" : "REFUND";
  const r = resource ?? {};

  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (typeof id === "string" && id.length > 0 && !ids.includes(id)) {
      ids.push(id);
    }
  };
  add(r.sale_id);
  add(r.capture_id);
  add(r.supplementary_data?.related_ids?.capture_id);
  // The "up" link of a refund points at the payment it refunds.
  for (const link of r.links ?? []) {
    if (link.rel === "up") add(lastSegment(link.href));
  }
  // On a reversal the resource can be the payment itself.
  if (kind === "REVERSAL") add(r.id);

  const rawAmount = r.amount?.value ?? r.amount?.total;
  const amount = rawAmount === undefined ? null : Number(rawAmount);

  return {
    kind,
    paymentIds: ids.slice(0, MAX_PAYMENT_IDS),
    orderId: r.supplementary_data?.related_ids?.order_id ?? null,
    providerRefundId: r.id ?? null,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    currency: (r.amount?.currency_code ?? r.amount?.currency ?? null)
      ?.toString()
      .toUpperCase() ?? null,
  };
}

/**
 * Whether PayPal gave back the whole payment. Only then is the donation
 * refunded: a partial refund would need the donation split, which GoUplift
 * doesn't do, so it is left alone and reported instead. Anything that can't
 * be confirmed to be the whole amount counts as not whole.
 */
export function refundCoversWholeDonation(
  donation: Pick<
    Doc<"donations">,
    "originalAmount" | "originalCurrency" | "grossAmount" | "currency"
  >,
  refund: Pick<ParsedPayPalRefund, "amount" | "currency">,
): boolean {
  if (refund.amount === null || refund.currency === null) return false;
  const paid = donation.originalAmount ?? donation.grossAmount;
  const paidCurrency = donation.originalCurrency ?? donation.currency;
  if (refund.currency !== paidCurrency) return false;
  // Half a cent of slack for how the amounts were rounded.
  return refund.amount >= paid - 0.005;
}
