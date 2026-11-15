import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  EMAIL_RETRY_DELAYS_MS,
  MAX_EMAIL_ATTEMPTS,
  sendEmail,
  type EmailOutcome,
} from "./lib/email";
import { canEmailDonorsAbout } from "./lib/fundraiserAccess";
import { isPlausibleEmail } from "./lib/receiptEmail";
import {
  buildUpdateEmail,
  FANOUT_PAGE_SIZE,
  MAX_RECIPIENTS_PER_UPDATE,
  SEND_SPACING_MS,
  type UpdateEmailData,
} from "./lib/updateEmail";
import { isOptedOut, normalizeEmail } from "./lib/updateOptOuts";
import { SITE_URL } from "../lib/site";

// Emailing donors when a fundraiser posts an update.
//
// Like receipts it is all scheduled work, so a problem with email can never
// hold up or undo posting. It runs in two stages:
//
//   1. fanOut walks the fundraiser's completed donations a page at a time and,
//      for each address not already emailed about this update and not opted
//      out, creates a delivery row and schedules its send. A donor who gave
//      five times is one address, so one email.
//   2. send emails one delivery, with the same retry schedule as receipts.
//
// The sends are spaced out (see SEND_SPACING_MS) and the next page is only
// started once the current one has gone out, so the pace holds however many
// donors there are. Every step is safe to repeat: one delivery row per
// address per update, and the email service ignores a repeated request.

const REQUEUE_BATCH = 50;

type SkipReason = "UPDATE_NOT_PUBLISHED" | "NOT_VISIBLE" | "OPTED_OUT";

const skipReasonValidator = v.union(
  v.literal("UPDATE_NOT_PUBLISHED"),
  v.literal("NOT_VISIBLE"),
  v.literal("OPTED_OUT"),
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

// ---- Stage 1: who to email --------------------------------------------

/** One page of the fundraiser's donors' addresses, or a signal to stop. */
export const recipientPage = internalQuery({
  args: {
    updateId: v.id("fundraiserUpdates"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.union(
    v.object({ stop: v.literal(true) }),
    v.object({
      stop: v.literal(false),
      emails: v.array(v.string()),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const update = await ctx.db.get(args.updateId);
    if (!update || update.status !== "PUBLISHED")
      return { stop: true as const };
    const fundraiser = await ctx.db.get(update.fundraiserId);
    if (!fundraiser || !canEmailDonorsAbout(fundraiser)) {
      return { stop: true as const };
    }

    const result = await ctx.db
      .query("donations")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", update.fundraiserId).eq("status", "COMPLETED"),
      )
      .paginate({ numItems: FANOUT_PAGE_SIZE, cursor: args.cursor });

    const emails = new Set<string>();
    for (const donation of result.page) {
      const email = donation.donorEmail
        ? normalizeEmail(donation.donorEmail)
        : "";
      if (email && isPlausibleEmail(email)) emails.add(email);
    }
    return {
      stop: false as const,
      emails: [...emails],
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Creates a delivery row for each address that should get the email and
 * schedules its send, one SEND_SPACING_MS after the one before. Addresses that
 * were already queued for this update (a donor who gave on two pages) or have
 * opted out get nothing.
 */
export const queueDeliveries = internalMutation({
  args: {
    updateId: v.id("fundraiserUpdates"),
    emails: v.array(v.string()),
  },
  returns: v.object({ queued: v.number(), stop: v.boolean() }),
  handler: async (ctx, args) => {
    const update = await ctx.db.get(args.updateId);
    if (!update || update.status !== "PUBLISHED") {
      return { queued: 0, stop: true };
    }
    const fundraiser = await ctx.db.get(update.fundraiserId);
    if (!fundraiser || !canEmailDonorsAbout(fundraiser)) {
      return { queued: 0, stop: true };
    }

    const now = Date.now();
    let total = update.emailQueuedCount ?? 0;
    let queued = 0;
    let stop = false;

    for (const email of args.emails) {
      if (total >= MAX_RECIPIENTS_PER_UPDATE) {
        console.error(
          `Update ${update._id} reached the limit of ${MAX_RECIPIENTS_PER_UPDATE} emails; the rest of the donors were not emailed.`,
        );
        stop = true;
        break;
      }

      const existing = await ctx.db
        .query("updateEmailDeliveries")
        .withIndex("by_updateId_and_email", (q) =>
          q.eq("updateId", update._id).eq("email", email),
        )
        .first();
      if (existing) continue;
      // Nothing is sent, so there is nothing to unsubscribe from: no row.
      if (await isOptedOut(ctx, email, update.fundraiserId)) continue;

      const deliveryId = await ctx.db.insert("updateEmailDeliveries", {
        updateId: update._id,
        fundraiserId: update.fundraiserId,
        email,
        token: newToken(),
        status: "PENDING",
        attempts: 0,
        generation: 0,
        createdAt: now,
      });
      await ctx.scheduler.runAfter(
        queued * SEND_SPACING_MS,
        internal.updateEmails.send,
        { deliveryId },
      );
      queued++;
      total++;
    }

    if (queued > 0) await ctx.db.patch(update._id, { emailQueuedCount: total });
    return { queued, stop };
  },
});

/**
 * Started when an update is posted with "email donors" on. Handles one page of
 * donors, then schedules itself for the next once this page's emails are out.
 */
export const fanOut = internalAction({
  args: {
    updateId: v.id("fundraiserUpdates"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const page = await ctx.runQuery(internal.updateEmails.recipientPage, {
      updateId: args.updateId,
      cursor: args.cursor,
    });
    if (page.stop) return null;

    const { queued, stop } = await ctx.runMutation(
      internal.updateEmails.queueDeliveries,
      { updateId: args.updateId, emails: page.emails },
    );
    if (stop || page.isDone) return null;

    await ctx.scheduler.runAfter(
      queued * SEND_SPACING_MS,
      internal.updateEmails.fanOut,
      { updateId: args.updateId, cursor: page.continueCursor },
    );
    return null;
  },
});

// ---- Stage 2: sending -------------------------------------------------

type SendJob =
  | { kind: "done" }
  | { kind: "skip"; reason: SkipReason }
  | {
      kind: "send";
      to: string;
      idempotencyKey: string;
      data: UpdateEmailData;
    };

export const getSendJob = internalQuery({
  args: { deliveryId: v.id("updateEmailDeliveries") },
  handler: async (ctx, args): Promise<SendJob> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (
      !delivery ||
      (delivery.status !== "PENDING" && delivery.status !== "RETRYING")
    ) {
      return { kind: "done" };
    }

    // Things can change in the minutes between queueing and sending: the
    // update hidden or removed, the fundraiser flagged, the donor opting out.
    const update = await ctx.db.get(delivery.updateId);
    if (!update || update.status !== "PUBLISHED") {
      return { kind: "skip", reason: "UPDATE_NOT_PUBLISHED" };
    }
    const fundraiser = await ctx.db.get(delivery.fundraiserId);
    if (!fundraiser || !canEmailDonorsAbout(fundraiser)) {
      return { kind: "skip", reason: "NOT_VISIBLE" };
    }
    if (await isOptedOut(ctx, delivery.email, delivery.fundraiserId)) {
      return { kind: "skip", reason: "OPTED_OUT" };
    }

    return {
      kind: "send",
      to: delivery.email,
      idempotencyKey: `update-email-${delivery._id}-${delivery.generation}`,
      data: {
        fundraiserId: fundraiser._id,
        fundraiserTitle: fundraiser.title,
        amountRaised: fundraiser.amountRaised,
        goalAmount: fundraiser.goalAmount,
        currency: fundraiser.currency,
        isOpen: fundraiser.status === "ACTIVE",
        token: delivery.token,
      },
    };
  },
});

export const send = internalAction({
  args: { deliveryId: v.id("updateEmailDeliveries") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job: SendJob = await ctx.runQuery(internal.updateEmails.getSendJob, {
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
      const email = buildUpdateEmail(job.data, {
        siteUrl,
        oneClickUrl: convexSite
          ? `${convexSite}/email/unsubscribe/${job.data.token}`
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

    await ctx.runMutation(internal.updateEmails.recordAttempt, {
      deliveryId: args.deliveryId,
      outcome,
    });
    return null;
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("updateEmailDeliveries"),
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
        `Update email ${delivery._id} for update ${delivery.updateId} failed after ${attempts} attempt(s): ${outcome.error}`,
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
    await ctx.scheduler.runAfter(delay, internal.updateEmails.send, {
      deliveryId: args.deliveryId,
    });
    return null;
  },
});

/**
 * Tries every failed update email again, for after the cause is fixed (a
 * missing API key, an unverified sending domain). Run from the dashboard or
 * the CLI:
 *
 *   npx convex run updateEmails:requeueFailed
 *
 * Works through them in batches and carries on by itself.
 */
export const requeueFailed = internalMutation({
  args: {},
  returns: v.object({ requeued: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const failed = await ctx.db
      .query("updateEmailDeliveries")
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
        internal.updateEmails.send,
        { deliveryId: delivery._id },
      );
    }

    const more = failed.length === REQUEUE_BATCH;
    if (more) {
      await ctx.scheduler.runAfter(
        failed.length * SEND_SPACING_MS,
        internal.updateEmails.requeueFailed,
        {},
      );
    }
    return { requeued: failed.length, more };
  },
});
