// The email an organizer gets when donors comment on their fundraiser. It is
// a digest, not one email per comment: the first comment after a quiet spell
// starts a short wait so a burst arrives as one email, and after that there is
// at most one email a day for each fundraiser.

/** How long the first comment waits, so comments that come in a row share one email. */
export const COMMENT_EMAIL_BATCH_DELAY_MS = 10 * 60_000;

/** The least time between two comment emails about the same fundraiser. */
export const COMMENT_EMAIL_MIN_GAP_MS = 24 * 60 * 60_000;

/**
 * A planned send that hasn't run this long after its time is treated as lost,
 * so a failure in one run can't stop emails for that fundraiser for good.
 */
export const COMMENT_EMAIL_STALE_MS = 60 * 60_000;

/** The most comments one email counts. Beyond this it says "100+". */
export const COMMENT_EMAIL_MAX_COUNT = 100;
