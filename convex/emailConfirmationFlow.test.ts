// @vitest-environment node
//
// These run better-auth's real sign-up, confirmation and password-reset code,
// against an in-memory database, with the emails captured instead of sent. The
// point is to check what actually happens when someone follows the link, asks
// for a new one, or resets a password, rather than what we hope the settings do.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { phoneNumber } from "better-auth/plugins";
import {
  PER_ACCOUNT_LIMIT,
  emailConfirmationOptions,
  type AllowSend,
} from "./lib/emailConfirmation";
import type { EmailOutcome } from "./lib/email";
import {
  confirmationCallbackURL,
  confirmationResult,
} from "../lib/email-confirmation";

const BASE = "http://localhost:3000";
const EMAIL = "wanjiru@example.test";
const PASSWORD = "old-password-123";

type Row = Record<string, unknown>;

function makeAuth(options: { sendOutcome?: EmailOutcome } = {}) {
  const db: Record<string, Row[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const resets: Array<{ token: string; email: string }> = [];
  const counts = new Map<string, number>();

  const auth = betterAuth({
    baseURL: BASE,
    secret: "a-test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter(db),
    trustedOrigins: [BASE],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        resets.push({ token, email: user.email });
      },
    },
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
    plugins: [phoneNumber()],
    // The same confirmation settings as the real sign-in setup. Only the
    // counting and the sending are stood in for.
    ...emailConfirmationOptions({
      consume: async (key, limit): Promise<AllowSend> => {
        const used = (counts.get(key) ?? 0) + 1;
        counts.set(key, used);
        return used > limit.max
          ? { allowed: false, retryAfterMs: limit.windowMs }
          : { allowed: true };
      },
      send: async (input) => {
        sent.push({ to: input.to, subject: input.subject, text: input.text });
        return options.sendOutcome ?? { kind: "sent" };
      },
    }),
  });
  return { auth, db, sent, resets };
}

type Auth = ReturnType<typeof makeAuth>["auth"];

// ---- Helpers ---------------------------------------------------------------

/** "name=value" pairs from a response's Set-Cookie headers, as a Cookie header. */
function cookieHeader(headers: Headers, existing = ""): string {
  const fresh = headers
    .getSetCookie()
    .filter((line) => !/max-age=0/i.test(line))
    .map((line) => line.split(";")[0]);
  return [existing, ...fresh].filter(Boolean).join("; ");
}

function post(path: string, body: unknown, cookie = "") {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Signing up from the sign-up page, as the browser does. */
async function signUp(
  auth: Auth,
  options: { email?: string; callbackURL?: string } = {},
) {
  const res = await auth.handler(
    post("/sign-up/email", {
      name: "Wanjiru Kamau",
      email: options.email ?? EMAIL,
      password: PASSWORD,
      callbackURL: options.callbackURL ?? confirmationCallbackURL(null),
    }),
  );
  return {
    res,
    status: res.status,
    cookie: cookieHeader(res.headers),
    body: (await res.json().catch(() => null)) as {
      user?: { id: string; emailVerified: boolean };
      message?: string;
      code?: string;
    } | null,
  };
}

/** The link in the most recent confirmation email. */
function linkIn(
  sent: Array<{ text: string }>,
  index = sent.length - 1,
): string {
  const match = sent[index]?.text.match(/Confirm my email: (\S+)/);
  if (!match) throw new Error("No confirmation link in the email");
  return match[1];
}

/** What the landing page shows for the address better-auth sent the person to. */
const shownFor = (location: string) =>
  confirmationResult(new URL(location, BASE).searchParams.get("error"));

const userRow = (db: Record<string, Row[]>, email = EMAIL) =>
  db.user.find((u) => u.email === email);

// ---- The tests -------------------------------------------------------------

describe("signing up", () => {
  it("signs the person in, and sends the email with a link", async () => {
    const { auth, db, sent } = makeAuth();

    const made = await signUp(auth);

    expect(made.status).toBe(200);
    // Soft: they are in straight away, with the address not yet confirmed.
    expect(made.body?.user?.emailVerified).toBe(false);
    expect(userRow(db)?.emailVerified).toBe(false);
    expect(db.session).toHaveLength(1);
    expect(
      await auth.api.getSession({ headers: { cookie: made.cookie } }),
    ).not.toBeNull();

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].subject).toBe("Confirm your GoUplift email address");
    const link = new URL(linkIn(sent));
    expect(link.origin + link.pathname).toBe(`${BASE}/api/auth/verify-email`);
    expect(link.searchParams.get("callbackURL")).toBe("/email-confirmed");
  });

  it("is not refused for where they were going, however awkward the path", async () => {
    const { auth, sent } = makeAuth();

    const made = await signUp(auth, {
      callbackURL: confirmationCallbackURL(
        "/fundraiser/k17abc?utm=(a)!*'~&x=1",
      ),
    });

    expect(made.status).toBe(200);
    expect(sent).toHaveLength(1);
    const callback = new URL(linkIn(sent)).searchParams.get("callbackURL");
    expect(callback).toMatch(/^\/email-confirmed\?next=/);
  });

  it("still makes the account when the email can't be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth, db } = makeAuth({
      sendOutcome: { kind: "failed", retryable: false, error: "no key" },
    });

    const made = await signUp(auth);

    expect(made.status).toBe(200);
    expect(userRow(db)).toBeDefined();
    expect(
      await auth.api.getSession({ headers: { cookie: made.cookie } }),
    ).not.toBeNull();
    vi.restoreAllMocks();
  });
});

describe("following the link", () => {
  it("confirms the address and lands on the confirmed page", async () => {
    const { auth, db, sent } = makeAuth();
    await signUp(auth);

    const res = await auth.handler(new Request(linkIn(sent)));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/email-confirmed");
    expect(userRow(db)?.emailVerified).toBe(true);
  });

  it("doesn't sign anyone in by it", async () => {
    // Anyone can sign up with someone else's address. If this link signed in
    // whoever opened it, a person who clicked an email they never asked for
    // would be in an account somebody else made, password and all.
    const { auth, db, sent } = makeAuth();
    await signUp(auth);
    db.session.length = 0; // the person who signed up is not signed in here

    const res = await auth.handler(new Request(linkIn(sent)));

    expect(
      res.headers.getSetCookie().filter((c) => /session_token/.test(c)),
    ).toEqual([]);
    expect(db.session).toHaveLength(0);
  });

  it("brings them back to where they were going", async () => {
    const { auth, sent } = makeAuth();
    await signUp(auth, {
      callbackURL: confirmationCallbackURL("/fundraiser/k17abc"),
    });

    const res = await auth.handler(new Request(linkIn(sent)));

    expect(res.headers.get("location")).toBe(
      "/email-confirmed?next=%2Ffundraiser%2Fk17abc",
    );
  });

  it("works a second time, for someone who clicked twice", async () => {
    const { auth, sent } = makeAuth();
    await signUp(auth);
    const link = linkIn(sent);
    await auth.handler(new Request(link));

    const again = await auth.handler(new Request(link));

    expect(again.headers.get("location")).toBe("/email-confirmed");
  });

  describe("when it doesn't work", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("says the link has expired after a day, and confirms nothing", async () => {
      const { auth, db, sent } = makeAuth();
      await signUp(auth);
      const link = linkIn(sent);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      const res = await auth.handler(new Request(link));

      // better-auth writes its codes in capitals; the page reads either.
      const location = res.headers.get("location") ?? "";
      expect(location).toBe("/email-confirmed?error=TOKEN_EXPIRED");
      expect(shownFor(location).title).toBe("That link has expired");
      expect(userRow(db)?.emailVerified).toBe(false);
    });

    it("still works just inside the day", async () => {
      const { auth, db, sent } = makeAuth();
      await signUp(auth);
      const link = linkIn(sent);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 23 * 60 * 60 * 1000);
      await auth.handler(new Request(link));

      expect(userRow(db)?.emailVerified).toBe(true);
    });

    it("says a made-up or damaged link isn't valid, and confirms nothing", async () => {
      const { auth, db, sent } = makeAuth();
      await signUp(auth);
      const good = new URL(linkIn(sent));

      for (const token of [
        "not-a-token",
        `${good.searchParams.get("token")}x`,
        // A well-formed token signed by somebody else.
        "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6IndhbmppcnVAZXhhbXBsZS50ZXN0In0.c2ln",
      ]) {
        const url = new URL(good);
        url.searchParams.set("token", token);
        const res = await auth.handler(new Request(url));
        const location = res.headers.get("location") ?? "";
        expect(location, token).toBe("/email-confirmed?error=INVALID_TOKEN");
        expect(shownFor(location).title, token).toBe("That link isn't valid");
      }
      expect(userRow(db)?.emailVerified).toBe(false);
    });
  });
});

describe("asking for a new link", () => {
  it("sends another email to the person who is signed in", async () => {
    const { auth, sent } = makeAuth();
    const made = await signUp(auth);

    const res = await auth.handler(
      post(
        "/send-verification-email",
        { email: EMAIL, callbackURL: "/email-confirmed" },
        made.cookie,
      ),
    );

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toBe(EMAIL);
  });

  it("works with the new link and not only the first one", async () => {
    const { auth, db, sent } = makeAuth();
    const made = await signUp(auth);
    await auth.handler(
      post(
        "/send-verification-email",
        { email: EMAIL, callbackURL: "/email-confirmed" },
        made.cookie,
      ),
    );

    await auth.handler(new Request(linkIn(sent, 1)));

    expect(userRow(db)?.emailVerified).toBe(true);
  });

  it("is limited per account, and says so instead of going quiet", async () => {
    const { auth, sent } = makeAuth();
    const made = await signUp(auth); // the first of the allowed sends
    const ask = () =>
      auth.handler(
        post(
          "/send-verification-email",
          { email: EMAIL, callbackURL: "/email-confirmed" },
          made.cookie,
        ),
      );

    // The rest of the allowance goes out...
    for (let i = 1; i < PER_ACCOUNT_LIMIT.max; i++) {
      expect((await ask()).status, `send ${i + 1}`).toBe(200);
    }
    expect(sent).toHaveLength(PER_ACCOUNT_LIMIT.max);

    // ...and the next is refused, with words the person can read.
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as Row).message).toMatch(
      /already sent several confirmation emails/,
    );
    expect(sent).toHaveLength(PER_ACCOUNT_LIMIT.max);
  });

  it("can be asked for without signing in, and is limited the same way", async () => {
    // Anyone can ask for an email to be sent to an address. That is why the
    // limit is on the account, not on who is asking.
    const { auth, sent } = makeAuth();
    await signUp(auth);
    const askAnonymously = () =>
      auth.handler(
        post("/send-verification-email", {
          email: EMAIL,
          callbackURL: "/email-confirmed",
        }),
      );

    for (let i = 1; i < PER_ACCOUNT_LIMIT.max; i++) await askAnonymously();
    const refused = await askAnonymously();

    expect(refused.status).toBe(429);
    expect(sent).toHaveLength(PER_ACCOUNT_LIMIT.max);
  });

  it("sends nothing to an address that is already confirmed", async () => {
    const { auth, sent } = makeAuth();
    const made = await signUp(auth);
    await auth.handler(new Request(linkIn(sent)));

    const res = await auth.handler(
      post(
        "/send-verification-email",
        { email: EMAIL, callbackURL: "/email-confirmed" },
        made.cookie,
      ),
    );

    expect(res.status).toBe(400);
    expect(sent).toHaveLength(1);
  });

  it("tells the person when the email could not be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth, sent } = makeAuth({
      sendOutcome: {
        kind: "failed",
        retryable: true,
        error: "Resend said 503",
      },
    });
    const made = await signUp(auth);

    const res = await auth.handler(
      post(
        "/send-verification-email",
        { email: EMAIL, callbackURL: "/email-confirmed" },
        made.cookie,
      ),
    );

    expect(res.status).toBe(500);
    const message = ((await res.json()) as Row).message as string;
    expect(message).toMatch(/couldn't send the email just now/);
    expect(message).not.toMatch(/503|Resend/);
    expect(sent).toHaveLength(2); // it tried
    vi.restoreAllMocks();
  });
});

describe("resetting a password", () => {
  it("signs the account out everywhere", async () => {
    // If someone else had got into the account, a reset puts them out.
    const { auth, db, resets } = makeAuth();
    const made = await signUp(auth);
    await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
    expect(db.session).toHaveLength(2);

    await auth.api.requestPasswordReset({
      body: { email: EMAIL, redirectTo: "/reset-password" },
    });
    await auth.api.resetPassword({
      body: { newPassword: "a-brand-new-password-456", token: resets[0].token },
    });

    expect(db.session).toHaveLength(0);
    expect(
      await auth.api.getSession({ headers: { cookie: made.cookie } }),
    ).toBeNull();
  });
});

describe("the real sign-in setup", () => {
  const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");

  it("uses these confirmation settings", () => {
    expect(source).toMatch(/\.\.\.emailConfirmationOptions\(/);
  });

  it("signs out everywhere on a password reset", () => {
    expect(source).toMatch(/revokeSessionsOnPasswordReset:\s*true/);
  });

  it("lets people in before they confirm", () => {
    // A hard lock would be bypassed by signing in with a phone number and
    // password, and would lock out everyone who signed up before this existed.
    expect(source).toMatch(/requireEmailVerification:\s*false/);
  });
});
