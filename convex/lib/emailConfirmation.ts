import { APIError } from "better-auth/api";
import type { EmailOutcome } from "./email";
import { buildVerificationEmail } from "./verificationEmail";

// Sending the "confirm your email" message for better-auth.
//
// better-auth calls this at sign-up, and again when a signed-in person presses
// "Send again" (or anyone asks for a new link by email address). Two rules:
//
//  - At sign-up it must never throw. better-auth waits for it, so an error
//    here would fail the sign-up after the account had already been made. The
//    person can ask for another email from the banner.
//  - On "Send again" it should throw, so the person is told when no email went
//    out (too many requests, or sending failed) instead of waiting for one.
//
// The request for a new link needs no sign-in, so anyone can ask for an email
// to be sent to any address that has an unconfirmed account. Each account is
// limited, so one person can't fill another's inbox, and all of them together
// are limited, so they can't use up the daily allowance that receipts share.

/** Sends per account per hour (the first is the one at sign-up). */
export const PER_ACCOUNT_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };
/** Sends across every account per hour. */
export const ALL_ACCOUNTS_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 };

export type AllowSend =
  { allowed: true } | { allowed: false; retryAfterMs: number };

export interface VerificationEmailDeps {
  /** Counts one use of `key` against `limit` and says whether it may go ahead. */
  consume(
    key: string,
    limit: { max: number; windowMs: number },
  ): Promise<AllowSend>;
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<EmailOutcome>;
}

interface VerificationUser {
  id: string;
  email: string;
  name?: string | null;
}

/** True when better-auth is answering a request for a new link. */
export function isResendRequest(request: Request | undefined): boolean {
  if (!request) return false;
  try {
    return new URL(request.url).pathname.endsWith("/send-verification-email");
  } catch {
    return false;
  }
}

export function createSendVerificationEmail(deps: VerificationEmailDeps) {
  return async (
    data: { user: VerificationUser; url: string; token: string },
    request?: Request,
  ): Promise<void> => {
    const resend = isResendRequest(request);

    // Always logged. On a resend the person is told too; at sign-up they are
    // not, because throwing there would undo the sign-up. `detail` is for the
    // log only, and never contains the person's address (see sendEmail).
    const fail = (
      status: "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR",
      message: string,
      detail: string = message,
    ) => {
      console.error(`Confirmation email not sent: ${detail}`);
      if (resend) throw new APIError(status, { message });
    };

    const perAccount = await deps.consume(
      `verify-email:${data.user.id}`,
      PER_ACCOUNT_LIMIT,
    );
    if (!perAccount.allowed) {
      return fail(
        "TOO_MANY_REQUESTS",
        "We've already sent several confirmation emails. Please check your inbox, including spam, or try again in an hour.",
      );
    }

    const everyone = await deps.consume("verify-email:all", ALL_ACCOUNTS_LIMIT);
    if (!everyone.allowed) {
      return fail(
        "TOO_MANY_REQUESTS",
        "We're sending a lot of emails right now. Please try again in a few minutes.",
      );
    }

    const email = buildVerificationEmail({
      userName: data.user.name ?? null,
      url: data.url,
    });

    const outcome = await deps.send({
      to: data.user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // A repeat of this exact send (same link) is not delivered twice.
      idempotencyKey: `verify-email:${data.user.id}:${data.token.slice(-40)}`,
    });

    if (outcome.kind === "failed") {
      return fail(
        "INTERNAL_SERVER_ERROR",
        outcome.retryable
          ? "We couldn't send the email just now. Please try again in a few minutes."
          : "We couldn't send the email. Please try again later or contact support.",
        outcome.error,
      );
    }
  };
}

/** How long the link in the email works. The email itself says "24 hours". */
export const CONFIRMATION_LINK_LIFETIME_SECONDS = 60 * 60 * 24;

/**
 * The `emailVerification` settings for better-auth, in one place so the tests
 * run exactly what the real sign-in setup runs.
 *
 * `autoSignInAfterVerification` is left off on purpose. Anyone can sign up with
 * someone else's address, and if the link signed in whoever opened it, a person
 * who clicked an email they didn't ask for would be signed in to an account
 * someone else made, password and all.
 */
export function emailConfirmationOptions(deps: VerificationEmailDeps) {
  return {
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: CONFIRMATION_LINK_LIFETIME_SECONDS,
      sendVerificationEmail: createSendVerificationEmail(deps),
    },
  };
}
