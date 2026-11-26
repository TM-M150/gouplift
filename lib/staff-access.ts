// Who may use a staff role (moderator or admin) right now. A role is granted by
// hand, and on its own it is not enough: the account's email address must be
// confirmed, and, once GoUplift has company mailboxes, it must be a company
// address. Kept apart from the Convex code that applies it so the rules can be
// tested without a database. See convex/lib/staff.ts.
//
// Why a role alone isn't enough: nothing yet stops someone signing up with an
// address they don't own, so an address on the company domain only means
// something if it has been confirmed, and a staff account that was set up with
// an address nobody confirmed could belong to anyone.

/** Why a person's staff role can't be used right now. */
export type StaffAccessBlock =
  "EMAIL_NOT_CONFIRMED" | "EMAIL_DOMAIN_NOT_ALLOWED";

/** What a blocked staff member is told. Only people with a staff role see it. */
export const STAFF_BLOCK_MESSAGES: Record<StaffAccessBlock, string> = {
  EMAIL_NOT_CONFIRMED:
    "Confirm your email address to use the admin area. Check your inbox for the confirmation email.",
  EMAIL_DOMAIN_NOT_ALLOWED:
    "The admin area needs a GoUplift company email address. Ask an admin to move your role to your company account.",
};

/**
 * The company email domains that staff must use. `enforced` is false when the
 * setting is empty, which is how it stays until the company mailboxes exist.
 */
export interface StaffEmailRule {
  enforced: boolean;
  domains: string[];
}

// A plain domain name such as gouplift.co.ke: letters, digits and hyphens in
// labels, at least two labels. No "@", no spaces, no wildcard, no "https://".
const DOMAIN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Reads the STAFF_EMAIL_DOMAINS setting: domains separated by commas, spaces
 * or semicolons, in any case, with or without a leading "@".
 *
 * Empty or unset means the rule is off. A setting that is there but holds no
 * usable domain (a typo such as "gouplift" or "*.gouplift.co.ke") is ON with
 * nothing allowed, so a mistake locks staff out, which is fixed by correcting
 * the setting, instead of quietly switching the protection off.
 */
export function staffEmailRule(raw: string | null | undefined): StaffEmailRule {
  if (!raw || !raw.trim()) return { enforced: false, domains: [] };
  const domains = raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter((entry) => DOMAIN.test(entry));
  return { enforced: true, domains: [...new Set(domains)] };
}

/**
 * The part of an email address after the "@", lower-cased. Nothing for text
 * that is not a single address ("a@b@c.com", "no-at-sign", "@x.com").
 */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at < 1 || at !== clean.lastIndexOf("@")) return null;
  return clean.slice(at + 1) || null;
}

/**
 * Whether an account with this address may hold or use a staff role, or what
 * stops it. The domain must match exactly: a subdomain
 * (mail.gouplift.co.ke) or a look-alike (gouplift.co.ke.example.com,
 * notgouplift.co.ke) is not the company domain.
 */
export function staffAccessBlock(input: {
  email: string | null | undefined;
  emailConfirmed: boolean;
  rule: StaffEmailRule;
}): StaffAccessBlock | null {
  if (input.rule.enforced) {
    const domain = emailDomain(input.email);
    if (!domain || !input.rule.domains.includes(domain)) {
      return "EMAIL_DOMAIN_NOT_ALLOWED";
    }
  }
  if (!input.emailConfirmed) return "EMAIL_NOT_CONFIRMED";
  return null;
}
