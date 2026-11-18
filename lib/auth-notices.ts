// A one-time message the sign-in system leaves for the next page, in a short
// cookie. It exists for the moment Google is connected to an older account
// during sign-in: the person lands on whatever page they were heading to, and
// is told what just happened there.
//
// The cookie only names the message. The words are ours, below, and a cookie
// value we don't recognise shows nothing.

export const AUTH_NOTICE_COOKIE = "gouplift_notice";

/** Google was connected to an existing account while signing in. */
export const GOOGLE_LINKED_NOTICE = "google_linked";

/** Long enough to get through the redirect, short enough not to linger. */
export const AUTH_NOTICE_MAX_AGE_SECONDS = 300;

export interface AuthNotice {
  title: string;
  message: string;
}

const NOTICES: Record<string, AuthNotice> = {
  [GOOGLE_LINKED_NOTICE]: {
    title: "Google is now connected",
    message:
      "You can now sign in with Google. For your security, we removed your old password and signed out any other devices. To use a password or your phone number to sign in again, choose “Forgot password?” on the sign-in page and set a new one.",
  },
};

/** Finds a cookie's value in the text of `document.cookie`. */
function cookieValue(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** The message waiting in the cookies, or null when there isn't one. */
export function authNoticeFromCookies(cookies: string): AuthNotice | null {
  const value = cookieValue(cookies, AUTH_NOTICE_COOKIE);
  if (value === null) return null;
  return Object.prototype.hasOwnProperty.call(NOTICES, value)
    ? NOTICES[value]
    : null;
}

/** The text to assign to `document.cookie` to remove the message. */
export function clearAuthNoticeCookie(): string {
  return `${AUTH_NOTICE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}
