// What to tell someone who comes back to /sign-in after Google didn't sign them
// in. better-auth sends them back with `?error=<code>`; this turns the code into
// words. The words are fixed: nothing from the address (the code itself, or the
// `error_description` that can ride along) is ever shown, because anyone can
// type anything into an address.

export type SignInNoticeTone = "error" | "info";

export interface SignInNotice {
  /**
   * "info" is for something the person chose to do (they cancelled), where red
   * would read as an accusation. "error" is for everything that went wrong.
   */
  tone: SignInNoticeTone;
  /** One short line: what happened. */
  title: string;
  /** What to do next. */
  message: string;
}

const TRY_ANOTHER_WAY = "sign in with your email or phone number";

/**
 * The notice for the `error` code on the sign-in address, or null when there
 * is no code (the ordinary visit).
 */
export function signInErrorNotice(
  code: string | null | undefined,
): SignInNotice | null {
  const clean = code?.trim().toLowerCase();
  if (!clean) return null;

  switch (clean) {
    // Google's account has the same email as a GoUplift account that was made
    // with a password. better-auth won't join them on its own, because we have
    // never confirmed that email address belongs to whoever made the account.
    case "account_not_linked":
      return {
        tone: "error",
        title: "You already have a GoUplift account with this email",
        message:
          "Sign in with your email and password below. Once you're in, you can connect Google in Settings, under Sign-in methods, and use it next time. If you've forgotten your password, choose “Forgot password?”.",
      };

    // They pressed Cancel (or Deny) on Google's screen.
    case "access_denied":
      return {
        tone: "info",
        title: "You cancelled signing in with Google",
        message: `Nothing was changed. You can try again, or ${TRY_ANOTHER_WAY}.`,
      };

    // The sign-in was started in one place and finished in another (a link
    // opened in a different browser or an in-app browser), or it took too long.
    case "state_not_found":
    case "state_invalid":
    case "state_mismatch":
      return {
        tone: "error",
        title: "That Google sign-in couldn't be completed",
        message:
          "It may have expired, or been opened in a different browser or app from the one you started in. Please try again from this page.",
      };

    case "email_not_found":
      return {
        tone: "error",
        title: "Google didn't share an email address with us",
        message: `We need one to find or create your account. Please try again, or ${TRY_ANOTHER_WAY}.`,
      };

    default:
      return {
        tone: "error",
        title: "We couldn't sign you in with Google",
        message: `Please try again, or ${TRY_ANOTHER_WAY}.`,
      };
  }
}
