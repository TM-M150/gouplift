import { createAuthMiddleware, getOAuthState } from "better-auth/api";
import {
  AUTH_NOTICE_COOKIE,
  AUTH_NOTICE_MAX_AGE_SECONDS,
  GOOGLE_LINKED_NOTICE,
} from "../../lib/auth-notices";

// Signing in with Google to an account that was made with an email and a
// password.
//
// Why this needs care: GoUplift has never confirmed that an email address
// belongs to whoever typed it at sign-up. So anyone could have made an account
// with somebody else's email address and a password they chose. If we simply
// joined Google to that account when its real owner signed in with Google, the
// person who made the account would still know its password and still be signed
// in on their own devices: they would own a way into the real owner's account.
//
// So when Google proves who someone is, and the account it matches has never
// had its email confirmed, we link it, but first we remove the account's
// password and sign out every other device. Whoever set that password, however
// long ago, is out. The owner uses Google from then on, and "Forgot password"
// (which goes to their inbox) if they want a password again. Nothing is done to
// an account whose email was already confirmed, and nothing to someone who is
// already signed in and connects Google from Settings.
//
// The clean-up runs as a database hook, just before better-auth stores the new
// Google account, so a failure there stops the link rather than leaving the old
// password in place.

const GOOGLE_PROVIDER = "google";
const PASSWORD_PROVIDER = "credential";

/** What the hooks read of the account about to be stored. */
export interface NewAccount {
  providerId: string;
  userId: string;
  /** Google's signed statement of who signed in (a JWT), when it sent one. */
  idToken?: string | null;
}

/** The part of better-auth's request context the database hook uses. */
export interface LinkHookContext {
  context: {
    internalAdapter: {
      findUserById(
        userId: string,
      ): Promise<{ id: string; email: string; emailVerified: boolean } | null>;
      findAccounts(
        userId: string,
      ): Promise<Array<{ id: string; providerId: string }>>;
      deleteAccount(id: string): Promise<void>;
      deleteUserSessions(userId: string): Promise<void>;
    };
  };
}

/** The part of better-auth's request context the after-request hook uses. */
export interface AfterRequestContext {
  context: object;
  setCookie(
    name: string,
    value: string,
    options?: {
      path?: string;
      maxAge?: number;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "lax" | "strict" | "none";
    },
  ): unknown;
}

/**
 * Whether Google's statement of who signed in says this email address is the
 * person's own. Google signs a statement that carries the address and whether
 * Google has confirmed it. It arrives straight from Google's server over TLS,
 * so better-auth reads it without checking the signature too, and so do we.
 */
export function googleVouchesFor(
  email: string,
  idToken: string | null | undefined,
): boolean {
  if (!idToken) return false;
  const payload = idToken.split(".")[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims: unknown = JSON.parse(atob(padded));
    if (typeof claims !== "object" || claims === null) return false;
    const { email: claimed, email_verified: verified } = claims as {
      email?: unknown;
      email_verified?: unknown;
    };
    return (
      typeof claimed === "string" &&
      claimed.toLowerCase() === email.toLowerCase() &&
      (verified === true || verified === "true")
    );
  } catch {
    return false;
  }
}

/**
 * The requests that removed a password and ended other sessions, so the
 * after-request hook knows to leave the person a message. Keyed by the
 * request's own copy of better-auth's context, which is made fresh for each
 * request, so a mark can't carry over to someone else's.
 */
const cleanedUp = new WeakSet<object>();

/**
 * Runs just before a Google account is stored. Throwing here stops the link
 * (better-auth reports it as "unable to link account").
 */
export async function beforeAccountCreated(
  account: NewAccount,
  ctx: LinkHookContext | null,
): Promise<void> {
  if (account.providerId !== GOOGLE_PROVIDER || !ctx) return;

  // Connecting Google from Settings: the person is already signed in, so they
  // have shown the account is theirs. That path is better-auth's own, and the
  // card in Settings says the password keeps working.
  const state = await getOAuthState();
  if (state?.link) return;

  const { internalAdapter } = ctx.context;
  const user = await internalAdapter.findUserById(account.userId);
  const accounts = await internalAdapter.findAccounts(account.userId);
  // A brand-new Google user has nothing yet to protect.
  if (!user || accounts.length === 0) return;

  // Google is being used to get into an account that already exists. Only go
  // ahead if Google says the email is confirmed and is this account's.
  if (!googleVouchesFor(user.email, account.idToken)) {
    console.warn("Google sign-in refused: Google did not confirm the email.", {
      userId: user.id,
    });
    throw new Error("Google has not confirmed this email address.");
  }

  // An account whose email was confirmed already: nothing to take away.
  if (user.emailVerified) return;

  // The password first, so nobody can sign in with it from now on, then every
  // session, so nobody who already did stays in. If either step fails this
  // throws and the link doesn't happen.
  for (const password of accounts.filter(
    (a) => a.providerId === PASSWORD_PROVIDER,
  )) {
    await internalAdapter.deleteAccount(password.id);
  }
  await internalAdapter.deleteUserSessions(user.id);

  console.log(
    "Google linked to an account with an unconfirmed email: password removed, other sessions ended.",
    { userId: user.id },
  );
  cleanedUp.add(ctx.context);
}

/**
 * Runs at the end of a request. If that request removed a password, leaves a
 * short-lived note so the page the person lands on can say what happened. It
 * has to be done here rather than where the password is removed, because only
 * here does better-auth let us add to the response. A problem with the note
 * never gets in the way of signing in.
 */
export async function afterRequest(ctx: AfterRequestContext): Promise<void> {
  if (!cleanedUp.delete(ctx.context)) return;
  try {
    ctx.setCookie(AUTH_NOTICE_COOKIE, GOOGLE_LINKED_NOTICE, {
      path: "/",
      maxAge: AUTH_NOTICE_MAX_AGE_SECONDS,
      secure: true,
      httpOnly: false,
      sameSite: "lax",
    });
  } catch (error) {
    console.warn("Could not leave the Google-connected note.", error);
  }
}

/**
 * The linking settings and hooks, in one place so the real sign-in setup and
 * its tests can't drift apart.
 */
export const googleLinkingOptions = {
  account: {
    accountLinking: {
      enabled: true,
      // Lets people connect Google from Settings even though their email was
      // never confirmed (see the card in Settings).
      trustedProviders: ["google"],
      // better-auth won't link Google to an account whose email was never
      // confirmed unless told it may. Every older GoUplift account is in that
      // position, so we tell it, and the hooks above make that safe. (This
      // option is marked for removal in better-auth's next minor version, and
      // package.json keeps us on 1.6. After an upgrade, if Google stops linking,
      // this is the place to look.)
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    account: {
      create: {
        before: beforeAccountCreated,
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(afterRequest),
  },
};
