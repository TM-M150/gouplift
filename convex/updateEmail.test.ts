import { describe, expect, it } from "vitest";
import { buildUpdateEmail, type UpdateEmailData } from "./lib/updateEmail";
import { SITE_URL } from "../lib/site";

const data: UpdateEmailData = {
  fundraiserId: "k17abc",
  fundraiserTitle: "Water for Kajiado",
  amountRaised: 45000,
  goalAmount: 100000,
  currency: "KES",
  isOpen: true,
  token: "tok_abc-123",
};

describe("the update email", () => {
  it("names the fundraiser and sends the reader to its updates", () => {
    const email = buildUpdateEmail(data);

    expect(email.subject).toBe("New update on Water for Kajiado");
    const readUrl = `${SITE_URL}/fundraiser/k17abc#updates`;
    expect(email.html).toContain(readUrl);
    expect(email.text).toContain(`Read the update: ${readUrl}`);
    expect(email.text).toContain("Water for Kajiado");
  });

  it("shows how far along the fundraiser is, in shillings", () => {
    const email = buildUpdateEmail(data);
    expect(email.text).toContain("KES 45,000 raised of KES 100,000");
    expect(email.html).toContain("KES 45,000 raised of KES 100,000");
    expect(email.html).toContain('width="45%"');
  });

  it("leaves the totals out for a fundraiser that isn't in shillings or has no goal", () => {
    for (const odd of [
      { ...data, currency: "USD" as const },
      { ...data, goalAmount: 0 },
    ]) {
      const email = buildUpdateEmail(odd);
      expect(email.text).not.toMatch(/raised of/);
      expect(email.html).not.toMatch(/raised of|NaN|Infinity/);
    }
  });

  it("keeps the bar inside its box when the goal has been passed", () => {
    const email = buildUpdateEmail({ ...data, amountRaised: 250000 });
    expect(email.html).toContain('width="100%"');
    expect(email.html).not.toContain('width="250%"');
  });

  it("only suggests giving again while the fundraiser is still open", () => {
    expect(buildUpdateEmail({ ...data, isOpen: true }).text).toMatch(
      /still open/,
    );
    expect(buildUpdateEmail({ ...data, isOpen: false }).text).not.toMatch(
      /still open/,
    );
  });

  it("has a link to unsubscribe, built from the recipient's token", () => {
    const email = buildUpdateEmail(data);
    const link = `${SITE_URL}/unsubscribe/tok_abc-123`;
    expect(email.html).toContain(link);
    expect(email.text).toContain(link);
    expect(email.text).toMatch(/donated to this fundraiser/);
  });

  it("is built to carry only what staff reviewed: the title and the totals", () => {
    // The data has nowhere to put the update's own text, and that is the point:
    // the email comes from us, so a creator's words must not ride in it.
    expect(Object.keys(data)).not.toContain("body");
    expect(Object.keys(data)).not.toContain("update");
  });

  it("escapes a title that is made of markup", () => {
    const email = buildUpdateEmail({
      ...data,
      fundraiserTitle: `Water <script>alert(1)</script> & "more"`,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp;");
  });

  it("keeps the subject to one line of sensible length", () => {
    const email = buildUpdateEmail({
      ...data,
      fundraiserTitle: `Line one\r\nBcc: someone@example.test\n${"long ".repeat(80)}`,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(
      "New update on ".length + 70,
    );
  });

  it("falls back to a plain word when the title is empty", () => {
    const email = buildUpdateEmail({ ...data, fundraiserTitle: "   " });
    expect(email.subject).toBe("New update on a fundraiser");
  });

  it("adds the one-click unsubscribe headers when it has an address for them", () => {
    const email = buildUpdateEmail(data, {
      oneClickUrl: "https://example-123.convex.site/email/unsubscribe/tok",
    });
    expect(email.headers).toEqual({
      "List-Unsubscribe":
        "<https://example-123.convex.site/email/unsubscribe/tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("sends no unsubscribe headers rather than a broken one", () => {
    expect(buildUpdateEmail(data).headers).toEqual({});
    expect(buildUpdateEmail(data, { oneClickUrl: null }).headers).toEqual({});
  });

  it("uses the site address it is given, without doubling the slash", () => {
    const email = buildUpdateEmail(data, { siteUrl: "https://preview.test/" });
    expect(email.text).toContain(
      "https://preview.test/fundraiser/k17abc#updates",
    );
    expect(email.text).toContain(
      "https://preview.test/unsubscribe/tok_abc-123",
    );
    expect(email.text).not.toContain("//fundraiser");
  });
});
