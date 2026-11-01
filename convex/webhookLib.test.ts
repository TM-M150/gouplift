// The webhook building blocks that need no database: URL validation, request
// signing and the event payloads (including what they must never contain).
// convex/webhooks.test.ts covers the functions that use them.
import { describe, expect, it } from "vitest";
import { checkWebhookUrl } from "../lib/validations/webhook";
import {
  buildSignatureHeader,
  generateWebhookSecret,
  verifySignatureHeader,
} from "./lib/webhookSignature";
import {
  buildDonationCompletedEvent,
  buildPingEvent,
} from "./lib/webhookPayloads";
import type { Doc, Id } from "./_generated/dataModel";

describe("webhook URL validation", () => {
  it.each([
    "https://hooks.example.org/gouplift",
    "https://example.com",
    "https://api.partner.co.ke/v1/webhooks?token=abc123",
    "  https://example.com/padded  ",
    "https://EXAMPLE.com/Upper",
    "https://example.com:443/explicit-default-port",
  ])("accepts %s", (url) => {
    expect(checkWebhookUrl(url).ok).toBe(true);
  });

  it.each([
    ["http (not https)", "http://example.com/hook"],
    ["ftp", "ftp://example.com/hook"],
    ["javascript:", "javascript:alert(1)"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["no scheme", "example.com/hook"],
    ["garbage", "not a url"],
    ["IPv4 literal", "https://203.0.113.9/hook"],
    ["loopback IPv4", "https://127.0.0.1/hook"],
    ["cloud metadata address", "https://169.254.169.254/latest/meta-data"],
    ["decimal-encoded loopback", "https://2130706433/hook"],
    ["hex-encoded loopback", "https://0x7f.0.0.1/hook"],
    ["octal-encoded loopback", "https://0177.0.0.1/hook"],
    ["short-form loopback", "https://127.1/hook"],
    ["IPv6 loopback", "https://[::1]/hook"],
    ["IPv4-mapped IPv6", "https://[::ffff:127.0.0.1]/hook"],
    ["localhost", "https://localhost/hook"],
    ["localhost with trailing dot", "https://localhost./hook"],
    ["subdomain of localhost", "https://app.localhost/hook"],
    ["single-label intranet name", "https://intranet/hook"],
    [".internal", "https://metadata.google.internal/computeMetadata"],
    [".local", "https://printer.local/hook"],
    [".lan", "https://nas.lan/hook"],
    ["credentials in URL", "https://user:pass@example.com/hook"],
    ["username only", "https://user@example.com/hook"],
    ["custom port", "https://example.com:8443/hook"],
    ["port 80 on https", "https://example.com:80/hook"],
    ["too long", "https://example.com/" + "a".repeat(2100)],
  ])("rejects %s", (_name, url) => {
    const result = checkWebhookUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(5);
  });

  it("returns a normalised URL", () => {
    const result = checkWebhookUrl("  https://EXAMPLE.com:443/Path?q=1  ");
    expect(result).toEqual({ ok: true, url: "https://example.com/Path?q=1" });
  });
});

describe("webhook signatures", () => {
  // Computed independently with Python's hmac and `openssl dgst -hmac`.
  const SECRET = "whsec_test_secret";
  const T = 1700000000;
  const BODY = '{"id":"evt_1","type":"ping"}';
  const EXPECTED =
    "74a11abdd08483d064a2a1571e7881b084c522f9f3ccd0b800ec8c74aba47fc2";

  it("matches a known answer computed outside this code", async () => {
    expect(await buildSignatureHeader(SECRET, T, BODY)).toBe(
      `t=${T},v1=${EXPECTED}`,
    );
  });

  it("verifies what it signs", async () => {
    const header = await buildSignatureHeader(SECRET, T, BODY);
    expect(await verifySignatureHeader(SECRET, header, BODY, T + 5)).toBe(true);
  });

  it("rejects a changed body, wrong secret, or altered signature", async () => {
    const header = await buildSignatureHeader(SECRET, T, BODY);
    expect(await verifySignatureHeader(SECRET, header, BODY + " ", T)).toBe(false);
    expect(await verifySignatureHeader("whsec_other", header, BODY, T)).toBe(false);
    const flipped = header.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(await verifySignatureHeader(SECRET, flipped, BODY, T)).toBe(false);
  });

  it("rejects replays outside the tolerance window, either direction", async () => {
    const header = await buildSignatureHeader(SECRET, T, BODY);
    expect(await verifySignatureHeader(SECRET, header, BODY, T + 300)).toBe(true);
    expect(await verifySignatureHeader(SECRET, header, BODY, T + 301)).toBe(false);
    expect(await verifySignatureHeader(SECRET, header, BODY, T - 301)).toBe(false);
  });

  it("binds the timestamp into the signature", async () => {
    // Same MAC, different claimed time: must not verify.
    const header = await buildSignatureHeader(SECRET, T, BODY);
    const forged = header.replace(`t=${T}`, `t=${T + 100}`);
    expect(await verifySignatureHeader(SECRET, forged, BODY, T + 100)).toBe(false);
  });

  it.each(["", "garbage", "t=abc,v1=00", `t=${T}`, "v1=00", "t=,v1="])(
    "rejects malformed header %j",
    async (header) => {
      expect(await verifySignatureHeader(SECRET, header, BODY, T)).toBe(false);
    },
  );

  it("accepts any matching v1 when several are present", async () => {
    const header = await buildSignatureHeader(SECRET, T, BODY);
    const withOld = `${header},v1=${"0".repeat(64)}`;
    expect(await verifySignatureHeader(SECRET, withOld, BODY, T)).toBe(true);
  });

  it("generates distinct, well-formed secrets", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

function donation(overrides: Partial<Doc<"donations">> = {}): Doc<"donations"> {
  return {
    _id: "don_1" as Id<"donations">,
    _creationTime: 1,
    fundraiserId: "fund_1" as Id<"fundraisers">,
    donorName: "Amina Wanjiru",
    donorEmail: "amina@private.example",
    donorPhone: "+254700111222",
    isAnonymous: false,
    grossAmount: 1000,
    currency: "KES",
    message: "God bless this work",
    platformFeeRate: 0.05,
    platformFeeAmount: 50,
    netAmount: 950,
    gatewayFeeAmount: 12,
    status: "COMPLETED",
    payoutStatus: "PENDING_PAYOUT",
    providerTransactionCode: "SECRETTX123",
    providerPayload: '{"raw":"gateway data"}',
    paypalOrderId: "PAYPAL-ORDER-ID",
    completedAt: 1_700_000_000_000,
    createdAt: 1_699_999_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  } as Doc<"donations">;
}
const ORG = "org_1" as Id<"organizations">;

describe("donation.completed payload", () => {
  const event = (d: Doc<"donations">) =>
    buildDonationCompletedEvent({ donation: d, organizationId: ORG, createdAt: 1_700_000_100_000 });

  it("has exactly the documented shape", () => {
    expect(event(donation())).toEqual({
      id: "evt_donation_completed_don_1",
      type: "donation.completed",
      createdAt: "2023-11-14T22:15:00.000Z",
      data: {
        donation: {
          id: "don_1",
          fundraiserId: "fund_1",
          organizationId: "org_1",
          amount: 1000,
          currency: "KES",
          source: "WEB",
          isAnonymous: false,
          donorName: "Amina Wanjiru",
          message: "God bless this work",
          completedAt: "2023-11-14T22:13:20.000Z",
        },
      },
    });
  });

  it("never carries email, phone, fees, gateway or payment identifiers", () => {
    const json = JSON.stringify(event(donation()));
    for (const secret of [
      "amina@private.example",
      "+254700111222",
      "SECRETTX123",
      "gateway data",
      "PAYPAL-ORDER-ID",
      "donorEmail",
      "donorPhone",
      "providerPayload",
      "platformFee",
      "netAmount",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("withholds an anonymous donor's name and message", () => {
    const json = JSON.stringify(event(donation({ isAnonymous: true })));
    expect(json).not.toContain("Amina");
    expect(json).not.toContain("God bless");
    const parsed = JSON.parse(json);
    expect(parsed.data.donation).toMatchObject({
      isAnonymous: true,
      donorName: null,
      message: null,
    });
  });

  it("reports what the donor paid: USD gifts in USD, SasaPay in KES", () => {
    const usd = event(
      donation({ originalAmount: 25, originalCurrency: "USD", grossAmount: 3250 }),
    ).data.donation;
    expect([usd.amount, usd.currency]).toEqual([25, "USD"]);
    const kes = event(donation()).data.donation;
    expect([kes.amount, kes.currency]).toEqual([1000, "KES"]);
  });

  it("uses null for missing optional fields and passes the real source", () => {
    const d = event(donation({ donorName: undefined, message: undefined, source: "EMBED" })).data.donation;
    expect(d).toMatchObject({ donorName: null, message: null, source: "EMBED" });
  });

  it("builds a ping with a fixed, harmless body", () => {
    expect(buildPingEvent({ eventId: "evt_ping_x", createdAt: 0 })).toEqual({
      id: "evt_ping_x",
      type: "ping",
      createdAt: "1970-01-01T00:00:00.000Z",
      data: { message: "This is a test event from GoUplift." },
    });
  });
});
