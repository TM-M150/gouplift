import { z } from "zod";
import { normalizePlainText } from "./plain-text";

// Shared by the testimonial form (client) and the Convex functions, so both
// agree on what a testimonial is.
//
// A testimonial is what a person says about GoUplift itself: a star rating,
// a few words for the homepage, and an optional suggestion that only our team
// reads. Anyone with an account can write one from their profile. It is shown
// on the homepage only once staff have read it and only while its author holds
// an approved identity verification.

export const MIN_RATING = 1;
export const MAX_RATING = 5;

export const MIN_TESTIMONIAL_LENGTH = 20;
export const MAX_TESTIMONIAL_LENGTH = 500;

/** The private note for our team: what to do better or add. */
export const MAX_RECOMMENDATION_LENGTH = 1000;

/** How many times one person can send a testimonial in for review in a day. */
export const MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY = 10;
export const TESTIMONIAL_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The lowest approved verification level a testimonial author must hold. */
export const MIN_TESTIMONIAL_KYC_TIER = 1;

const FALLBACK_AUTHOR_NAME = "A GoUplift user";

/**
 * How an author is named in public: first name and the initial of the last
 * one ("Wanjiru Kamau" becomes "Wanjiru K."). Never the full name.
 */
export function publicAuthorName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  if (!first) return FALLBACK_AUTHOR_NAME;
  const last = rest[rest.length - 1];
  const initial = last ? Array.from(last)[0]?.toUpperCase() : undefined;
  return initial ? `${first} ${initial}.` : first;
}

export interface TestimonialInput {
  rating: number;
  message: string;
  /** Private. Blank or missing means none. */
  recommendation?: string | null;
}

export interface CheckedTestimonial {
  rating: number;
  message: string;
  /** Null when none was given. */
  recommendation: string | null;
}

const testimonialSchema = z.object({
  rating: z
    .number({ error: "Choose a star rating from 1 to 5." })
    .int("Choose a star rating from 1 to 5.")
    .min(MIN_RATING, "Choose a star rating from 1 to 5.")
    .max(MAX_RATING, "Choose a star rating from 1 to 5."),
  message: z
    .string()
    .transform(normalizePlainText)
    .pipe(
      z
        .string()
        .min(
          MIN_TESTIMONIAL_LENGTH,
          `Write at least ${MIN_TESTIMONIAL_LENGTH} characters about your experience.`,
        )
        .max(
          MAX_TESTIMONIAL_LENGTH,
          `Keep your testimonial under ${MAX_TESTIMONIAL_LENGTH} characters.`,
        ),
    ),
  recommendation: z
    .string()
    .nullish()
    .transform((value) => normalizePlainText(value ?? ""))
    .pipe(
      z
        .string()
        .max(
          MAX_RECOMMENDATION_LENGTH,
          `Keep your suggestion under ${MAX_RECOMMENDATION_LENGTH.toLocaleString("en-US")} characters.`,
        ),
    )
    .transform((value) => (value === "" ? null : value)),
});

export type TestimonialField = "rating" | "message" | "recommendation";

/**
 * The tidied testimonial, or the first thing wrong with it and which part of the
 * form it is about.
 */
export function checkTestimonial(
  input: TestimonialInput,
):
  | { ok: true; value: CheckedTestimonial }
  | { ok: false; field: TestimonialField; problem: string } {
  const parsed = testimonialSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const key = issue?.path[0];
  return {
    ok: false,
    field:
      key === "rating" || key === "message" || key === "recommendation"
        ? key
        : "message",
    problem: issue?.message ?? "Check your testimonial and try again.",
  };
}
