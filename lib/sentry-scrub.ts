// What is taken out of an error report before it leaves our servers or the
// visitor's browser for Sentry. An error message can quote what it choked on
// (a phone number, an email address), and some page addresses carry a private
// link token, so this runs on every event and breadcrumb as a second line of
// defence behind the data collection settings in lib/sentry.ts.
//
// This file runs in browsers, so no lookbehind patterns (older Safari versions
// fail to parse them, and a script that fails to parse takes the whole bundle
// with it).

import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// A Kenyan mobile number as people write it (0712 345 678, +254712345678), or
// any number that starts with a plus sign. It must not start in the middle of
// a word, so an id such as ws_CO_0712345678 (which is what finds a payment in
// the provider's dashboard) is left alone. The character before it is kept.
const KENYAN_NUMBER =
  /(^|[^\w])(?:\+?254|0)[\s-]?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/g;
const INTERNATIONAL_NUMBER = /(^|[^\w])\+\d[\d\s-]{8,14}\d(?!\d)/g;

export function scrubText(text: string): string {
  return text
    .replace(EMAIL_ADDRESS, "[email]")
    .replace(KENYAN_NUMBER, "$1[number]")
    .replace(INTERNATIONAL_NUMBER, "$1[number]");
}

// Addresses that contain a private token: the comment link in a receipt, the
// two unsubscribe links in emails, and the password reset link (the sign-in
// service's own address, before it sends the person on to our reset page).
// Anyone holding the address can act as that person.
const TOKEN_IN_PATH = [
  /(\/comment\/)[^/?#]+/g,
  /(\/reset-password\/)[^/?#]+/g,
  /(\/unsubscribe\/comments\/)[^/?#]+/g,
  // "/unsubscribe/comments/..." is the other kind, handled above.
  /(\/unsubscribe\/)(?!comments(?:[/?#]|$))[^/?#]+/g,
];

/** A page address without what follows a "?" or "#", and without tokens. */
export function scrubUrl(url: string): string {
  let result = url.split("#")[0].split("?")[0];
  for (const pattern of TOKEN_IN_PATH) {
    result = result.replace(pattern, "$1[token]");
  }
  return result;
}

// An error message can quote the token of the page it happened on (an
// invalid-value error repeats what it was given), and the pattern above only
// knows addresses. So the tokens are read out of the page address and hidden
// wherever else they turn up. Too short a string would also hide ordinary words.
const MIN_TOKEN_LENGTH = 8;

function privateTokens(url: string | undefined): string[] {
  if (!url) return [];
  const [beforeHash] = url.split("#");
  const [path, query = ""] = beforeHash.split("?");
  const found = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    found.add(value);
    try {
      found.add(decodeURIComponent(value));
    } catch {
      // Not valid percent-encoding; the raw text is already in the set.
    }
  };
  for (const pattern of TOKEN_IN_PATH) {
    for (const match of path.matchAll(pattern)) {
      add(match[0].slice(match[1].length));
    }
  }
  add(new URLSearchParams(query).get("token"));
  return [...found].filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

function hideTokens(text: string, tokens: string[]): string {
  let result = text;
  for (const token of tokens) result = result.split(token).join("[token]");
  return result;
}

const REMOVED_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "x-forwarded-for",
  "x-real-ip",
]);
const URL_HEADERS = new Set(["referer", "referrer", "origin"]);

function scrubBreadcrumbWith(
  breadcrumb: Breadcrumb,
  tokens: string[],
): Breadcrumb {
  if (breadcrumb.message) {
    breadcrumb.message = hideTokens(scrubText(breadcrumb.message), tokens);
  }
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = scrubUrl(data[key]);
    }
    // What was passed to console.log can be anything, a whole user included.
    if (breadcrumb.category === "console") delete data.arguments;
  }
  return breadcrumb;
}

// Sentry calls this with a second argument (a hint), so it takes just one.
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubBreadcrumbWith(breadcrumb, []);
}

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  delete event.user;

  const tokens = privateTokens(event.request?.url);
  const clean = (text: string) => hideTokens(scrubText(text), tokens);

  if (event.message) event.message = clean(event.message);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = clean(exception.value);
  }

  const request = event.request;
  if (request) {
    if (request.url) request.url = scrubUrl(request.url);
    delete request.query_string;
    delete request.cookies;
    delete request.data;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        const lower = name.toLowerCase();
        if (REMOVED_HEADERS.has(lower)) {
          delete request.headers[name];
        } else if (URL_HEADERS.has(lower)) {
          request.headers[name] = scrubUrl(request.headers[name]);
        }
      }
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    scrubBreadcrumbWith(breadcrumb, tokens);
  }
  return event;
}
