// What a visitor to a fundraiser sees of the donations made to it: the latest
// few, each as a name, an amount and when. Kept here, apart from the Convex
// query and the components that show it, so the rules (who is named, what
// counts as "latest", what is new since the page loaded) can be tested without
// a database or a browser. It is used by both the server and the browser.

import { ANONYMOUS_DONOR_NAME } from "./comments";
import { publicAuthorName } from "./testimonials";

/** How many of the latest donations are shown. */
export const RECENT_DONATIONS_SHOWN = 3;

/**
 * How many of the most recently started completed donations the server looks
 * at to find the latest ones. A donation counts from when it was paid, not
 * when it was started, and the two are minutes apart at most, so a few more
 * than are shown is enough to put them in the right order.
 */
export const RECENT_DONATIONS_WINDOW = 10;

/** The longest name kept, in characters. */
export const MAX_DONOR_NAME_LENGTH = 50;

/** Shown for a donation whose donor gave no name. */
export const UNNAMED_DONOR_NAME = "Someone";

// An email address, a phone number or a web address typed where a name goes.
// A name is shown to everyone who opens the fundraiser, so these are refused
// rather than shown. Five digits is a phone number; a year or a house number
// has fewer.
function looksLikeContactDetail(text: string): boolean {
  if (text.includes("@")) return true;
  if (/(https?:|www\.)/i.test(text)) return true;
  return text.replace(/\D/g, "").length >= 5;
}

/**
 * The name a donor typed, tidied for storing: control characters and extra
 * spaces gone, cut to MAX_DONOR_NAME_LENGTH. Nothing (undefined) when there is
 * no name, or when it is really an email address, a phone number or a web
 * address.
 */
export function normalizeDonorName(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  const tidy = raw
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!tidy || looksLikeContactDetail(tidy)) return undefined;
  const kept = Array.from(tidy).slice(0, MAX_DONOR_NAME_LENGTH).join("").trim();
  return kept || undefined;
}

/**
 * How a donor is named in public, the same way a comment names its author:
 * first name and the initial of the last one ("Wanjiru Kamau" is "Wanjiru
 * K."), never the full name. "Anonymous donor" for an anonymous gift, and
 * "Someone" when no name was given. A name is only ever the one the donor
 * typed on the donate form, never one looked up from their account.
 */
export function publicDonorName(donation: {
  isAnonymous: boolean;
  donorName?: string | null;
}): string {
  if (donation.isAnonymous) return ANONYMOUS_DONOR_NAME;
  const name = normalizeDonorName(donation.donorName);
  return name ? publicAuthorName(name) : UNNAMED_DONOR_NAME;
}

/**
 * The latest donations, newest first: by when they were paid, or when they
 * were started if that wasn't recorded. Donations paid at the same moment
 * stay in the order they came in.
 */
export function latestDonations<
  T extends { completedAt?: number; createdAt: number },
>(donations: readonly T[], count: number = RECENT_DONATIONS_SHOWN): T[] {
  return donations
    .map((donation, position) => ({ donation, position }))
    .sort(
      (a, b) =>
        (b.donation.completedAt ?? b.donation.createdAt) -
          (a.donation.completedAt ?? a.donation.createdAt) ||
        a.position - b.position,
    )
    .slice(0, count)
    .map(({ donation }) => donation);
}

/**
 * Which donations have appeared since the last time this was called. The
 * first result (`seen` is null) is what was already there when the page
 * opened, so nothing in it is new. Pass the returned `seen` back in next time.
 */
export function trackNewDonations<T extends { id: string }>(
  seen: ReadonlySet<string> | null,
  items: readonly T[],
): { seen: Set<string>; fresh: T[] } {
  const next = new Set(items.map((item) => item.id));
  if (!seen) return { seen: next, fresh: [] };
  // Everything ever seen stays seen, so a donation is never announced twice.
  for (const id of seen) next.add(id);
  return { seen: next, fresh: items.filter((item) => !seen.has(item.id)) };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "2 hr ago", "yesterday", "3 wk ago". */
export function timeAgo(at: number, now: number): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hr ago`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}
