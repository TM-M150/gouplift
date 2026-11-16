import { z } from "zod";
import { normalizePlainText } from "./plain-text";

// Shared by the comment form (client) and the Convex functions, so both agree
// on what a comment may say and who may leave one.

export const MIN_COMMENT_LENGTH = 3;
export const MAX_COMMENT_LENGTH = 500;

/** How many comments one person can leave on one fundraiser in a day. */
export const MAX_COMMENTS_PER_DAY = 5;
export const COMMENT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many reports one person can make in a day. */
export const MAX_REPORTS_PER_DAY = 20;
export const REPORT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The fundraiser statuses that can have a comment left on them. Like updates,
 * it carries on after the fundraiser closes: people thank the organizer then.
 */
export const COMMENT_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "EXPIRED",
]);

/** What a comment shows as its author when the donor chose not to be named. */
export const ANONYMOUS_DONOR_NAME = "Anonymous donor";

export const REPORT_REASONS = [
  "SPAM",
  "ABUSIVE",
  "OFF_PLATFORM_PAYMENT",
  "PRIVATE_INFO",
  "OTHER",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: "Spam or an advert",
  ABUSIVE: "Abusive, hateful or threatening",
  OFF_PLATFORM_PAYMENT: "Asks for money or details away from GoUplift",
  PRIVATE_INFO: "Shares someone's private information",
  OTHER: "Something else",
};

export const commentBodySchema = z
  .string()
  .transform(normalizePlainText)
  .pipe(
    z
      .string()
      .min(
        MIN_COMMENT_LENGTH,
        `Write at least ${MIN_COMMENT_LENGTH} characters.`,
      )
      .max(
        MAX_COMMENT_LENGTH,
        `Keep it under ${MAX_COMMENT_LENGTH.toLocaleString("en-US")} characters.`,
      ),
  );

/** The tidied text, or the first thing wrong with it. */
export function checkCommentBody(
  raw: string,
): { ok: true; body: string } | { ok: false; problem: string } {
  const parsed = commentBodySchema.safeParse(raw);
  if (parsed.success) return { ok: true, body: parsed.data };
  return {
    ok: false,
    problem: parsed.error.issues[0]?.message ?? "Write your comment first.",
  };
}
