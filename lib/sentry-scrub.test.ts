import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  scrubBreadcrumb,
  scrubEvent,
  scrubText,
  scrubUrl,
} from "./sentry-scrub";

const event = (parts: Partial<ErrorEvent>) =>
  ({ type: undefined, ...parts }) as ErrorEvent;

describe("scrubText", () => {
  it.each([
    [
      "Invalid email jane.doe+kids@example.co.ke given",
      "Invalid email [email] given",
    ],
    ["no account for a@b.com or c@d.org", "no account for [email] or [email]"],
  ])("removes email addresses: %s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    "0712345678",
    "0712 345 678",
    "0712-345-678",
    "+254712345678",
    "254712345678",
    "+254 712 345 678",
    "0112345678",
    "+44 7911 123456",
  ])("removes the phone number %s", (number) => {
    expect(scrubText(`Bad number ${number} for donor`)).toBe(
      "Bad number [number] for donor",
    );
  });

  it("keeps the character before a number", () => {
    expect(scrubText("phone:0712345678")).toBe("phone:[number]");
    expect(scrubText("0712345678,0722334455")).toBe("[number],[number]");
    expect(scrubText("(0712345678)")).toBe("([number])");
  });

  // The checkout request id is what finds a payment in the provider's
  // dashboard, so it has to survive even though it ends in a phone number.
  it("leaves ids and ordinary numbers alone", () => {
    for (const text of [
      "ws_CO_24112026081530123_0712345678",
      "Donation of KES 1,500 failed",
      "order 1234567890 not found",
      "year 2026, id 12345678",
      "RKT2ABC3D4",
    ]) {
      expect(scrubText(text)).toBe(text);
    }
  });
});

describe("scrubUrl", () => {
  it("drops the query string and the fragment", () => {
    expect(
      scrubUrl("https://gouplift.africa/reset-password?token=abc123"),
    ).toBe("https://gouplift.africa/reset-password");
    expect(scrubUrl("/fundraiser/abc#comments")).toBe("/fundraiser/abc");
    expect(scrubUrl("/a?x=1#y")).toBe("/a");
  });

  it.each([
    ["/comment/s3cr3t-T0KEN", "/comment/[token]"],
    [
      "https://gouplift.africa/comment/s3cr3t?x=1",
      "https://gouplift.africa/comment/[token]",
    ],
    ["/unsubscribe/s3cr3t", "/unsubscribe/[token]"],
    ["/unsubscribe/comments/s3cr3t", "/unsubscribe/comments/[token]"],
    // The password reset link that is emailed, before it forwards to our page.
    [
      "https://gouplift.africa/api/auth/reset-password/s3cr3t?callbackURL=/x",
      "https://gouplift.africa/api/auth/reset-password/[token]",
    ],
    // A token that happens to start with the word "comments" is still a token.
    ["/unsubscribe/commentsabc", "/unsubscribe/[token]"],
  ])("hides the private token in %s", (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });

  it("leaves ordinary pages alone", () => {
    for (const url of [
      "/",
      "/fundraiser/jh7abc123",
      "https://gouplift.africa/organizations/red-cross",
      "/unsubscribe",
      "/unsubscribe/comments",
      "/admin/alerts",
      // Our own reset page keeps its token in the query string, which is dropped.
      "/reset-password",
    ]) {
      expect(scrubUrl(url)).toBe(url);
    }
  });
});

describe("scrubBreadcrumb", () => {
  it("cleans the addresses in a navigation or request breadcrumb", () => {
    const crumb = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/comment/abc?x=1", to: "/unsubscribe/xyz", other: 7 },
    });
    expect(crumb.data).toEqual({
      from: "/comment/[token]",
      to: "/unsubscribe/[token]",
      other: 7,
    });

    const request = scrubBreadcrumb({
      category: "fetch",
      data: { url: "/api/auth/verify-email?token=abc", method: "GET" },
    });
    expect(request.data).toEqual({
      url: "/api/auth/verify-email",
      method: "GET",
    });
  });

  it("cleans the message, and drops what was passed to console.log", () => {
    const crumb: Breadcrumb = {
      category: "console",
      message: "failed for jane@example.com",
      data: { arguments: [{ email: "jane@example.com" }], logger: "console" },
    };
    const result = scrubBreadcrumb(crumb);
    expect(result.message).toBe("failed for [email]");
    expect(result.data).toEqual({ logger: "console" });
  });

  // Sentry passes a second argument (a hint) to this function.
  it("is not confused by the extra argument Sentry passes", () => {
    const call = scrubBreadcrumb as (...args: unknown[]) => Breadcrumb;
    const crumb = call({ message: "for jane@example.com" }, { event: {} });
    expect(crumb.message).toBe("for [email]");
  });

  it("copes with a breadcrumb that has neither a message nor data", () => {
    expect(scrubBreadcrumb({ category: "ui.click" })).toEqual({
      category: "ui.click",
    });
  });
});

describe("scrubEvent", () => {
  const dirty = () =>
    event({
      message: "Could not text 0712345678",
      transaction: "/comment/s3cr3t",
      user: { id: "u1", email: "jane@example.com", ip_address: "1.2.3.4" },
      exception: {
        values: [
          { type: "Error", value: "No donor with email jane@example.com" },
          { type: "Error" },
        ],
      },
      request: {
        url: "https://gouplift.africa/comment/s3cr3t?utm=x",
        query_string: "utm=x",
        cookies: { session: "abc" },
        data: { phone: "0712345678" },
        headers: {
          Cookie: "session=abc",
          authorization: "Bearer abc",
          "X-Forwarded-For": "1.2.3.4",
          Referer: "https://gouplift.africa/unsubscribe/s3cr3t?x=1",
          "User-Agent": "Mozilla/5.0",
        },
      },
      breadcrumbs: [
        { category: "fetch", data: { url: "/comment/s3cr3t?x=1" } },
        { category: "console", message: "hello jane@example.com" },
      ],
    });

  it("takes out the user, the cookies and what was sent", () => {
    const result = scrubEvent(dirty());
    expect(result.user).toBeUndefined();
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.data).toBeUndefined();
    expect(result.request?.query_string).toBeUndefined();
  });

  it("cleans the message, the error text and every address", () => {
    const result = scrubEvent(dirty());
    expect(result.message).toBe("Could not text [number]");
    expect(result.exception?.values?.[0].value).toBe(
      "No donor with email [email]",
    );
    expect(result.transaction).toBe("/comment/[token]");
    expect(result.request?.url).toBe("https://gouplift.africa/comment/[token]");
    expect(result.breadcrumbs?.[0].data?.url).toBe("/comment/[token]");
    expect(result.breadcrumbs?.[1].message).toBe("hello [email]");
  });

  it("removes the headers that identify a person and keeps the rest", () => {
    const headers = scrubEvent(dirty()).request?.headers;
    expect(headers).toEqual({
      Referer: "https://gouplift.africa/unsubscribe/[token]",
      "User-Agent": "Mozilla/5.0",
    });
  });

  it("copes with an event that has almost nothing in it", () => {
    expect(scrubEvent(event({}))).toEqual({ type: undefined });
    expect(scrubEvent(event({ request: {} }))).toEqual({
      type: undefined,
      request: {},
    });
  });

  it("returns the event itself, so it is still sent", () => {
    const original = dirty();
    expect(scrubEvent(original)).toBe(original);
  });
});

describe("a page's private token quoted in an error", () => {
  const onPage = (url: string, parts: Partial<ErrorEvent> = {}) =>
    scrubEvent(event({ request: { url }, ...parts }));

  it("is hidden in the error message and the breadcrumbs", () => {
    const result = onPage("https://gouplift.africa/comment/Tok3n-Secret-9z", {
      exception: {
        values: [{ value: "Invalid value: Tok3n-Secret-9z for token" }],
      },
      message: "failed: Tok3n-Secret-9z",
      breadcrumbs: [
        {
          category: "console",
          message: "Error: bad Tok3n-Secret-9z twice Tok3n-Secret-9z",
        },
      ],
    });
    expect(result.exception?.values?.[0].value).toBe(
      "Invalid value: [token] for token",
    );
    expect(result.message).toBe("failed: [token]");
    expect(result.breadcrumbs?.[0].message).toBe(
      "Error: bad [token] twice [token]",
    );
    expect(result.request?.url).toBe("https://gouplift.africa/comment/[token]");
  });

  it("covers every kind of token page", () => {
    for (const url of [
      "https://x.test/unsubscribe/Tok3n-Secret-9z",
      "https://x.test/unsubscribe/comments/Tok3n-Secret-9z",
      "https://x.test/api/auth/reset-password/Tok3n-Secret-9z?callbackURL=/a",
      "https://x.test/reset-password?token=Tok3n-Secret-9z",
      "https://x.test/api/auth/verify-email?x=1&token=Tok3n-Secret-9z",
    ]) {
      const result = onPage(url, { message: "bad Tok3n-Secret-9z" });
      expect(result.message, url).toBe("bad [token]");
    }
  });

  it("is hidden when the error shows it with percent signs decoded", () => {
    const result = onPage("https://x.test/comment/a%2Fb%20c-token-1", {
      message: "bad a/b c-token-1",
    });
    expect(result.message).toBe("bad [token]");
  });

  it("leaves short values alone, so ordinary words are not hidden", () => {
    const result = onPage("https://x.test/comment/abc", {
      message: "abc is not a valid abc",
    });
    expect(result.message).toBe("abc is not a valid abc");
  });

  it("does nothing on a page without a token", () => {
    const result = onPage("https://x.test/fundraiser/jh7abc123def", {
      message: "no fundraiser jh7abc123def",
    });
    expect(result.message).toBe("no fundraiser jh7abc123def");
  });
});
