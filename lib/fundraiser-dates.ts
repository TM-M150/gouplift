// How long a fundraiser runs. Shared by the forms (client) and the Convex
// functions, so the page and the server agree on what a valid end date is.
//
// An end date is stored as a timestamp: the last millisecond of the chosen
// day in Nairobi. Kenya has no daylight saving, so East Africa Time is always
// UTC+3 and a fixed offset is exact.

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the form suggests: three months from today. */
export const DEFAULT_CAMPAIGN_DAYS = 90;

/** The furthest out an end date can be set, counted from today. */
export const MAX_CAMPAIGN_DAYS = 365;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A timestamp's calendar date in Nairobi, as YYYY-MM-DD. */
export function nairobiDateString(ms: number): string {
  return new Date(ms + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

function utcMidnightOf(date: string): number | null {
  if (!DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  // Rejects dates that roll over, like 2026-02-31.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** The date `days` after a YYYY-MM-DD date, as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const ms = utcMidnightOf(date);
  if (ms === null) throw new Error(`Not a date: ${date}`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The last moment (23:59:59.999, Nairobi) of a YYYY-MM-DD date, or null when
 * the text isn't a real date. This is what gets stored as `endDate`.
 */
export function endOfNairobiDay(date: string): number | null {
  const midnight = utcMidnightOf(date);
  if (midnight === null) return null;
  return midnight + DAY_MS - 1 - EAT_OFFSET_MS;
}

/** The date the create form starts on. */
export function defaultEndDateString(now: number): string {
  return addDays(nairobiDateString(now), DEFAULT_CAMPAIGN_DAYS);
}

/** The earliest date that can be chosen: today. */
export function minEndDateString(now: number): string {
  return nairobiDateString(now);
}

/** The latest date that can be chosen. */
export function maxEndDateString(now: number): string {
  return addDays(nairobiDateString(now), MAX_CAMPAIGN_DAYS);
}

/** Why an end date can't be used, or null when it can. */
export function endDateProblem(endDate: number, now: number): string | null {
  if (!Number.isFinite(endDate)) return "Choose a valid end date.";
  if (endDate <= now) return "The end date must be in the future.";
  const latest = endOfNairobiDay(maxEndDateString(now));
  if (latest !== null && endDate > latest) {
    return `A fundraiser can run for up to ${MAX_CAMPAIGN_DAYS} days. Choose an earlier date.`;
  }
  return null;
}

/** The same check for a YYYY-MM-DD value from a date input. */
export function endDateStringProblem(date: string, now: number): string | null {
  const endDate = endOfNairobiDay(date);
  if (endDate === null) return "Choose an end date.";
  return endDateProblem(endDate, now);
}

/** Whether a fundraiser's end date has passed. No end date never ends. */
export function hasEnded(endDate: number | undefined, now: number): boolean {
  return endDate !== undefined && endDate <= now;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A YYYY-MM-DD date as "9 Nov 2026", or the text unchanged if it isn't one. */
export function formatDateLabel(date: string): string {
  if (utcMidnightOf(date) === null) return date;
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** A timestamp's Nairobi calendar day as "9 Nov 2026". */
export function formatEndDate(ms: number): string {
  return formatDateLabel(nairobiDateString(ms));
}

/** "Ends today", "1 day left", "42 days left", or "Ended", by calendar day. */
export function describeTimeLeft(endDate: number, now: number): string {
  if (endDate <= now) return "Ended";
  const today = utcMidnightOf(nairobiDateString(now));
  const last = utcMidnightOf(nairobiDateString(endDate));
  if (today === null || last === null) return "";
  const days = Math.round((last - today) / DAY_MS);
  if (days <= 0) return "Ends today";
  return days === 1 ? "1 day left" : `${days} days left`;
}
