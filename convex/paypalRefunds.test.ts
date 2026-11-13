import { describe, expect, it } from "vitest";
import {
  isPayPalRefundEvent,
  parsePayPalRefund,
  refundCoversWholeDonation,
} from "./lib/paypalRefunds";

// What PayPal actually sends for each of the four events (trimmed to the
// fields that matter), so the matching rules are tested against real shapes.

const captureRefunded = {
  id: "REFUND-9",
  amount: { value: "25.00", currency_code: "USD" },
  status: "COMPLETED",
  links: [
    {
      rel: "self",
      href: "https://api.paypal.com/v2/payments/refunds/REFUND-9",
    },
    {
      rel: "up",
      href: "https://api.paypal.com/v2/payments/captures/CAPTURE-1",
    },
  ],
  supplementary_data: { related_ids: { order_id: "ORDER-1" } },
};

const saleRefunded = {
  id: "REFUND-8",
  sale_id: "SALE-1",
  amount: { total: "10.00", currency: "USD" },
  links: [
    { rel: "self", href: "https://api.paypal.com/v1/payments/refund/REFUND-8" },
    { rel: "sale", href: "https://api.paypal.com/v1/payments/sale/SALE-1" },
  ],
};

describe("parsePayPalRefund", () => {
  it("reads a capture refund: the payment from its 'up' link, and the order", () => {
    expect(
      parsePayPalRefund("PAYMENT.CAPTURE.REFUNDED", captureRefunded),
    ).toEqual({
      kind: "REFUND",
      paymentIds: ["CAPTURE-1"],
      orderId: "ORDER-1",
      providerRefundId: "REFUND-9",
      amount: 25,
      currency: "USD",
    });
  });

  it("reads a sale refund, which names the sale and uses total/currency", () => {
    expect(parsePayPalRefund("PAYMENT.SALE.REFUNDED", saleRefunded)).toEqual({
      kind: "REFUND",
      paymentIds: ["SALE-1"],
      orderId: null,
      providerRefundId: "REFUND-8",
      amount: 10,
      currency: "USD",
    });
  });

  it("never treats a refund's own id as the payment", () => {
    const parsed = parsePayPalRefund(
      "PAYMENT.CAPTURE.REFUNDED",
      captureRefunded,
    );
    expect(parsed.paymentIds).not.toContain("REFUND-9");
  });

  it("on a reversal the resource itself can be the payment", () => {
    const parsed = parsePayPalRefund("PAYMENT.CAPTURE.REVERSED", {
      id: "CAPTURE-2",
      amount: { value: "5.00", currency_code: "usd" },
    });
    expect(parsed).toMatchObject({
      kind: "REVERSAL",
      paymentIds: ["CAPTURE-2"],
      currency: "USD",
    });
  });

  it("keeps each id once and ignores links without one", () => {
    const parsed = parsePayPalRefund("PAYMENT.SALE.REVERSED", {
      sale_id: "SALE-3",
      links: [
        { rel: "up", href: "https://api.paypal.com/v1/payments/sale/SALE-3/" },
        { rel: "up" },
      ],
    });
    expect(parsed.paymentIds).toEqual(["SALE-3"]);
  });

  it("reports an unstated or unreadable amount as null", () => {
    expect(parsePayPalRefund("PAYMENT.CAPTURE.REFUNDED", {}).amount).toBeNull();
    expect(
      parsePayPalRefund("PAYMENT.CAPTURE.REFUNDED", {
        amount: { value: "lots", currency_code: "USD" },
      }).amount,
    ).toBeNull();
    expect(
      parsePayPalRefund("PAYMENT.CAPTURE.REFUNDED", undefined),
    ).toMatchObject({
      paymentIds: [],
      orderId: null,
      amount: null,
      currency: null,
    });
  });
});

describe("isPayPalRefundEvent", () => {
  it("knows the four events and nothing else", () => {
    for (const type of [
      "PAYMENT.CAPTURE.REFUNDED",
      "PAYMENT.CAPTURE.REVERSED",
      "PAYMENT.SALE.REFUNDED",
      "PAYMENT.SALE.REVERSED",
    ]) {
      expect(isPayPalRefundEvent(type)).toBe(true);
    }
    for (const type of [
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.SALE.COMPLETED",
      "",
    ]) {
      expect(isPayPalRefundEvent(type)).toBe(false);
    }
  });
});

describe("refundCoversWholeDonation", () => {
  const usdDonation = {
    originalAmount: 25,
    originalCurrency: "USD" as const,
    grossAmount: 3250,
    currency: "KES" as const,
  };

  it("accepts the whole amount in the currency the donor paid", () => {
    expect(
      refundCoversWholeDonation(usdDonation, { amount: 25, currency: "USD" }),
    ).toBe(true);
  });

  it("allows for rounding to the cent, and a refund of more", () => {
    expect(
      refundCoversWholeDonation(usdDonation, {
        amount: 24.996,
        currency: "USD",
      }),
    ).toBe(true);
    expect(
      refundCoversWholeDonation(usdDonation, { amount: 25.5, currency: "USD" }),
    ).toBe(true);
  });

  it("refuses a partial refund", () => {
    expect(
      refundCoversWholeDonation(usdDonation, { amount: 10, currency: "USD" }),
    ).toBe(false);
  });

  it("refuses what can't be confirmed: another currency, or no amount", () => {
    expect(
      refundCoversWholeDonation(usdDonation, { amount: 3250, currency: "KES" }),
    ).toBe(false);
    expect(
      refundCoversWholeDonation(usdDonation, { amount: null, currency: "USD" }),
    ).toBe(false);
    expect(
      refundCoversWholeDonation(usdDonation, { amount: 25, currency: null }),
    ).toBe(false);
  });

  it("falls back to the KES amount when no original was recorded", () => {
    const kes = { grossAmount: 1000, currency: "KES" as const };
    expect(
      refundCoversWholeDonation(kes, { amount: 1000, currency: "KES" }),
    ).toBe(true);
    expect(
      refundCoversWholeDonation(kes, { amount: 1000, currency: "USD" }),
    ).toBe(false);
  });
});
