// Where to send someone once they have signed in or signed up. The sign-in page
// takes it from the address (?next=/fundraiser/abc#comments), and anyone can
// write that address, so it is only ever followed if it is a path on this site.
// Anything else (another website, a script, a loop back into the sign-in pages)
// quietly falls back to the profile.

export const AFTER_SIGN_IN_DEFAULT = "/profile";

const MAX_LENGTH = 500;

/** Pages that make no sense to land on after signing in. */
const AUTH_PAGES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
];

// Only used to read the path; the host never leaves this file.
const BASE = "https://same-site.invalid";

/**
 * Backslashes and control characters, which browsers read as something else:
 * "/\evil.com" and "/<tab>/evil.com" both become "//evil.com". A loop rather
 * than a pattern, so the characters never need writing out in a regex.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/** The path to go to, or the fallback if what was asked for isn't a safe one. */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = AFTER_SIGN_IN_DEFAULT,
): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) {
    return fallback;
  }
  // A path on this site starts with exactly one slash.
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (hasUnsafeCharacter(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  if (
    AUTH_PAGES.some(
      (page) => url.pathname === page || url.pathname.startsWith(`${page}/`),
    )
  ) {
    return fallback;
  }

  // Read the result back rather than the input: tidying the path can change
  // what it is ("/.//evil.com" becomes "//evil.com").
  const result = `${url.pathname}${url.search}${url.hash}`;
  return result.startsWith("//") ? fallback : result;
}

function authHref(
  page: "/sign-in" | "/sign-up",
  next: string | null | undefined,
) {
  const safe = safeNextPath(next, "");
  return safe ? `${page}?next=${encodeURIComponent(safe)}` : page;
}

/** The sign-in page, set to come back to `next` afterwards. */
export function signInHref(next: string | null | undefined): string {
  return authHref("/sign-in", next);
}

/** The sign-up page, set to come back to `next` afterwards. */
export function signUpHref(next: string | null | undefined): string {
  return authHref("/sign-up", next);
}
