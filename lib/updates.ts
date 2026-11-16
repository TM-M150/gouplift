import { z } from "zod";
import { normalizePlainText } from "./plain-text";

// Shared by the update form (client) and the Convex functions, so both agree
// on what an update may say and who may post one.

export const MIN_UPDATE_LENGTH = 10;
export const MAX_UPDATE_LENGTH = 2000;

/** How many updates one fundraiser can post in a day, edits not counted. */
export const MAX_UPDATES_PER_DAY = 10;
export const UPDATE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Donors are emailed about at most one update per fundraiser in this long.
 * Posting more is fine; the extra ones just aren't emailed. It keeps a
 * fundraiser from filling its donors' inboxes, and keeps our email bill and
 * sending reputation in check.
 */
export const UPDATE_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The fundraiser statuses that can have an update posted. It starts once the
 * fundraiser has been approved and carries on after it closes: the thank-you
 * at the end is one of the most useful updates there is.
 */
export const UPDATE_POSTING_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "EXPIRED",
]);

/** The tidied text of an update; see normalizePlainText. */
export const normalizeUpdateBody = normalizePlainText;

export const updateBodySchema = z
  .string()
  .transform(normalizeUpdateBody)
  .pipe(
    z
      .string()
      .min(MIN_UPDATE_LENGTH, `Write at least ${MIN_UPDATE_LENGTH} characters.`)
      .max(
        MAX_UPDATE_LENGTH,
        `Keep it under ${MAX_UPDATE_LENGTH.toLocaleString("en-US")} characters.`,
      ),
  );

/** The tidied text, or the first thing wrong with it. */
export function checkUpdateBody(
  raw: string,
): { ok: true; body: string } | { ok: false; problem: string } {
  const parsed = updateBodySchema.safeParse(raw);
  if (parsed.success) return { ok: true, body: parsed.data };
  return {
    ok: false,
    problem: parsed.error.issues[0]?.message ?? "Write your update first.",
  };
}
