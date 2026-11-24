import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { guardedJob } from "./lib/systemAlerts";
import { accumulatorValidator } from "./platformStats";

// The jobs that run on a timer (crons.ts), and the one that makes a PayPal
// donation withdrawable, each run through a guard. If the job throws, Convex
// rolls back everything it did, and on its own it only writes a line in the
// dashboard's logs. The guard also records an alert, which staff see on the
// System alerts page and, for the serious ones, in an email. See
// lib/system-alerts.ts for what each alert says.
//
// Every one of these is an action that runs the real job as a mutation, so the
// job is exactly what it was and can still be run by hand
// (`npx convex run fundraiserExpiry:expireEnded`). A job that hands the rest
// of its work to a next run schedules the guarded version, so a failure on a
// later page is caught too. The alert clears itself when a run finishes: that
// is done by the job itself, in its own transaction (clearJobAlerts).
//
// Add a new cron here, not straight into crons.ts. guardedJobs.test.ts fails
// if a cron skips the guard.

export const expireEnded = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> =>
    await guardedJob(ctx, { kind: "JOB_EXPIRE_ENDED_FAILED" }, () =>
      ctx.runMutation(internal.fundraiserExpiry.expireEnded, {}),
    ),
});

export const refreshPlatformStats = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    accumulator: v.optional(accumulatorValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> =>
    await guardedJob(ctx, { kind: "JOB_PLATFORM_STATS_FAILED" }, () =>
      ctx.runMutation(internal.platformStats.refresh, args),
    ),
});

export const sweepStaleUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> =>
    await guardedJob(ctx, { kind: "JOB_UPLOAD_SWEEP_FAILED" }, () =>
      ctx.runMutation(internal.documentUploads.sweepStaleDocumentUploads, {}),
    ),
});

export const pruneAlerts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> =>
    await guardedJob(ctx, { kind: "JOB_ALERT_PRUNE_FAILED" }, () =>
      ctx.runMutation(internal.systemAlerts.prune, {}),
    ),
});

/**
 * Scheduled for when a PayPal donation's waiting period ends. The alert names
 * the donation, because each one is its own job and nothing runs it again.
 */
export const settleDonation = internalAction({
  args: { donationId: v.id("donations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> =>
    await guardedJob(
      ctx,
      { kind: "JOB_SETTLE_DONATION_FAILED", reference: args.donationId },
      () => ctx.runMutation(internal.payoutBalances.settleDonation, args),
    ),
});
