import type { ProfileTab } from "./profile-tabs";

// What the "Sign-in methods" card decides, kept apart from the screen so it can
// be tested. A person can sign in with a password (better-auth calls that
// account "credential"; it is also what signing in with a phone number checks)
// and with Google. They can have either or both.

const SETTINGS_TAB: ProfileTab = "settings";

/** The profile, open on Settings. */
export const SETTINGS_PATH = `/profile?tab=${SETTINGS_TAB}`;

/** Where Google sends people back to once it is connected. */
export const GOOGLE_CONNECTED_PATH = `${SETTINGS_PATH}&google=connected`;

export const GOOGLE_PROVIDER = "google";
const PASSWORD_PROVIDER = "credential";

export interface LinkedAccount {
  providerId: string;
}

export interface SignInMethods {
  hasPassword: boolean;
  hasGoogle: boolean;
  /**
   * Google can only be disconnected while there is another way in. Without
   * one, disconnecting would lock the person out of their own account.
   */
  canDisconnectGoogle: boolean;
}

export function describeSignInMethods(
  accounts: readonly LinkedAccount[],
): SignInMethods {
  const hasGoogle = accounts.some((a) => a.providerId === GOOGLE_PROVIDER);
  const hasPassword = accounts.some((a) => a.providerId === PASSWORD_PROVIDER);
  const hasAnotherWayIn = accounts.some(
    (a) => a.providerId !== GOOGLE_PROVIDER,
  );
  return {
    hasPassword,
    hasGoogle,
    canDisconnectGoogle: hasGoogle && hasAnotherWayIn,
  };
}

// ---- Coming back from Google ----------------------------------------------

export type LinkReturn =
  { kind: "connected" } | { kind: "error"; message: string };

/**
 * What to tell the person about a failed connection. Only the error's code is
 * used, never any text from the address, because anyone can write an address.
 * (The code for a mismatched email is spelled two ways, by better-auth's
 * version.)
 */
export function linkErrorMessage(code: string): string {
  switch (code) {
    case "email_doesn't_match":
    case "email_does_not_match":
      return "That Google account uses a different email address from your GoUplift account. Choose the Google account that uses the same email address as your GoUplift account.";
    case "account_already_linked_to_different_user":
      return "That Google account is already connected to a different GoUplift account.";
    case "access_denied":
      return "You cancelled the connection with Google, so nothing was changed.";
    default:
      return "We couldn't connect Google. Please try again.";
  }
}

/**
 * Reads the address the person was sent back to. Null when it isn't a return
 * from Google at all.
 */
export function readLinkReturn(params: {
  get: (name: string) => string | null;
}): LinkReturn | null {
  const error = params.get("error");
  if (error) return { kind: "error", message: linkErrorMessage(error) };
  if (params.get("google") === "connected") return { kind: "connected" };
  return null;
}

// ---- Disconnecting --------------------------------------------------------

interface AuthError {
  code?: string;
  message?: string;
}

/**
 * Disconnecting needs a recent sign-in (a day or less), which better-auth
 * enforces. Someone who signed in longer ago has to sign in again first.
 */
export function needsFreshSignIn(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "SESSION_NOT_FRESH" || /not fresh/i.test(error.message ?? "")
  );
}

/** better-auth's own refusal to remove the last way into an account. */
export function isLastWayIn(error: AuthError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT" ||
    /last account/i.test(error.message ?? "")
  );
}
