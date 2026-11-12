// Sending email through Resend, for the emails GoUplift sends on its own
// (receipts first). The password reset email in auth.ts has its own copy of
// the request because Better Auth wants it to throw; this one reports what
// happened instead, so the caller can decide whether to try again.

// One place for who the mail comes from, so changing the sending domain is a
// one-line change.
export const EMAIL_FROM = "GoUplift <noreply@gouplift.co.ke>";

const RESEND_URL = "https://api.resend.com/emails";

// A request that hasn't answered in this long counts as a failed attempt.
const REQUEST_TIMEOUT_MS = 15_000;

// How long to wait before attempt 2, 3, ... A receipt that arrives a few
// hours late is still useful; one that never arrives is not. The last retry
// lands about 14 hours after the first try.
export const EMAIL_RETRY_DELAYS_MS = [
  60_000, // 1 minute
  5 * 60_000, // 5 minutes
  30 * 60_000, // 30 minutes
  2 * 60 * 60_000, // 2 hours
  12 * 60 * 60_000, // 12 hours
];

export const MAX_EMAIL_ATTEMPTS = EMAIL_RETRY_DELAYS_MS.length + 1;

export type EmailOutcome =
  | { kind: "sent"; emailId?: string }
  | {
      kind: "failed";
      // Worth trying again later: Resend or the network had a problem, or we
      // were sending too fast. Not worth it: the address was refused, or
      // email isn't set up.
      retryable: boolean;
      statusCode?: number;
      error: string;
    };

// What goes in the log. Short, and never the recipient's address.
function describeError(text: string, to: string): string {
  const scrubbed = text.split(to).join("[email]").replace(/\s+/g, " ").trim();
  return scrubbed.length > 300 ? `${scrubbed.slice(0, 297)}...` : scrubbed;
}

/**
 * Sends one email. Never throws: every outcome comes back as a value.
 *
 * `idempotencyKey` makes a repeat of the same request harmless. If a send
 * reached Resend but its answer was lost, trying again with the same key
 * doesn't email the person twice.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<EmailOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      kind: "failed",
      retryable: false,
      error: "RESEND_API_KEY is not set. Set it with `npx convex env set`.",
    };
  }

  // The same timeout pattern as webhookSend.ts.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    return {
      kind: "failed",
      retryable: true,
      error: controller.signal.aborted
        ? "Resend did not answer in time."
        : describeError(
            error instanceof Error ? error.message : "Request failed",
            input.to,
          ),
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    let emailId: string | undefined;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "id" in body &&
        typeof body.id === "string"
      ) {
        emailId = body.id;
      }
    } catch {
      // It was accepted; not knowing Resend's id for it changes nothing.
    }
    return { kind: "sent", emailId };
  }

  const detail = await response.text().catch(() => "");
  return {
    kind: "failed",
    // 429: slowed down by Resend. 409: the same request is still being
    // handled. 5xx: their side. Everything else is a refusal that asking
    // again won't change.
    retryable:
      response.status === 429 ||
      response.status === 409 ||
      response.status >= 500,
    statusCode: response.status,
    error: describeError(
      `Resend ${response.status}: ${detail || response.statusText}`,
      input.to,
    ),
  };
}
