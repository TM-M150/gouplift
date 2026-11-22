import { normalizePlainText } from "./plain-text";

// Reporting a fundraiser. Shared by the report form (client) and the Convex
// functions, so both agree on what a report may say.
//
// A report only tells staff to take a look. Nothing happens to a fundraiser
// because of how many reports it has: a person on staff decides, so a crowd
// (or a rival) can't take a fundraiser down just by clicking.

export const FUNDRAISER_REPORT_REASONS = [
  "SCAM",
  "FALSE_STORY",
  "OFF_PLATFORM_PAYMENT",
  "STOLEN_IDENTITY",
  "PROHIBITED",
  "OTHER",
] as const;
export type FundraiserReportReason = (typeof FUNDRAISER_REPORT_REASONS)[number];

export const FUNDRAISER_REPORT_REASON_LABELS: Record<
  FundraiserReportReason,
  string
> = {
  SCAM: "It looks like a scam or fraud",
  FALSE_STORY: "The story is false or misleading",
  OFF_PLATFORM_PAYMENT: "It asks for money or details away from GoUplift",
  STOLEN_IDENTITY: "It uses someone else's photos, name or story",
  PROHIBITED: "It isn't allowed on GoUplift (illegal, hateful or harmful)",
  OTHER: "Something else",
};

/** What the reporter may add to say more. */
export const MAX_REPORT_DETAILS_LENGTH = 1000;
/** "Something else" says nothing on its own, so it needs a few words. */
export const MIN_OTHER_DETAILS_LENGTH = 10;

/** How many fundraisers one person can report in a day. */
export const MAX_FUNDRAISER_REPORTS_PER_DAY = 10;
export const FUNDRAISER_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The details tidied (or none, when it was left blank), or the first thing
 * wrong with them.
 */
export function checkReportDetails(
  reason: FundraiserReportReason,
  raw: string | undefined,
): { ok: true; details: string | undefined } | { ok: false; problem: string } {
  const details = normalizePlainText(raw ?? "");
  if (details.length > MAX_REPORT_DETAILS_LENGTH) {
    return {
      ok: false,
      problem: `Keep it under ${MAX_REPORT_DETAILS_LENGTH.toLocaleString("en-US")} characters.`,
    };
  }
  if (reason === "OTHER" && details.length < MIN_OTHER_DETAILS_LENGTH) {
    return {
      ok: false,
      problem: "Tell us in a few words what is wrong.",
    };
  }
  return { ok: true, details: details === "" ? undefined : details };
}

/**
 * What staff paste to open a fundraiser: its address on the site or just the
 * id at the end of it. Anything after the id (a query string, a #comments) is
 * dropped. Returns null for blank input.
 */
export function fundraiserIdFromInput(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  const match = text.match(/\/fundraiser\/([^/?#\s]+)/);
  if (match) return match[1];
  return text.split(/[?#\s]/)[0] || null;
}
