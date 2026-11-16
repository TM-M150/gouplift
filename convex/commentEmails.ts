import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  COMMENT_EMAIL_BATCH_DELAY_MS,
  COMMENT_EMAIL_MAX_COUNT,
  COMMENT_EMAIL_MIN_GAP_MS,
  COMMENT_EMAIL_STALE_MS,
} from "../lib/comment-emails";
import { buildCommentEmail, type CommentEmailData } from "./lib/commentEmail";
import {
  EMAIL_RETRY_DELAYS_MS,
  MAX_EMAIL_ATTEMPTS,
  sendEmail,
  type EmailOutcome,
} from "./lib/email";
import { isPubliclyVisible } from "./lib/fundraiserAccess";
import { isPlausibleEmail } from "./lib/receiptEmail";
import { SEND_SPACING_MS } from "./lib/updateEmail";
import { SITE_URL } from "../lib/site";

// Emailing a fundraiser's organizer when donors comment on it.
//
// This is a digest, never one email per comment. The first comment after a
// quiet spell starts a short wait (so a burst shares one email), and after an
// email there is a day's gap before the next. The email says how many new
// comments there are and links to the page; it never says what they say or who
// wrote them (see lib/commentEmail.ts).
//
// Like receipts, the work is all scheduled, so a problem with email can never
// hold up or undo posting a comment:
//
//   1. noteNewComment, called as a comment is posted, makes sure a digest is
//      planned. At most one is planned at a time for a fundraiser.
//   2. queueDigest runs at the planned time, counts what is new, and if there
//      is something to say and someone who wants to hear it, makes a delivery.
//   3. send emails the delivery, with the same retry schedule as receipts.
//
// Every step is safe to repeat: a plan only counts as live while it is in the
// future (or recently past), and the email service ignores a repeated request.

const REQUEUE_BATCH = 50;

// How many new comments one digest looks at. More than the number it shows, so
// the organizer's own comments (which aren't counted) can't hide the rest.
const SCAN_LIMIT = 300;

// A scheduled run may start a moment before the time it was planned for.
const EARLY_RUN_SLACK_MS = 5_000;

type SkipReason = "NOT_VISIBLE" | "OPTED_OUT" | "NO_EMAIL";

const skipReasonValidator = v.union(
  v.literal("NOT_VISIBLE"),
  v.literal("OPTED_OUT"),
  v.literal("NO_EMAIL"),
);

const outcomeValidator = v.union(
  v.object({ kind: v.literal("sent"), emailId: v.optional(v.string()) }),
  v.object({ kind: v.literal("skipped"), reason: skipReasonValidator }),
  v.object({
    kind: v.literal("failed"),
    retryable: v.boolean(),
    statusCode: v.optional(v.number()),
    error: v.string(),
  }),
);

/** 24 random bytes as URL-safe text: unguessable, and short enough for a link. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Whether this person wants these emails. Only an explicit "no" turns them off. */
export function wantsCommentEmails(user: Doc<"users">): boolean {
  return user.commentEmails !== false;
}

// ---- 1. Planning a digest ----------------------------------------------

/**
 * Called when a comment is posted. Makes sure an email about it is planned,
 * unless the commenter is the organizer, whose own comments need no email.
 *
 * The first comment on a fundraiser starts its record, which remembers that
 * everything before it was already there: comments from before this feature
 * (or from before the organizer wanted emails) are never counted as new.
 */
export async function noteNewComment(
  ctx: MutationCtx,
  fundraiser: Doc<"fundraisers">,
  authorUserId: Id<"users">,
  createdAt: number,
): Promise<void> {
  if (authorUserId === fundraiser.creatorId) return;

  const now = Date.now();
  const state = await ctx.db
    .query("commentEmailState")
    .withIndex("by_fundraiserId", (q) => q.eq("fundraiserId", fundraiser._id))
    .unique();

  if (!state) {
    const sendAt = now + COMMENT_EMAIL_BATCH_DELAY_MS;
    await ctx.db.insert("commentEmailState", {
      fundraiserId: fundraiser._id,
      notifiedUpTo: createdAt - 1,
      pendingFor: sendAt,
    });
    await ctx.scheduler.runAt(sendAt, internal.commentEmails.queueDigest, {
      fundraiserId: fundraiser._id,
    });
    return;
  }

  // One is already planned: this comment will be in it.
  if (
    state.pendingFor !== undefined &&
    now < state.pendingFor + COMMENT_EMAIL_STALE_MS
  ) {
    return;
  }

  const sendAt = Math.max(
    now + COMMENT_EMAIL_BATCH_DELAY_MS,
    (state.lastSentAt ?? 0) + COMMENT_EMAIL_MIN_GAP_MS,
  );
  await ctx.db.patch(state._id, { pendingFor: sendAt });
  await ctx.scheduler.runAt(sendAt, internal.commentEmails.queueDigest, {
    fundraiserId: fundraiser._id,
  });
}

// ---- 2. Making the delivery --------------------------------------------

/**
 * Runs at the time noteNewComment planned. Counts the comments made since the
 * last email (or since the first one) and queues the email when there are some
 * and the organizer wants it. Either way what it looked at is now "dealt
 * with": comments are not saved up for an organizer who has switched the
 * emails off, to arrive as a surprise when they switch them back on.
 */
export const queueDigest = internalMutation({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("commentEmailState")
      .withIndex("by_fundraiserId", (q) =>
        q.eq("fundraiserId", args.fundraiserId),
      )
      .unique();
    const now = Date.now();
    // Nothing is planned, or it is planned for later than this run: this is a
    // leftover of a plan that was made again, and the live one will do the work.
    if (
      !state ||
      state.pendingFor === undefined ||
      now + EARLY_RUN_SLACK_MS < state.pendingFor
    ) {
      return null;
    }

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) {
      await ctx.db.patch(state._id, { pendingFor: undefined });
      return null;
    }

    const recent = await ctx.db
      .query("fundraiserComments")
      .withIndex("by_fundraiserId_and_status_and_createdAt", (q) =>
        q
          .eq("fundraiserId", args.fundraiserId)
          .eq("status", "PUBLISHED")
          .gt("createdAt", state.notifiedUpTo),
      )
      .take(SCAN_LIMIT);
    const fromDonors = recent.filter(
      (comment) => comment.authorUserId !== fundraiser.creatorId,
    );
    const count = Math.min(fromDonors.length, COMMENT_EMAIL_MAX_COUNT);
    const hasMore =
      fromDonors.length > COMMENT_EMAIL_MAX_COUNT ||
      recent.length >= SCAN_LIMIT;

    const organizer = await ctx.db.get(fundraiser.creatorId);
    const worthSending =
      count > 0 &&
      isPubliclyVisible(fundraiser) &&
      organizer !== null &&
      wantsCommentEmails(organizer) &&
      isPlausibleEmail(organizer.email.trim());

    if (!worthSending || !organizer) {
      await ctx.db.patch(state._id, {
        notifiedUpTo: now,
        pendingFor: undefined,
      });
      return null;
    }

    const deliveryId = await ctx.db.insert("commentEmailDeliveries", {
      fundraiserId: fundraiser._id,
      recipientUserId: organizer._id,
      token: newToken(),
      count,
      hasMore,
      status: "PENDING",
      attempts: 0,
      generation: 0,
      createdAt: now,
    });
    await ctx.db.patch(state._id, {
      notifiedUpTo: now,
      lastSentAt: now,
      pendingFor: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.commentEmails.send, {
      deliveryId,
    });
    return null;
  },
});

// ---- 3. Sending --------------------------------------------------------

type SendJob =
  | { kind: "done" }
  | { kind: "skip"; reason: SkipReason }
  | {
      kind: "send";
      to: string;
      idempotencyKey: string;
      data: CommentEmailData;
    };

export const getSendJob = internalQuery({
  args: { deliveryId: v.id("commentEmailDeliveries") },
  handler: async (ctx, args): Promise<SendJob> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (
      !delivery ||
      (delivery.status !== "PENDING" && delivery.status !== "RETRYING")
    ) {
      return { kind: "done" };
    }

    // Things can change between queueing and sending (and a retry may be a
    // day later): the fundraiser taken down, the organizer opting out.
    const fundraiser = await ctx.db.get(delivery.fundraiserId);
    if (!fundraiser || !isPubliclyVisible(fundraiser)) {
      return { kind: "skip", reason: "NOT_VISIBLE" };
    }
    const organizer = await ctx.db.get(delivery.recipientUserId);
    if (!organizer || !wantsCommentEmails(organizer)) {
      return { kind: "skip", reason: "OPTED_OUT" };
    }
    const to = organizer.email.trim();
    if (!isPlausibleEmail(to)) return { kind: "skip", reason: "NO_EMAIL" };

    return {
      kind: "send",
      to,
      idempotencyKey: `comment-digest-${delivery._id}-${delivery.generation}`,
      data: {
        fundraiserId: fundraiser._id,
        fundraiserTitle: fundraiser.title,
        organizerName: organizer.displayName,
        count: delivery.count,
        hasMore: delivery.hasMore,
        token: delivery.token,
      },
    };
  },
});

export const send = internalAction({
  args: { deliveryId: v.id("commentEmailDeliveries") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job: SendJob = await ctx.runQuery(internal.commentEmails.getSendJob, {
      deliveryId: args.deliveryId,
    });
    if (job.kind === "done") return null;

    let outcome: EmailOutcome | { kind: "skipped"; reason: SkipReason };
    if (job.kind === "skip") {
      outcome = { kind: "skipped", reason: job.reason };
    } else {
      const siteUrl = process.env.SITE_URL || SITE_URL;
      // Where a mail app can unsubscribe the person with no page involved.
      const convexSite = process.env.CONVEX_SITE_URL?.replace(/\/+$/, "");
      const email = buildCommentEmail(job.data, {
        siteUrl,
        oneClickUrl: convexSite
          ? `${convexSite}/email/unsubscribe-comments/${job.data.token}`
          : null,
      });
      outcome = await sendEmail({
        to: job.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
        idempotencyKey: job.idempotencyKey,
      });
    }

    await ctx.runMutation(internal.commentEmails.recordAttempt, {
      deliveryId: args.deliveryId,
      outcome,
    });
    return null;
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("commentEmailDeliveries"),
    outcome: outcomeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return null;
    if (
      delivery.status === "SENT" ||
      delivery.status === "FAILED" ||
      delivery.status === "SKIPPED"
    ) {
      return null;
    }

    const now = Date.now();
    const attempts = delivery.attempts + 1;
    const { outcome } = args;

    if (outcome.kind === "sent") {
      await ctx.db.patch(args.deliveryId, {
        status: "SENT",
        attempts,
        lastAttemptAt: now,
        sentAt: now,
        emailId: outcome.emailId,
        lastError: undefined,
        lastStatusCode: undefined,
        nextAttemptAt: undefined,
      });
      return null;
    }

    if (outcome.kind === "skipped") {
      await ctx.db.patch(args.deliveryId, {
        status: "SKIPPED",
        skippedReason: outcome.reason,
        lastAttemptAt: now,
        nextAttemptAt: undefined,
      });
      return null;
    }

    if (!outcome.retryable || attempts >= MAX_EMAIL_ATTEMPTS) {
      await ctx.db.patch(args.deliveryId, {
        status: "FAILED",
        attempts,
        lastAttemptAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error,
        nextAttemptAt: undefined,
      });
      // A line in the logs, never the address.
      console.error(
        `Comment email ${delivery._id} for fundraiser ${delivery.fundraiserId} failed after ${attempts} attempt(s): ${outcome.error}`,
      );
      return null;
    }

    const delay = EMAIL_RETRY_DELAYS_MS[attempts - 1];
    await ctx.db.patch(args.deliveryId, {
      status: "RETRYING",
      attempts,
      lastAttemptAt: now,
      lastStatusCode: outcome.statusCode,
      lastError: outcome.error,
      nextAttemptAt: now + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.commentEmails.send, {
      deliveryId: args.deliveryId,
    });
    return null;
  },
});

/**
 * Tries every failed comment email again, for after the cause is fixed (a
 * missing API key, an unverified sending domain). Run from the dashboard or
 * the CLI:
 *
 *   npx convex run commentEmails:requeueFailed
 *
 * Works through them in batches and carries on by itself.
 */
export const requeueFailed = internalMutation({
  args: {},
  returns: v.object({ requeued: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const failed = await ctx.db
      .query("commentEmailDeliveries")
      .withIndex("by_status", (q) => q.eq("status", "FAILED"))
      .take(REQUEUE_BATCH);

    let position = 0;
    for (const delivery of failed) {
      await ctx.db.patch(delivery._id, {
        status: "PENDING",
        attempts: 0,
        generation: delivery.generation + 1,
        lastError: undefined,
        lastStatusCode: undefined,
        nextAttemptAt: undefined,
      });
      await ctx.scheduler.runAfter(
        position++ * SEND_SPACING_MS,
        internal.commentEmails.send,
        { deliveryId: delivery._id },
      );
    }

    const more = failed.length === REQUEUE_BATCH;
    if (more) {
      await ctx.scheduler.runAfter(
        failed.length * SEND_SPACING_MS,
        internal.commentEmails.requeueFailed,
        {},
      );
    }
    return { requeued: failed.length, more };
  },
});
