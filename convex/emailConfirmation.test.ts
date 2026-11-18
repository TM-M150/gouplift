/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { safeNextPath } from "../lib/safe-redirect";
import {
  BETTER_AUTH_RELATIVE_CALLBACK,
  EMAIL_CONFIRMED_PATH,
  EMAIL_NOT_CONFIRMED_MESSAGE,
  confirmationCallbackURL,
  confirmationResult,
} from "../lib/email-confirmation";
import {
  ALL_ACCOUNTS_LIMIT,
  CONFIRMATION_LINK_LIFETIME_SECONDS,
  PER_ACCOUNT_LIMIT,
  createSendVerificationEmail,
  emailConfirmationOptions,
  isResendRequest,
  type AllowSend,
  type VerificationEmailDeps,
} from "./lib/emailConfirmation";
import { buildVerificationEmail } from "./lib/verificationEmail";
import type { EmailOutcome } from "./lib/email";

const modules = import.meta.glob("./**/*.ts");

const URL_IN_EMAIL =
  "https://gouplift.africa/api/auth/verify-email?token=abc.def.ghi&callbackURL=%2Femail-confirmed";

describe("the address the confirmation link comes back to", () => {
  it("is the landing page, or the landing page remembering where they were going", () => {
    expect(confirmationCallbackURL(null)).toBe(EMAIL_CONFIRMED_PATH);
    expect(confirmationCallbackURL(undefined)).toBe(EMAIL_CONFIRMED_PATH);
    expect(confirmationCallbackURL("/fundraiser/k17abc")).toBe(
      "/email-confirmed?next=%2Ffundraiser%2Fk17abc",
    );
  });

  it("won't carry an address that leaves the site or loops into sign-in", () => {
    for (const next of [
      "https://evil.test/",
      "//evil.test/",
      "/\\evil.test",
      "/sign-in",
      "/sign-up?x=1",
      "javascript:alert(1)",
      "",
    ]) {
      expect(confirmationCallbackURL(next), next).toBe(EMAIL_CONFIRMED_PATH);
    }
  });

  it("is always an address better-auth accepts, because a refusal would stop sign-up", () => {
    // better-auth checks the callback address at sign-up. The characters
    // ! ~ * ' ( ) are the ones encodeURIComponent leaves alone and it rejects.
    const awkward = [
      "/fundraiser/a?x=1&y=(2)!*'~",
      "/fundraiser/café",
      "/a b/c",
      "/a;b,c:d",
      "/path#comments",
      "/q?name=O'Brien",
      "/search?q=a+b%20c",
      `/${"long/".repeat(50)}`,
    ];
    for (const next of awkward) {
      const url = confirmationCallbackURL(next);
      expect(BETTER_AUTH_RELATIVE_CALLBACK.test(url), `${next} → ${url}`).toBe(
        true,
      );
    }
  });

  it("carries the path through, as the sign-in pages read it", () => {
    for (const next of ["/a?x=1&y=(2)!*'~", "/fundraiser/café#top"]) {
      const url = confirmationCallbackURL(next);
      const back = new URL(url, "https://same-site.invalid").searchParams.get(
        "next",
      );
      // safeNextPath tidies the path (a ' in a query becomes %27); the point
      // is that what comes out of the link is that same path, not a mangled one.
      expect(back, next).toBe(safeNextPath(next, ""));
      expect(back, next).not.toBe("");
    }
  });

  it("carries nothing for a path too long to follow", () => {
    // Over the 500-character limit for a path we follow.
    expect(confirmationCallbackURL(`/${"a".repeat(600)}`)).toBe(
      EMAIL_CONFIRMED_PATH,
    );
  });

  it("matches only the shapes better-auth allows", () => {
    // Pins the copy of better-auth's pattern, so the checks above mean something.
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test("/email-confirmed")).toBe(true);
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test("/x?next=%2Fa")).toBe(true);
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test("//evil.test")).toBe(false);
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test("/x?next=(a)")).toBe(false);
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test("/x?next=a!")).toBe(false);
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test("https://evil.test")).toBe(false);
  });
});

describe("what the landing page says", () => {
  it("says the email is confirmed when there is no error", () => {
    for (const code of [null, undefined, "", "  "]) {
      const result = confirmationResult(code);
      expect(result.status).toBe("confirmed");
      expect(result.title).toBe("Email confirmed");
      expect(result.message).toMatch(/withdrawals/);
    }
  });

  it("says a link has expired, and offers a new one", () => {
    const result = confirmationResult("token_expired");
    expect(result).toMatchObject({
      status: "problem",
      title: "That link has expired",
      canResend: true,
    });
    expect(result.message).toMatch(/24 hours/);
    expect(result.message).toMatch(/ask for a new one/);
  });

  it("says a link isn't valid, and offers a new one", () => {
    expect(confirmationResult("invalid_token")).toMatchObject({
      status: "problem",
      title: "That link isn't valid",
      canResend: true,
    });
  });

  it("says when the account is gone, with no new link to ask for", () => {
    expect(confirmationResult("user_not_found")).toMatchObject({
      status: "problem",
      title: "We couldn't find that account",
      canResend: false,
    });
  });

  it("is the same whatever case the code comes in", () => {
    expect(confirmationResult("TOKEN_EXPIRED")).toEqual(
      confirmationResult("token_expired"),
    );
    expect(confirmationResult(" Invalid_Token ")).toEqual(
      confirmationResult("invalid_token"),
    );
  });

  it("gives any other error a plain message", () => {
    expect(confirmationResult("something_new")).toMatchObject({
      status: "problem",
      title: "We couldn't confirm your email",
      canResend: true,
    });
  });

  it("never shows what is in the address", () => {
    for (const code of [
      "<script>alert(1)</script>",
      "Your account is suspended. Call 0700 000 000",
      "https://evil.test/login",
    ]) {
      const result = confirmationResult(code);
      const text = `${result.title} ${result.message}`;
      expect(text).not.toContain(code);
      expect(text).not.toMatch(/script|suspended|evil\.test|0700/);
      expect(result.status).toBe("problem");
    }
  });
});

describe("the withdrawal message", () => {
  it("says what to do, and where", () => {
    expect(EMAIL_NOT_CONFIRMED_MESSAGE).toMatch(/confirm your email address/);
    expect(EMAIL_NOT_CONFIRMED_MESSAGE).toMatch(/Send again/);
  });
});

describe("the confirmation email", () => {
  it("has the link, as a button and as plain text", () => {
    const email = buildVerificationEmail({
      userName: "Wanjiru Kamau",
      url: URL_IN_EMAIL,
    });
    expect(email.subject).toBe("Confirm your GoUplift email address");
    // In HTML an & has to be written &amp;.
    expect(email.html).toContain(
      'href="https://gouplift.africa/api/auth/verify-email?token=abc.def.ghi&amp;callbackURL=%2Femail-confirmed"',
    );
    expect(email.html).toContain("Confirm my email");
    expect(email.text).toContain(`Confirm my email: ${URL_IN_EMAIL}`);
  });

  it("greets by first name only", () => {
    const named = buildVerificationEmail({
      userName: "Wanjiru Kamau",
      url: URL_IN_EMAIL,
    });
    expect(named.text.startsWith("Hello Wanjiru,")).toBe(true);
    expect(named.text).not.toContain("Kamau");

    const nameless = buildVerificationEmail({
      userName: null,
      url: URL_IN_EMAIL,
    });
    expect(nameless.text.startsWith("Hello,")).toBe(true);
  });

  it("says how long the link works, and what to do if it wasn't them", () => {
    const { text, html } = buildVerificationEmail({
      userName: "A",
      url: URL_IN_EMAIL,
    });
    for (const body of [text, html]) {
      expect(body).toMatch(/24 hours/);
      expect(body).toMatch(/didn(&#39;|')t create a GoUplift account/);
      expect(body).toMatch(/ignore this email/);
      expect(body).toMatch(/withdrawal/);
    }
    // The wording and the setting agree.
    expect(CONFIRMATION_LINK_LIFETIME_SECONDS).toBe(24 * 60 * 60);
  });

  it("can't be broken by what is in the name or the link", () => {
    const email = buildVerificationEmail({
      userName: '<img src=x onerror="alert(1)"> Evil',
      url: 'https://gouplift.africa/x"><script>alert(1)</script>',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('onerror="');
  });

  it("links the help page of the site it is sent from", () => {
    const email = buildVerificationEmail(
      { userName: "A", url: URL_IN_EMAIL },
      { siteUrl: "https://staging.example.test/" },
    );
    expect(email.text).toContain("https://staging.example.test/help");
  });
});

// ---- The sender -------------------------------------------------------------

const USER = { id: "user_1", email: "wanjiru@example.test", name: "Wanjiru" };
const TOKEN = "header.payload.0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH";

const SIGN_UP = new Request("https://gouplift.africa/api/auth/sign-up/email", {
  method: "POST",
});
const RESEND = new Request(
  "https://gouplift.africa/api/auth/send-verification-email",
  { method: "POST" },
);

interface Fakes {
  deps: VerificationEmailDeps;
  consumed: Array<{ key: string; limit: { max: number; windowMs: number } }>;
  sent: Array<Parameters<VerificationEmailDeps["send"]>[0]>;
}

function fakes(
  options: {
    denyKey?: string;
    retryAfterMs?: number;
    outcome?: EmailOutcome;
  } = {},
): Fakes {
  const consumed: Fakes["consumed"] = [];
  const sent: Fakes["sent"] = [];
  const deps: VerificationEmailDeps = {
    consume: async (key, limit): Promise<AllowSend> => {
      consumed.push({ key, limit });
      return options.denyKey === key
        ? { allowed: false, retryAfterMs: options.retryAfterMs ?? 1000 }
        : { allowed: true };
    },
    send: async (input) => {
      sent.push(input);
      return options.outcome ?? { kind: "sent" };
    },
  };
  return { deps, consumed, sent };
}

const ask = (deps: VerificationEmailDeps, request?: Request) =>
  createSendVerificationEmail(deps)(
    { user: USER, url: URL_IN_EMAIL, token: TOKEN },
    request,
  );

describe("sending the confirmation email", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errors.mockRestore();
  });

  it("sends the email to the person, with the link", async () => {
    const f = fakes();

    await ask(f.deps, SIGN_UP);

    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({
      to: USER.email,
      subject: "Confirm your GoUplift email address",
    });
    expect(f.sent[0].text).toContain(URL_IN_EMAIL);
    expect(f.sent[0].html).toContain("Confirm my email");
  });

  it("gives each link its own idempotency key, so a repeat of one is not sent twice", async () => {
    const f = fakes();
    await ask(f.deps, SIGN_UP);
    await ask(f.deps, SIGN_UP);
    expect(f.sent[0].idempotencyKey).toBe(f.sent[1].idempotencyKey);
    expect(f.sent[0].idempotencyKey).toBe(
      `verify-email:user_1:${TOKEN.slice(-40)}`,
    );

    const other = fakes();
    await createSendVerificationEmail(other.deps)(
      { user: USER, url: URL_IN_EMAIL, token: `${TOKEN.slice(0, -1)}X` },
      SIGN_UP,
    );
    expect(other.sent[0].idempotencyKey).not.toBe(f.sent[0].idempotencyKey);
  });

  it("counts each send against the account and against everyone", async () => {
    const f = fakes();
    await ask(f.deps, SIGN_UP);
    expect(f.consumed).toEqual([
      { key: "verify-email:user_1", limit: PER_ACCOUNT_LIMIT },
      { key: "verify-email:all", limit: ALL_ACCOUNTS_LIMIT },
    ]);
    expect(PER_ACCOUNT_LIMIT).toEqual({ max: 5, windowMs: 3_600_000 });
    expect(ALL_ACCOUNTS_LIMIT).toEqual({ max: 60, windowMs: 3_600_000 });
  });

  describe("at sign-up", () => {
    it("never throws, so the account is still made", async () => {
      for (const options of [
        { denyKey: "verify-email:user_1" },
        { denyKey: "verify-email:all" },
        { outcome: { kind: "failed", retryable: true, error: "503" } as const },
        {
          outcome: {
            kind: "failed",
            retryable: false,
            error: "RESEND_API_KEY is not set",
          } as const,
        },
      ]) {
        const f = fakes(options);
        await expect(ask(f.deps, SIGN_UP)).resolves.toBeUndefined();
        await expect(ask(f.deps, undefined)).resolves.toBeUndefined();
      }
    });

    it("says why in the log, without the person's address", async () => {
      const f = fakes({
        outcome: {
          kind: "failed",
          retryable: false,
          error: "RESEND_API_KEY is not set",
        },
      });
      await ask(f.deps, SIGN_UP);
      expect(errors).toHaveBeenCalledTimes(1);
      const logged = String(errors.mock.calls[0][0]);
      expect(logged).toMatch(/RESEND_API_KEY is not set/);
      expect(logged).not.toContain(USER.email);
    });
  });

  describe("when someone asks for a new link", () => {
    it("tells them when they have asked too often, and sends nothing", async () => {
      const f = fakes({ denyKey: "verify-email:user_1" });
      await expect(ask(f.deps, RESEND)).rejects.toMatchObject({
        status: "TOO_MANY_REQUESTS",
        body: { message: expect.stringMatching(/already sent several/) },
      });
      expect(f.sent).toHaveLength(0);
      // The account's own limit was reached, so the shared one wasn't touched.
      expect(f.consumed.map((c) => c.key)).toEqual(["verify-email:user_1"]);
    });

    it("tells them when everyone together has asked too often", async () => {
      const f = fakes({ denyKey: "verify-email:all" });
      await expect(ask(f.deps, RESEND)).rejects.toMatchObject({
        status: "TOO_MANY_REQUESTS",
        body: { message: expect.stringMatching(/a lot of emails right now/) },
      });
      expect(f.sent).toHaveLength(0);
    });

    it("tells them when sending failed, in plain words", async () => {
      const f = fakes({
        outcome: { kind: "failed", retryable: true, error: "Resend said 503" },
      });
      await expect(ask(f.deps, RESEND)).rejects.toMatchObject({
        status: "INTERNAL_SERVER_ERROR",
        body: {
          message: expect.stringMatching(/couldn't send the email just now/),
        },
      });
    });

    it("keeps the provider's error out of what they are told", async () => {
      const f = fakes({
        outcome: {
          kind: "failed",
          retryable: false,
          error: "RESEND_API_KEY is not set. Set it with `npx convex env set`.",
        },
      });
      const error = await ask(f.deps, RESEND).catch((e) => e);
      expect(error.body.message).toMatch(/couldn't send the email/);
      expect(error.body.message).not.toMatch(/RESEND|convex env/);
      // It is in the log for whoever runs the site.
      expect(String(errors.mock.calls[0][0])).toMatch(/RESEND_API_KEY/);
    });

    it("sends the email when all is well", async () => {
      const f = fakes();
      await expect(ask(f.deps, RESEND)).resolves.toBeUndefined();
      expect(f.sent).toHaveLength(1);
    });
  });
});

describe("telling a request for a new link from a sign-up", () => {
  it("goes by the address the request came to", () => {
    expect(isResendRequest(RESEND)).toBe(true);
    expect(isResendRequest(SIGN_UP)).toBe(false);
    expect(isResendRequest(undefined)).toBe(false);
  });

  it("is not fooled by the words appearing elsewhere in the address", () => {
    expect(
      isResendRequest(
        new Request(
          "https://gouplift.africa/api/auth/sign-up/email?x=/send-verification-email",
        ),
      ),
    ).toBe(false);
  });

  it("treats a request it can't read as a sign-up, which never throws", () => {
    expect(isResendRequest({ url: "not a url" } as Request)).toBe(false);
  });
});

describe("the settings handed to better-auth", () => {
  it("send at sign-up, expire after a day, and don't sign anyone in by the link", () => {
    const { emailVerification } = emailConfirmationOptions(fakes().deps);
    expect(emailVerification.sendOnSignUp).toBe(true);
    expect(emailVerification.expiresIn).toBe(86_400);
    expect(typeof emailVerification.sendVerificationEmail).toBe("function");
    // Not set at all, which better-auth reads as off. See the note beside it.
    expect(emailVerification).not.toHaveProperty("autoSignInAfterVerification");
  });
});

describe("the shared limit on sends", () => {
  it("lets through up to the maximum in the window, then says when to try again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    try {
      const t = convexTest(schema, modules);
      const take = (key: string) =>
        t.mutation(internal.lib.rateLimit.consume, {
          key,
          max: 2,
          windowMs: 60_000,
        });

      expect(await take("a")).toEqual({ allowed: true });
      expect(await take("a")).toEqual({ allowed: true });
      const blocked = await take("a");
      expect(blocked.allowed).toBe(false);
      // About the whole window is left.
      expect(blocked.allowed ? 0 : blocked.retryAfterMs).toBeGreaterThan(
        59_000,
      );

      // Another key has its own count.
      expect(await take("b")).toEqual({ allowed: true });

      // And the window opens again.
      vi.setSystemTime(new Date("2026-11-18T10:01:01Z"));
      expect(await take("a")).toEqual({ allowed: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
