import { z } from "zod";

// Webhook URLs are supplied by organizations and then called by our servers,
// so a careless one could point GoUplift at somewhere it shouldn't go (a
// service inside a private network, a cloud metadata address). This check is
// shared by the server (the authority) and the form (early feedback).
//
// What it can't do: look up DNS. A public-looking name that resolves to a
// private address passes here. That is why deliveries also refuse redirects
// and never store or show what the receiving server answered.

export const WEBHOOK_URL_MAX_LENGTH = 2048;

// Names that only ever mean "somewhere inside a network".
const INTERNAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".lan",
  ".corp",
  ".home",
  ".localdomain",
  ".home.arpa",
];

export type WebhookUrlCheck =
  | { ok: true; url: string }
  | { ok: false; message: string };

function reject(message: string): WebhookUrlCheck {
  return { ok: false, message };
}

export function checkWebhookUrl(raw: string): WebhookUrlCheck {
  const input = raw.trim();
  if (!input) return reject("Enter the URL that should receive events.");
  if (input.length > WEBHOOK_URL_MAX_LENGTH) {
    return reject(`The URL must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.`);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return reject("Enter a valid URL, including https://");
  }

  if (url.protocol !== "https:") {
    return reject("The URL must start with https://");
  }
  if (url.username || url.password) {
    return reject("Remove the username and password from the URL.");
  }
  // The default port is dropped by the URL parser, so a port here is custom.
  if (url.port) {
    return reject("Use the standard HTTPS port; custom ports aren't supported.");
  }

  // The parser has already normalised the host: obfuscated addresses such as
  // 2130706433 or 0x7f.1 arrive here as dotted numbers, and IPv6 keeps its
  // brackets.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (host.startsWith("[") || host.includes(":")) {
    return reject("Use a domain name, not an IP address.");
  }
  if (/^\d+(\.\d+)*$/.test(host)) {
    return reject("Use a domain name, not an IP address.");
  }
  if (!host.includes(".")) {
    return reject("Use a public domain name, like hooks.example.org.");
  }
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return reject("This address only works inside a private network.");
  }

  return { ok: true, url: url.href };
}

export const webhookUrlSchema = z.string().transform((value, ctx) => {
  const checked = checkWebhookUrl(value);
  if (!checked.ok) {
    ctx.addIssue({ code: "custom", message: checked.message });
    return z.NEVER;
  }
  return checked.url;
});
