// @vitest-environment node
//
// These run better-auth's real sign-in code, against an in-memory database,
// with Google's answers stubbed. The point is to check what actually happens to
// an account when someone signs in with Google, rather than what we hope the
// hooks do.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { phoneNumber } from "better-auth/plugins";
import { googleLinkingOptions } from "./lib/googleAutoLink";
import { AUTH_NOTICE_COOKIE, GOOGLE_LINKED_NOTICE } from "../lib/auth-notices";

const BASE = "http://localhost:3000";
const EMAIL = "wanjiru@example.test";
const PASSWORD = "old-password-123";

type Row = Record<string, unknown>;

function makeAuth() {
  const db: Record<string, Row[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: BASE,
    secret: "a-test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter(db),
    trustedOrigins: [BASE],
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: { google: { clientId: "id", clientSecret: "secret" } },
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
    plugins: [phoneNumber()],
    // The same linking settings and hooks as the real sign-in setup.
    ...googleLinkingOptions,
  });
  return { auth, db };
}

// ---- Google, stubbed -------------------------------------------------------

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

let googleClaims: Record<string, unknown> = {};

function googleSays(claims: Record<string, unknown>) {
  googleClaims = {
    iss: "https://accounts.google.com",
    aud: "id",
    sub: "google-sub-1",
    name: "Wanjiru",
    ...claims,
  };
}

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const idToken = `${base64url({ alg: "RS256" })}.${base64url(googleClaims)}.sig`;
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email profile",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected request to ${url}`);
  }),
);

afterEach(() => {
  googleClaims = {};
});

// ---- Helpers ---------------------------------------------------------------

/** "name=value" pairs from a response's Set-Cookie headers, as a Cookie header. */
function cookieHeader(headers: Headers, existing = ""): string {
  const fresh = headers
    .getSetCookie()
    .filter((line) => !/max-age=0/i.test(line))
    .map((line) => line.split(";")[0]);
  return [existing, ...fresh].filter(Boolean).join("; ");
}

/** An account made the old way, with a password, by whoever typed the email. */
async function signUpWithPassword(
  auth: ReturnType<typeof makeAuth>["auth"],
  email = EMAIL,
) {
  const made = await auth.api.signUpEmail({
    body: { name: "Wanjiru", email, password: PASSWORD },
    returnHeaders: true,
  });
  return { userId: made.response.user.id, cookie: cookieHeader(made.headers) };
}

/** Another device signing in with the password. */
async function signInWithPassword(auth: ReturnType<typeof makeAuth>["auth"]) {
  const signed = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    returnHeaders: true,
  });
  return cookieHeader(signed.headers);
}

/** Starts Google sign-in, then plays Google sending the person back. */
async function comeBackFromGoogle(
  auth: ReturnType<typeof makeAuth>["auth"],
  start: { url: string; cookie: string },
) {
  const state = new URL(start.url).searchParams.get("state");
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/callback/google?code=abc&state=${state}`, {
      headers: { cookie: start.cookie },
    }),
  );
  const cookies = res.headers.getSetCookie();
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    cookies,
    cookie: cookieHeader(res.headers),
    noticeSet: cookies.some((c) =>
      c.startsWith(`${AUTH_NOTICE_COOKIE}=${GOOGLE_LINKED_NOTICE}`),
    ),
  };
}

/** Signing in with Google, from the sign-in page. */
async function signInWithGoogle(auth: ReturnType<typeof makeAuth>["auth"]) {
  const started = await auth.api.signInSocial({
    body: {
      provider: "google",
      callbackURL: "/profile",
      errorCallbackURL: "/sign-in",
    },
    returnHeaders: true,
  });
  return comeBackFromGoogle(auth, {
    url: started.response.url as string,
    cookie: cookieHeader(started.headers),
  });
}

/** Connecting Google from Settings, while signed in. */
async function connectGoogleFromSettings(
  auth: ReturnType<typeof makeAuth>["auth"],
  signedInCookie: string,
) {
  const started = await auth.api.linkSocialAccount({
    body: {
      provider: "google",
      callbackURL: "/profile?tab=settings&google=connected",
      errorCallbackURL: "/profile?tab=settings",
    },
    headers: { cookie: signedInCookie },
    returnHeaders: true,
  });
  return comeBackFromGoogle(auth, {
    url: started.response.url as string,
    cookie: cookieHeader(started.headers, signedInCookie),
  });
}

const providersOf = (db: Record<string, Row[]>) =>
  db.account.map((a) => a.providerId as string).sort();

async function sessionFor(
  auth: ReturnType<typeof makeAuth>["auth"],
  cookie: string,
) {
  return auth.api.getSession({ headers: { cookie } });
}

// ---- The tests -------------------------------------------------------------

describe("Google sign-in to an account made with a password", () => {
  it("links Google, removes the password and ends every other session", async () => {
    const { auth, db } = makeAuth();
    const { userId, cookie: firstCookie } = await signUpWithPassword(auth);
    // The person who made the account is signed in on two devices.
    const secondCookie = await signInWithPassword(auth);
    expect(db.session).toHaveLength(2);
    expect(await sessionFor(auth, firstCookie)).not.toBeNull();
    expect(await sessionFor(auth, secondCookie)).not.toBeNull();

    googleSays({ email: EMAIL, email_verified: true });
    const back = await signInWithGoogle(auth);

    // Signed in, and sent on to where they were going.
    expect(back.status).toBe(302);
    expect(back.location).toBe("/profile");
    expect(await sessionFor(auth, back.cookie)).toMatchObject({
      user: { id: userId, email: EMAIL },
    });

    // Google is joined to the same account, and the password is gone.
    expect(db.user).toHaveLength(1);
    expect(providersOf(db)).toEqual(["google"]);
    expect(db.account[0].userId).toBe(userId);

    // Nobody who was already signed in still is: only the new session is left.
    expect(db.session).toHaveLength(1);
    expect(await sessionFor(auth, firstCookie)).toBeNull();
    expect(await sessionFor(auth, secondCookie)).toBeNull();

    // And the password no longer opens the account.
    await expect(
      auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });

    // Google has now confirmed the email.
    expect(db.user[0].emailVerified).toBe(true);
  });

  it("leaves a note for the page they land on", async () => {
    const { auth } = makeAuth();
    await signUpWithPassword(auth);
    googleSays({ email: EMAIL, email_verified: true });
    const back = await signInWithGoogle(auth);

    expect(back.noticeSet).toBe(true);
    const note = back.cookies.find((c) => c.startsWith(AUTH_NOTICE_COOKIE))!;
    expect(note).toMatch(/Max-Age=\d+/i);
    expect(note).toMatch(/Path=\//i);
    // The page has to be able to read it and then clear it.
    expect(note).not.toMatch(/HttpOnly/i);
  });

  it("does the same for an email written in capitals", async () => {
    const { auth, db } = makeAuth();
    await signUpWithPassword(auth);
    googleSays({ email: EMAIL.toUpperCase(), email_verified: true });
    const back = await signInWithGoogle(auth);
    expect(back.location).toBe("/profile");
    expect(providersOf(db)).toEqual(["google"]);
  });

  it("works the next time too, without touching anything again", async () => {
    const { auth, db } = makeAuth();
    await signUpWithPassword(auth);
    googleSays({ email: EMAIL, email_verified: true });
    await signInWithGoogle(auth);

    const again = await signInWithGoogle(auth);
    expect(again.location).toBe("/profile");
    expect(again.noticeSet).toBe(false);
    expect(providersOf(db)).toEqual(["google"]);
    // Signing in again adds a session; it doesn't end the first one.
    expect(db.session).toHaveLength(2);
  });

  it("lets them set a password again afterwards", async () => {
    const { auth, db } = makeAuth();
    const { userId } = await signUpWithPassword(auth);
    googleSays({ email: EMAIL, email_verified: true });
    const back = await signInWithGoogle(auth);

    // What "Forgot password" does for an account with no password: it makes one.
    await auth.api.setPassword({
      body: { newPassword: "brand-new-password-456" },
      headers: { cookie: back.cookie },
    });
    expect(providersOf(db)).toEqual(["credential", "google"]);
    const signedIn = await auth.api.signInEmail({
      body: { email: EMAIL, password: "brand-new-password-456" },
    });
    expect(signedIn.user.id).toBe(userId);
  });
});

describe("Google not confirming the email address", () => {
  it("is refused, and the account is left exactly as it was", async () => {
    const { auth, db } = makeAuth();
    const { cookie } = await signUpWithPassword(auth);
    await signInWithPassword(auth);

    googleSays({ email: EMAIL, email_verified: false });
    const back = await signInWithGoogle(auth);

    expect(back.status).toBe(302);
    expect(back.location).toContain("/sign-in");
    expect(back.location).toContain("error=unable_to_link_account");
    expect(back.noticeSet).toBe(false);

    expect(providersOf(db)).toEqual(["credential"]);
    expect(db.session).toHaveLength(2);
    expect(await sessionFor(auth, cookie)).not.toBeNull();
    expect(db.user[0].emailVerified).toBe(false);
  });

  it("is refused for an account whose email was already confirmed", async () => {
    const { auth, db } = makeAuth();
    await signUpWithPassword(auth);
    db.user[0].emailVerified = true;

    googleSays({ email: EMAIL, email_verified: false });
    const back = await signInWithGoogle(auth);

    expect(back.location).toContain("error=unable_to_link_account");
    expect(providersOf(db)).toEqual(["credential"]);
  });
});

describe("an account whose email was already confirmed", () => {
  it("keeps its password and its sessions", async () => {
    const { auth, db } = makeAuth();
    const { cookie } = await signUpWithPassword(auth);
    await signInWithPassword(auth);
    db.user[0].emailVerified = true;

    googleSays({ email: EMAIL, email_verified: true });
    const back = await signInWithGoogle(auth);

    expect(back.location).toBe("/profile");
    expect(providersOf(db)).toEqual(["credential", "google"]);
    // Two that were there, and the new one.
    expect(db.session).toHaveLength(3);
    expect(await sessionFor(auth, cookie)).not.toBeNull();
    expect(back.noticeSet).toBe(false);
  });
});

describe("connecting Google from Settings", () => {
  it("keeps the password and the sessions, as the card says", async () => {
    const { auth, db } = makeAuth();
    const { userId, cookie } = await signUpWithPassword(auth);
    const otherDevice = await signInWithPassword(auth);

    googleSays({ email: EMAIL, email_verified: true });
    const back = await connectGoogleFromSettings(auth, cookie);

    expect(back.status).toBe(302);
    expect(back.location).toBe("/profile?tab=settings&google=connected");
    expect(providersOf(db)).toEqual(["credential", "google"]);
    expect(db.account.every((a) => a.userId === userId)).toBe(true);
    expect(db.session).toHaveLength(2);
    expect(await sessionFor(auth, cookie)).not.toBeNull();
    expect(await sessionFor(auth, otherDevice)).not.toBeNull();
    expect(back.noticeSet).toBe(false);
    // The password still works.
    await expect(
      auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } }),
    ).resolves.toBeTruthy();
  });

  it("still refuses a Google account with a different email", async () => {
    const { auth, db } = makeAuth();
    const { cookie } = await signUpWithPassword(auth);

    googleSays({ email: "someone.else@example.test", email_verified: true });
    const back = await connectGoogleFromSettings(auth, cookie);

    expect(back.location).toContain("error=");
    expect(providersOf(db)).toEqual(["credential"]);
  });
});

describe("a brand-new Google user", () => {
  it("is signed up as usual, with nothing taken away and no note", async () => {
    const { auth, db } = makeAuth();
    googleSays({ email: "new.person@example.test", email_verified: true });
    const back = await signInWithGoogle(auth);

    expect(back.location).toBe("/profile");
    expect(db.user).toHaveLength(1);
    expect(db.user[0].emailVerified).toBe(true);
    expect(providersOf(db)).toEqual(["google"]);
    expect(db.session).toHaveLength(1);
    expect(back.noticeSet).toBe(false);
  });

  it("can sign up even if Google hasn't confirmed their email", async () => {
    const { auth, db } = makeAuth();
    googleSays({ email: "new.person@example.test", email_verified: false });
    const back = await signInWithGoogle(auth);

    expect(back.location).toBe("/profile");
    expect(providersOf(db)).toEqual(["google"]);
    expect(db.user[0].emailVerified).toBe(false);
  });
});

describe("a different account is not touched", () => {
  it("leaves other people's passwords and sessions alone", async () => {
    const { auth, db } = makeAuth();
    await signUpWithPassword(auth);
    const other = await signUpWithPassword(auth, "someone.else@example.test");

    googleSays({ email: EMAIL, email_verified: true });
    await signInWithGoogle(auth);

    const otherUser = db.user.find(
      (u) => u.email === "someone.else@example.test",
    )!;
    expect(
      db.account
        .filter((a) => a.userId === otherUser.id)
        .map((a) => a.providerId),
    ).toEqual(["credential"]);
    expect(await sessionFor(auth, other.cookie)).not.toBeNull();
  });
});

describe("the real sign-in setup", () => {
  // These tests build their own better-auth from `googleLinkingOptions`. That
  // only means something if the real one is built from it too.
  const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");

  it("uses the same linking settings and hooks as these tests", () => {
    // Through signInRules, which joins them with the phone number rules so
    // neither replaces the other (convex/kenyanPhone.test.ts checks the join).
    expect(source).toContain("...signInRules");
    expect(
      readFileSync(new URL("./lib/signInRules.ts", import.meta.url), "utf8"),
    ).toContain("...googleLinkingOptions");
  });

  it("has no linking settings of its own that could differ", () => {
    expect(source).not.toMatch(/accountLinking/);
    expect(source).not.toMatch(/databaseHooks/);
  });
});
