// Confirming an email address: the words, and the address the link in the email
// comes back to. Shared by the server (which refuses a withdrawal until the
// address is confirmed), the sign-up page and the pages that show the result.
//
// Confirmation is "soft": people can sign in and use GoUplift before they have
// confirmed. Only moving money out (asking for a payout, or adding or changing
// the account it goes to) waits for it.

import { safeNextPath } from "./safe-redirect";

/** Where the link in the email lands, whether or not it worked. */
export const EMAIL_CONFIRMED_PATH = "/email-confirmed";

/** What the server says when a withdrawal needs a confirmed email. */
export const EMAIL_NOT_CONFIRMED_MESSAGE =
  "Please confirm your email address first. We sent you a link when you signed up. If you can't find it, choose “Send again” in the banner at the top of the page.";

/**
 * better-auth only follows a relative callback address if it looks like this:
 * word characters, a few path symbols, and a query made of a short list of
 * characters. Anything else is refused with "Invalid callbackURL", which at
 * sign-up would stop the account being made at all. This is better-auth's own
 * pattern (trusted-origins), kept here so a test can hold every address we
 * build to it.
 */
export const BETTER_AUTH_RELATIVE_CALLBACK =
  /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

/**
 * encodeURIComponent leaves ! ~ * ' ( ) as they are, and better-auth's pattern
 * does not accept them in a query. Writing them as %XX makes the same text safe.
 */
function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!~*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The address the confirmation link sends people to afterwards, carrying
 * `next` (where they were headed) when it is a safe path on this site, and
 * nothing when it isn't. Everything in `next` is written as %XX where it could
 * be anything but a letter, digit, - _ or ., so the result is always an address
 * better-auth accepts (the tests hold it to that, and sign-up is run against
 * the real thing).
 */
export function confirmationCallbackURL(next?: string | null): string {
  const safe = safeNextPath(next, "");
  if (!safe) return EMAIL_CONFIRMED_PATH;
  return `${EMAIL_CONFIRMED_PATH}?next=${strictEncode(safe)}`;
}

export type ConfirmationResult =
  | { status: "confirmed"; title: string; message: string }
  | {
      status: "problem";
      title: string;
      message: string;
      /** Worth offering a new link: the old one is no use. */
      canResend: boolean;
    };

/**
 * What to show for the `error` code better-auth adds to the address when a
 * confirmation link doesn't work, or for no code, which means it did. The words
 * are fixed: nothing from the address is ever shown, because anyone can type
 * anything into an address.
 */
export function confirmationResult(
  code: string | null | undefined,
): ConfirmationResult {
  const clean = code?.trim().toLowerCase();
  if (!clean) {
    return {
      status: "confirmed",
      title: "Email confirmed",
      message:
        "Thank you. Your email address is confirmed, so you can now request withdrawals and add payout accounts.",
    };
  }

  switch (clean) {
    case "token_expired":
      return {
        status: "problem",
        title: "That link has expired",
        message:
          "Confirmation links work for 24 hours. You can ask for a new one.",
        canResend: true,
      };

    case "invalid_token":
      return {
        status: "problem",
        title: "That link isn't valid",
        message:
          "It may have been copied in part, or replaced by a newer email. You can ask for a new one.",
        canResend: true,
      };

    case "user_not_found":
      return {
        status: "problem",
        title: "We couldn't find that account",
        message:
          "The account this link was made for may have been deleted. You can create a new account from the sign-up page.",
        canResend: false,
      };

    default:
      return {
        status: "problem",
        title: "We couldn't confirm your email",
        message:
          "Something went wrong with that link. You can ask for a new one.",
        canResend: true,
      };
  }
}
