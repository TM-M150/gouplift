// Shared by the donate form (client) and the Convex functions, so both agree on
// what a shareable message is.

/**
 * The longest message that can be offered as a testimonial. The donation
 * message box is capped at the same length, so nothing is ever cut short.
 */
export const MAX_TESTIMONIAL_LENGTH = 300;

/** The lowest approved verification level a testimonial author must hold. */
export const MIN_TESTIMONIAL_KYC_TIER = 1;

const FALLBACK_AUTHOR_NAME = "A GoUplift donor";

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

/**
 * Whether a donation should be recorded as "share my message". It is a request
 * and nothing more: only a signed-in donor with a message can make it, so a
 * guest who sends the flag anyway is quietly ignored.
 */
export function resolveTestimonialOptIn(input: {
  requested: boolean | undefined;
  signedIn: boolean;
  isAnonymous: boolean;
  message: string | undefined;
}): boolean {
  if (input.requested !== true || !input.signedIn || input.isAnonymous) {
    return false;
  }
  return (input.message?.trim().length ?? 0) > 0;
}
