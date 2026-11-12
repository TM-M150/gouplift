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
import {
  buildReceiptEmail,
  isPlausibleEmail,
  type ReceiptData,
} from "./lib/receiptEmail";
import { SITE_URL } from "../lib/site";

// The receipt email for a completed donation.
//
// It is a scheduled step, started by the three places that mark a donation
// completed (the same way webhooks are), so a problem with email can never
// hold up or undo recording a payment. Every step is safe to repeat: there is
// one receipt row per donation, and the email service ignores a repeat of a
// request it already handled.

const REQUEUE_BATCH = 50;

const outcomeValidator = v.union(
  v.object({ kind: v.literal("sent"), emailId: v.optional(v.string()) }),
  v.object({
    kind: v.literal("skipped"),
    reason: v.literal("NOT_COMPLETED"),
  }),
  v.object({
    kind: v.literal("failed"),
    retryable: v.boolean(),
    statusCode: v.optional(v.number()),
    error: v.string(),
  }),
);

/**
 * Called, through the scheduler, when a donation is marked completed.
 * Creates the donation's receipt and starts sending it. Does nothing if the
 * donation already has one, so a repeated callback can't send two.
 */
export const queueReceipt = internalMutation({
  args: { donationId: v.id("donations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("donationReceipts")
      .withIndex("by_donationId", (q) => q.eq("donationId", args.donationId))
      .unique();
    if (existing) return null;

    const donation = await ctx.db.get(args.donationId);
    if (!donation || donation.status !== "COMPLETED") return null;

    const now = Date.now();
    const email = donation.donorEmail?.trim();
    if (!email || !isPlausibleEmail(email)) {
      await ctx.db.insert("donationReceipts", {
        donationId: args.donationId,
        status: "SKIPPED",
        skippedReason: email ? "INVALID_EMAIL" : "NO_EMAIL",
        attempts: 0,
        generation: 0,
        createdAt: now,
      });
      return null;
    }

    const receiptId = await ctx.db.insert("donationReceipts", {
      donationId: args.donationId,
      status: "PENDING",
      attempts: 0,
      generation: 0,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.receipts.send, { receiptId });
    return null;
  },
});

type ReceiptJob =
  | { kind: "done" }
  | { kind: "skip"; reason: "NOT_COMPLETED" }
  | {
      kind: "send";
      to: string;
      idempotencyKey: string;
      data: ReceiptData;
    };

export const getReceiptJob = internalQuery({
  args: { receiptId: v.id("donationReceipts") },
  handler: async (ctx, args): Promise<ReceiptJob> => {
    const receipt = await ctx.db.get(args.receiptId);
    if (
      !receipt ||
      (receipt.status !== "PENDING" && receipt.status !== "RETRYING")
    ) {
      return { kind: "done" };
    }

    const donation = await ctx.db.get(receipt.donationId);
    const to = donation?.donorEmail?.trim();
    if (!donation || !to) return { kind: "done" };
    // Refunded in the seconds since it was queued: don't send a receipt for
    // money that was given back.
    if (donation.status !== "COMPLETED") {
      return { kind: "skip", reason: "NOT_COMPLETED" };
    }

    const fundraiser = await ctx.db.get(donation.fundraiserId);
    const method = donation.paymentMethod ?? null;
    return {
      kind: "send",
      to,
      idempotencyKey: `receipt-${donation._id}-${receipt.generation}`,
      data: {
        donationId: donation._id,
        donorName: donation.donorName?.trim() || null,
        isAnonymous: donation.isAnonymous,
        fundraiserId: donation.fundraiserId,
        fundraiserTitle: fundraiser?.title ?? "a GoUplift fundraiser",
        grossAmount: donation.grossAmount,
        platformFeeRate: donation.platformFeeRate,
        platformFeeAmount: donation.platformFeeAmount,
        netAmount: donation.netAmount,
        originalCurrency: donation.originalCurrency ?? null,
        originalAmount: donation.originalAmount ?? null,
        exchangeRate: donation.exchangeRate ?? null,
        provider: donation.provider ?? null,
        paymentMethod: method,
        // A monthly PayPal payment arrives as one event and only carries the
        // sale id, in the PayPal field.
        reference:
          donation.providerTransactionCode ?? donation.paypalCaptureId ?? null,
        isMonthly: donation.isSubscriptionPayment === true,
        completedAt: donation.completedAt ?? donation.createdAt,
      },
    };
  },
});

export const send = internalAction({
  args: { receiptId: v.id("donationReceipts") },
  handler: async (ctx, args): Promise<null> => {
    const job: ReceiptJob = await ctx.runQuery(
      internal.receipts.getReceiptJob,
      { receiptId: args.receiptId },
    );
    if (job.kind === "done") return null;

    let outcome: EmailOutcome | { kind: "skipped"; reason: "NOT_COMPLETED" };
    if (job.kind === "skip") {
      outcome = { kind: "skipped", reason: job.reason };
    } else {
      const siteUrl = process.env.SITE_URL || SITE_URL;
      const email = buildReceiptEmail(job.data, siteUrl);
      outcome = await sendEmail({
        to: job.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: job.idempotencyKey,
      });
    }

    await ctx.runMutation(internal.receipts.recordAttempt, {
      receiptId: args.receiptId,
      outcome,
    });
    return null;
  },
});

export const recordAttempt = internalMutation({
  args: { receiptId: v.id("donationReceipts"), outcome: outcomeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) return null;
    if (
      receipt.status === "SENT" ||
      receipt.status === "FAILED" ||
      receipt.status === "SKIPPED"
    ) {
      return null;
    }

    const now = Date.now();
    const attempts = receipt.attempts + 1;
    const { outcome } = args;

    if (outcome.kind === "sent") {
      await ctx.db.patch(args.receiptId, {
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
      await ctx.db.patch(args.receiptId, {
        status: "SKIPPED",
        skippedReason: outcome.reason,
        lastAttemptAt: now,
        nextAttemptAt: undefined,
      });
      return null;
    }

    if (!outcome.retryable || attempts >= MAX_EMAIL_ATTEMPTS) {
      await ctx.db.patch(args.receiptId, {
        status: "FAILED",
        attempts,
        lastAttemptAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error,
        nextAttemptAt: undefined,
      });
      // Worth a line in the logs: a donor was promised a receipt. No address.
      console.error(
        `Receipt for donation ${receipt.donationId} failed after ${attempts} attempt(s): ${outcome.error}`,
      );
      return null;
    }

    const delay = EMAIL_RETRY_DELAYS_MS[attempts - 1];
    await ctx.db.patch(args.receiptId, {
      status: "RETRYING",
      attempts,
      lastAttemptAt: now,
      lastStatusCode: outcome.statusCode,
      lastError: outcome.error,
      nextAttemptAt: now + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.receipts.send, {
      receiptId: args.receiptId,
    });
    return null;
  },
});

/**
 * Tries every failed receipt again, for after the cause is fixed (a missing
 * API key, an unverified sending domain). Run from the dashboard or the CLI:
 *
 *   npx convex run receipts:requeueFailed
 *
 * Works through them in batches and carries on by itself.
 */
export const requeueFailed = internalMutation({
  args: {},
  returns: v.object({ requeued: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const failed = await ctx.db
      .query("donationReceipts")
      .withIndex("by_status", (q) => q.eq("status", "FAILED"))
      .take(REQUEUE_BATCH);

    for (const receipt of failed) {
      await ctx.db.patch(receipt._id, {
        status: "PENDING",
        attempts: 0,
        generation: receipt.generation + 1,
        lastError: undefined,
        lastStatusCode: undefined,
        nextAttemptAt: undefined,
      });
      await ctx.scheduler.runAfter(0, internal.receipts.send, {
        receiptId: receipt._id,
      });
    }

    const more = failed.length === REQUEUE_BATCH;
    if (more) {
      await ctx.scheduler.runAfter(0, internal.receipts.requeueFailed, {});
    }
    return { requeued: failed.length, more };
  },
});
