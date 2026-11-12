import { describe, expect, it } from "vitest";
import {
  buildReceiptEmail,
  escapeHtml,
  formatReceiptDate,
  isPlausibleEmail,
  kes,
  type ReceiptData,
} from "./lib/receiptEmail";

const SITE = "https://gouplift.example";

// 12 Nov 2026, 05:49 in Nairobi.
const COMPLETED_AT = Date.UTC(2026, 10, 12, 2, 49);

const mobileMoney: ReceiptData = {
  donationId: "donation_123",
  donorName: "Wanjiru Kamau",
  isAnonymous: false,
  fundraiserId: "fundraiser_456",
  fundraiserTitle: "Water for Kajiado",
  grossAmount: 1000,
  platformFeeRate: 0.0425,
  platformFeeAmount: 42.5,
  netAmount: 957.5,
  originalCurrency: "KES",
  originalAmount: 1000,
  exchangeRate: null,
  provider: "SASAPAY",
  paymentMethod: "MPESA",
  reference: "TKB1234XYZ",
  isMonthly: false,
  completedAt: COMPLETED_AT,
};

const paypal: ReceiptData = {
  ...mobileMoney,
  grossAmount: 1300,
  platformFeeAmount: 55.25,
  netAmount: 1244.75,
  originalCurrency: "USD",
  originalAmount: 10,
  exchangeRate: 130,
  provider: "PAYPAL",
  paymentMethod: "PAYPAL",
  reference: "SALE-9",
};

const build = (overrides: Partial<ReceiptData> = {}) =>
  buildReceiptEmail({ ...mobileMoney, ...overrides }, SITE);

describe("formatReceiptDate", () => {
  it("shows Nairobi time", () => {
    expect(formatReceiptDate(COMPLETED_AT)).toBe("12 Nov 2026, 05:49 EAT");
  });

  it("rolls over to the next day and year when Nairobi is already there", () => {
    // 21:30 UTC on 31 Dec is 00:30 on 1 Jan in Kenya.
    expect(formatReceiptDate(Date.UTC(2026, 11, 31, 21, 30))).toBe(
      "1 Jan 2027, 00:30 EAT",
    );
  });

  it("pads minutes and hours", () => {
    expect(formatReceiptDate(Date.UTC(2026, 2, 5, 3, 5))).toBe(
      "5 Mar 2026, 06:05 EAT",
    );
  });
});

describe("kes", () => {
  it("groups thousands and drops empty decimals", () => {
    expect(kes(1300)).toBe("KES 1,300");
    expect(kes(1234567)).toBe("KES 1,234,567");
    expect(kes(5)).toBe("KES 5");
  });

  it("keeps real cents to two places", () => {
    expect(kes(957.5)).toBe("KES 957.50");
    expect(kes(1244.75)).toBe("KES 1,244.75");
    expect(kes(42.499999)).toBe("KES 42.50");
  });
});

describe("escapeHtml", () => {
  it("escapes every character that can open or close markup", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("isPlausibleEmail", () => {
  it.each(["a@b.co", "wanjiru.kamau+gift@mail.example.ke"])("accepts %s", (v) => {
    expect(isPlausibleEmail(v)).toBe(true);
  });

  it.each(["", "plain", "a@b", "a b@c.co", "<a>@b.co", "a@b@c.co", "@b.co"])(
    "rejects %j",
    (v) => {
      expect(isPlausibleEmail(v)).toBe(false);
    },
  );

  it("rejects an address longer than the standard allows", () => {
    expect(isPlausibleEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });
});

describe("a mobile money receipt", () => {
  const { subject, html, text } = build();

  it("puts the amount and the fundraiser in the subject", () => {
    expect(subject).toBe("Your GoUplift receipt: KES 1,000 to Water for Kajiado");
  });

  it("shows the whole money story: what was paid, the fee, what the fundraiser gets", () => {
    for (const part of [
      "12 Nov 2026, 05:49 EAT",
      "KES 1,000",
      "M-Pesa",
      "TKB1234XYZ",
      "GoUplift platform fee (4.25%)",
      "KES 42.50",
      "Goes to the fundraiser",
      "KES 957.50",
    ]) {
      expect(html).toContain(part);
      expect(text).toContain(part);
    }
  });

  it("labels the reference as a payment reference", () => {
    expect(text).toContain("Payment reference: TKB1234XYZ");
  });

  it("greets the donor by first name only", () => {
    expect(text.startsWith("Hello Wanjiru,")).toBe(true);
    expect(html).toContain("Hello Wanjiru,");
    expect(html).not.toContain("Kamau");
    expect(text).not.toContain("Kamau");
  });

  it("links to the fundraiser and the help page on the site it was given", () => {
    expect(html).toContain(`href="${SITE}/fundraiser/fundraiser_456"`);
    expect(html).toContain(`href="${SITE}/help"`);
    expect(text).toContain(`${SITE}/fundraiser/fundraiser_456`);
  });

  it("ignores a trailing slash on the site address", () => {
    const withSlash = buildReceiptEmail(mobileMoney, `${SITE}///`);
    expect(withSlash.html).toContain(`href="${SITE}/fundraiser/fundraiser_456"`);
  });

  it("carries the donation id so a question about it can be answered", () => {
    expect(html).toContain("Donation ID: donation_123");
    expect(text).toContain("Donation ID: donation_123");
  });

  it("has a preheader, a viewport and a language", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("display:none");
  });

  it("makes no claim about tax", () => {
    expect(`${subject} ${html} ${text}`).not.toMatch(/tax|deductib/i);
  });

  it("does not say it is monthly, or anonymous", () => {
    expect(html).not.toContain("Monthly gift");
    expect(html).not.toContain("Anonymous");
    expect(text).not.toContain("Anonymous");
  });
});

describe("a PayPal receipt", () => {
  const { html, text } = build(paypal);

  it("shows what was charged in dollars, the rate, and the shilling amount", () => {
    for (const part of [
      "You paid",
      "USD 10.00",
      "Exchange rate",
      "KES 130 per US dollar",
      "Amount in shillings",
      "KES 1,300",
    ]) {
      expect(html).toContain(part);
      expect(text).toContain(part);
    }
  });

  it("calls the reference a PayPal transaction ID", () => {
    expect(text).toContain("PayPal transaction ID: SALE-9");
    expect(text).not.toContain("Payment reference");
  });

  it("names PayPal as how it was paid", () => {
    expect(text).toContain("Paid with: PayPal");
  });

  it("still names PayPal when the method was never filled in", () => {
    const { text: t } = build({ ...paypal, paymentMethod: null });
    expect(t).toContain("Paid with: PayPal");
  });

  it("shows the exchange rate with cents when it has them", () => {
    const { text: t } = build({ ...paypal, exchangeRate: 129.5 });
    expect(t).toContain("KES 129.50 per US dollar");
  });

  it("leaves out the rate line when it isn't known", () => {
    const { text: t } = build({ ...paypal, exchangeRate: null });
    expect(t).not.toContain("Exchange rate");
    expect(t).toContain("USD 10.00");
  });
});

describe("a monthly receipt", () => {
  const { html, text } = build({ ...paypal, isMonthly: true });

  it("says it is monthly and that the donor stays in control", () => {
    expect(text).toContain("Thank you for your monthly gift.");
    expect(text).toContain("Type: Monthly gift");
    expect(text).toContain("cancel from your PayPal account whenever you like");
    expect(html).toContain("cancel from your PayPal account whenever you like");
  });
});

describe("an anonymous donation", () => {
  it("still goes to the donor by name, and says how it appears publicly", () => {
    const { text, html } = build({ isAnonymous: true });
    expect(text.startsWith("Hello Wanjiru,")).toBe(true);
    expect(text).toContain("Shown publicly as: Anonymous");
    expect(html).toContain("Shown publicly as");
  });
});

describe("a donor with no name", () => {
  it.each([null, "", "   "])("is greeted plainly (%j)", (donorName) => {
    const { text, html } = build({ donorName });
    expect(text.startsWith("Hello,\n")).toBe(true);
    expect(html).toContain("Hello,");
  });
});

describe("a receipt with no reference", () => {
  it("leaves the line out rather than showing a blank", () => {
    const { text } = build({ reference: null });
    expect(text).not.toContain("Payment reference");
  });
});

describe("text typed by people", () => {
  const evilTitle = `<script>alert("x")</script> & "friends"`;
  const evilName = `"><img src=x onerror=alert(1)>`;
  const { html, subject } = build({
    fundraiserTitle: evilTitle,
    donorName: evilName,
    reference: "<b>CODE</b>",
  });

  it("is escaped everywhere it appears in the HTML", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>CODE</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;CODE&lt;/b&gt;");
  });

  it("can't break out of the link it sits in", () => {
    const { html: h } = build({ fundraiserId: `x"><script>1</script>` });
    expect(h).not.toContain("<script>1</script>");
  });

  it("is kept to one line in the subject", () => {
    const { subject: s } = build({ fundraiserTitle: "Line one\r\nBcc: attacker@example.test" });
    expect(s).not.toMatch(/[\r\n]/);
    expect(s).toContain("Line one Bcc: attacker@example.test");
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("is shortened in the subject but not in the body", () => {
    const long = "A very long fundraiser title that keeps going ".repeat(6).trim();
    const { subject: s, html: h } = build({ fundraiserTitle: long });
    expect(s.length).toBeLessThan(110);
    expect(s.endsWith("…")).toBe(true);
    expect(h).toContain(long.slice(0, 100));
  });

  it("gets a plain stand-in when the title is empty", () => {
    const { text } = build({ fundraiserTitle: "   " });
    expect(text).toContain('"a fundraiser"');
  });
});
