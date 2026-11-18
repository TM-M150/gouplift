import { beforeEach, describe, expect, it, vi } from "vitest";

// The hooks ask better-auth whether this sign-in is someone connecting Google
// from Settings. Outside a real request there is no answer to ask for, so the
// tests supply one.
const getOAuthState = vi.fn();
vi.mock("better-auth/api", () => ({
  getOAuthState: () => getOAuthState(),
  // Wraps a function so better-auth can run it; here it is just the function.
  createAuthMiddleware: <T>(handler: T) => handler,
}));

import {
  afterRequest,
  beforeAccountCreated,
  googleVouchesFor,
  type AfterRequestContext,
  type LinkHookContext,
} from "./lib/googleAutoLink";
import { AUTH_NOTICE_COOKIE, GOOGLE_LINKED_NOTICE } from "../lib/auth-notices";

const EMAIL = "wanjiru@example.test";

function idToken(claims: unknown): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

const vouching = idToken({ email: EMAIL, email_verified: true });

interface Setup {
  user?: { id: string; email: string; emailVerified: boolean } | null;
  accounts?: Array<{ id: string; providerId: string }>;
  failOn?: "deleteAccount" | "deleteUserSessions";
}

/** A fake of what better-auth hands the hooks, recording what was done. */
function fakeContext(setup: Setup = {}) {
  const calls: string[] = [];
  const cookies: Array<{ name: string; value: string; options?: unknown }> = [];
  const user =
    setup.user === undefined
      ? { id: "u1", email: EMAIL, emailVerified: false }
      : setup.user;
  const accounts = setup.accounts ?? [{ id: "a-pw", providerId: "credential" }];
  const ctx: LinkHookContext = {
    context: {
      internalAdapter: {
        findUserById: async () => user,
        findAccounts: async () => accounts,
        deleteAccount: async (id) => {
          if (setup.failOn === "deleteAccount") throw new Error("boom");
          calls.push(`deleteAccount:${id}`);
        },
        deleteUserSessions: async (userId) => {
          if (setup.failOn === "deleteUserSessions") throw new Error("boom");
          calls.push(`deleteUserSessions:${userId}`);
        },
      },
    },
  };
  // What better-auth hands the hook that runs at the end of the same request:
  // the same request context, plus a way to add to the response.
  const end: AfterRequestContext = {
    context: ctx.context,
    setCookie: (name, value, options) => {
      cookies.push({ name, value, options });
    },
  };
  return { ctx, end, calls, cookies };
}

const google = { providerId: "google", userId: "u1", idToken: vouching };

beforeEach(() => {
  getOAuthState.mockReset();
  getOAuthState.mockResolvedValue({ callbackURL: "/profile" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("what Google has to say about the email", () => {
  it("vouches when the email is confirmed and is the account's", () => {
    expect(googleVouchesFor(EMAIL, vouching)).toBe(true);
  });

  it("ignores capital letters in the email", () => {
    expect(googleVouchesFor("Wanjiru@Example.Test", vouching)).toBe(true);
    expect(
      googleVouchesFor(
        EMAIL,
        idToken({ email: "WANJIRU@EXAMPLE.TEST", email_verified: true }),
      ),
    ).toBe(true);
  });

  it("does not vouch when Google hasn't confirmed the email", () => {
    expect(
      googleVouchesFor(EMAIL, idToken({ email: EMAIL, email_verified: false })),
    ).toBe(false);
    expect(googleVouchesFor(EMAIL, idToken({ email: EMAIL }))).toBe(false);
  });

  it("accepts the confirmed flag when it arrives as the word true", () => {
    expect(
      googleVouchesFor(
        EMAIL,
        idToken({ email: EMAIL, email_verified: "true" }),
      ),
    ).toBe(true);
    expect(
      googleVouchesFor(
        EMAIL,
        idToken({ email: EMAIL, email_verified: "false" }),
      ),
    ).toBe(false);
    expect(
      googleVouchesFor(EMAIL, idToken({ email: EMAIL, email_verified: 1 })),
    ).toBe(false);
  });

  it("does not vouch for a different email", () => {
    expect(
      googleVouchesFor(
        EMAIL,
        idToken({ email: "other@example.test", email_verified: true }),
      ),
    ).toBe(false);
    expect(googleVouchesFor(EMAIL, idToken({ email_verified: true }))).toBe(
      false,
    );
  });

  it("does not vouch for anything it can't read", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "not-a-token",
      "a.b.c",
      "a..c",
      `a.${btoa("null")}.c`,
      `a.${btoa('"text"')}.c`,
      `a.${btoa("[1,2]")}.c`,
    ]) {
      expect(googleVouchesFor(EMAIL, bad), String(bad)).toBe(false);
    }
  });

  it("reads a payload written in base64url, with dashes and underscores", () => {
    // Real tokens are written this way, and a reader that only knew ordinary
    // base64 would turn away every sign-in that happened to contain one.
    const token = idToken({
      email: EMAIL,
      email_verified: true,
      name: "Wanjiru Ñ>>??",
    });
    const payload = token.split(".")[1];
    expect(payload).toMatch(/-/);
    expect(payload).toMatch(/_/);
    expect(googleVouchesFor(EMAIL, token)).toBe(true);
  });

  it("reads a payload that needed padding and has non-ASCII in it", () => {
    // Base64 text without its "=" padding, as JWTs are written.
    const unpadded = idToken({
      email: EMAIL,
      email_verified: true,
      name: "Wanjiru",
      x: "ab",
    });
    expect(unpadded.split(".")[1]).not.toMatch(/=/);
    expect(googleVouchesFor(EMAIL, unpadded)).toBe(true);
  });
});

describe("before the Google account is stored", () => {
  it("removes the password first and then ends the sessions", async () => {
    const { ctx, calls } = fakeContext();
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual(["deleteAccount:a-pw", "deleteUserSessions:u1"]);
  });

  it("removes every password the account has", async () => {
    const { ctx, calls } = fakeContext({
      accounts: [
        { id: "a-pw", providerId: "credential" },
        { id: "a-pw2", providerId: "credential" },
      ],
    });
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual([
      "deleteAccount:a-pw",
      "deleteAccount:a-pw2",
      "deleteUserSessions:u1",
    ]);
  });

  it("only removes passwords, not other ways in", async () => {
    const { ctx, calls } = fakeContext({
      accounts: [
        { id: "a-pw", providerId: "credential" },
        { id: "a-other", providerId: "github" },
      ],
    });
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual(["deleteAccount:a-pw", "deleteUserSessions:u1"]);
  });

  it("still ends the sessions when there is no password to remove", async () => {
    const { ctx, calls } = fakeContext({
      accounts: [{ id: "a-other", providerId: "github" }],
    });
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual(["deleteUserSessions:u1"]);
  });

  it("stops the link if the password can't be removed, and ends nothing", async () => {
    const { ctx, calls } = fakeContext({ failOn: "deleteAccount" });
    await expect(beforeAccountCreated(google, ctx)).rejects.toThrow("boom");
    expect(calls).toEqual([]);
  });

  it("stops the link if the sessions can't be ended", async () => {
    const { ctx } = fakeContext({ failOn: "deleteUserSessions" });
    await expect(beforeAccountCreated(google, ctx)).rejects.toThrow("boom");
  });

  it("stops the link, and touches nothing, if Google hasn't confirmed the email", async () => {
    const { ctx, calls } = fakeContext();
    const unconfirmed = idToken({ email: EMAIL, email_verified: false });
    await expect(
      beforeAccountCreated({ ...google, idToken: unconfirmed }, ctx),
    ).rejects.toThrow(/not confirmed/);
    await expect(
      beforeAccountCreated({ ...google, idToken: null }, ctx),
    ).rejects.toThrow(/not confirmed/);
    expect(calls).toEqual([]);
  });

  it("stops the link if better-auth can't say how the sign-in began", async () => {
    getOAuthState.mockRejectedValue(new Error("no request state"));
    const { ctx, calls } = fakeContext();
    await expect(beforeAccountCreated(google, ctx)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("does nothing for an account whose email was already confirmed", async () => {
    const { ctx, calls } = fakeContext({
      user: { id: "u1", email: EMAIL, emailVerified: true },
    });
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual([]);
  });

  it("still needs Google to confirm the email for such an account", async () => {
    const { ctx } = fakeContext({
      user: { id: "u1", email: EMAIL, emailVerified: true },
    });
    await expect(
      beforeAccountCreated(
        {
          ...google,
          idToken: idToken({ email: EMAIL, email_verified: false }),
        },
        ctx,
      ),
    ).rejects.toThrow(/not confirmed/);
  });

  it("does nothing for someone connecting Google from Settings", async () => {
    getOAuthState.mockResolvedValue({
      callbackURL: "/profile",
      link: { email: EMAIL, userId: "u1" },
    });
    const { ctx, calls } = fakeContext();
    // Even a statement that doesn't vouch: that path has its own checks.
    await beforeAccountCreated({ ...google, idToken: null }, ctx);
    expect(calls).toEqual([]);
  });

  it("treats a sign-in with no recorded start as a plain sign-in", async () => {
    // Signing in with a Google token directly (no redirect) has no saved state.
    getOAuthState.mockResolvedValue(null);
    const { ctx, calls } = fakeContext();
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual(["deleteAccount:a-pw", "deleteUserSessions:u1"]);
  });

  it("does nothing for a brand-new user", async () => {
    const { ctx, calls } = fakeContext({ accounts: [] });
    await beforeAccountCreated({ ...google, idToken: null }, ctx);
    expect(calls).toEqual([]);
  });

  it("does nothing when the user can't be found", async () => {
    const { ctx, calls } = fakeContext({ user: null });
    await beforeAccountCreated(google, ctx);
    expect(calls).toEqual([]);
  });

  it("does nothing for any account that isn't Google", async () => {
    const { ctx, calls } = fakeContext();
    await beforeAccountCreated(
      { providerId: "credential", userId: "u1", idToken: null },
      ctx,
    );
    await beforeAccountCreated({ ...google, providerId: "github" }, ctx);
    expect(calls).toEqual([]);
    expect(getOAuthState).not.toHaveBeenCalled();
  });

  it("does nothing outside a sign-in request", async () => {
    await expect(beforeAccountCreated(google, null)).resolves.toBeUndefined();
  });
});

describe("at the end of the request", () => {
  it("leaves the note, once, for a sign-in that removed a password", async () => {
    const { ctx, end, cookies } = fakeContext();
    await beforeAccountCreated(google, ctx);
    await afterRequest(end);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(AUTH_NOTICE_COOKIE);
    expect(cookies[0].value).toBe(GOOGLE_LINKED_NOTICE);
    expect(cookies[0].options).toMatchObject({
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "lax",
    });

    await afterRequest(end);
    expect(cookies).toHaveLength(1);
  });

  it("leaves no note when nothing was removed", async () => {
    const verified = fakeContext({
      user: { id: "u1", email: EMAIL, emailVerified: true },
    });
    await beforeAccountCreated(google, verified.ctx);
    await afterRequest(verified.end);
    expect(verified.cookies).toEqual([]);

    const fresh = fakeContext({ accounts: [] });
    await beforeAccountCreated(google, fresh.ctx);
    await afterRequest(fresh.end);
    expect(fresh.cookies).toEqual([]);
  });

  it("leaves no note after a link that was stopped", async () => {
    const { ctx, end, cookies } = fakeContext({ failOn: "deleteUserSessions" });
    await beforeAccountCreated(google, ctx).catch(() => {});
    await afterRequest(end);
    expect(cookies).toEqual([]);
  });

  it("leaves no note for a request that had nothing to do with signing in", async () => {
    const { end, cookies } = fakeContext();
    await afterRequest(end);
    expect(cookies).toEqual([]);
  });

  it("does not carry a note from one request to another", async () => {
    const first = fakeContext();
    const second = fakeContext();
    await beforeAccountCreated(google, first.ctx);
    await afterRequest(second.end);
    expect(second.cookies).toEqual([]);
    // The first request's note is still waiting for its own end.
    await afterRequest(first.end);
    expect(first.cookies).toHaveLength(1);
  });

  it("never lets a problem with the note break signing in", async () => {
    const { ctx, end } = fakeContext();
    end.setCookie = () => {
      throw new Error("headers already sent");
    };
    await beforeAccountCreated(google, ctx);
    await expect(afterRequest(end)).resolves.toBeUndefined();
  });
});
