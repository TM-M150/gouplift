import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  SYSTEM_ALERT_KEEP_RESOLVED_MS,
  SYSTEM_ALERT_KINDS,
  SYSTEM_ALERTS,
} from "../lib/system-alerts";
import { SITE_URL } from "../lib/site";
import { cleanNote } from "./lib/adminAudit";
import { sendEmail as sendViaResend } from "./lib/email";
import { literalUnion } from "./lib/organizationValidators";
import { escapeHtml } from "./lib/receiptEmail";
import { requireStaff } from "./lib/staff";
import { clearJobAlerts, recordAlert } from "./lib/systemAlerts";

// Problems behind the scenes (payments, and jobs on a timer): what is
// recorded, who is told, and what staff see. The recording itself is in
// lib/systemAlerts.ts.

const LIST_LIMIT = 100;
const RESOLVED_LIMIT = 20;
const PRUNE_BATCH = 200;

const kindValidator = literalUnion(SYSTEM_ALERT_KINDS);

const alertValidator = v.object({
  _id: v.id("systemAlerts"),
  kind: kindValidator,
  reference: v.union(v.string(), v.null()),
  detail: v.union(v.string(), v.null()),
  count: v.number(),
  firstSeenAt: v.number(),
  lastSeenAt: v.number(),
  resolvedAt: v.union(v.number(), v.null()),
  resolvedByName: v.union(v.string(), v.null()),
  resolveNote: v.union(v.string(), v.null()),
});

function toView(row: Doc<"systemAlerts">, resolvedByName: string | null) {
  return {
    _id: row._id,
    kind: row.kind,
    reference: row.reference ?? null,
    detail: row.detail ?? null,
    count: row.count,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt ?? null,
    resolvedByName,
    resolveNote: row.resolveNote ?? null,
  };
}

/** Who is emailed: ALERT_EMAIL_TO, a comma-separated list. */
function recipients(): string[] {
  return (process.env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

// ---- Recording --------------------------------------------------------

/** The way in for HTTP actions; see `reportProblem` in lib/systemAlerts.ts. */
export const record = internalMutation({
  args: {
    kind: kindValidator,
    reference: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordAlert(ctx, args);
    return null;
  },
});

// ---- Email ------------------------------------------------------------

export const getForEmail = internalQuery({
  args: { alertId: v.id("systemAlerts") },
  returns: v.union(
    v.null(),
    v.object({
      kind: kindValidator,
      reference: v.union(v.string(), v.null()),
      detail: v.union(v.string(), v.null()),
      count: v.number(),
      firstSeenAt: v.number(),
      lastNotifiedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.status !== "OPEN") return null;
    return {
      kind: alert.kind,
      reference: alert.reference ?? null,
      detail: alert.detail ?? null,
      count: alert.count,
      firstSeenAt: alert.firstSeenAt,
      lastNotifiedAt: alert.lastNotifiedAt ?? alert.lastSeenAt,
    };
  },
});

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

/**
 * Emails staff about one problem. Scheduled by the recording step, which has
 * already decided this one is worth an email. A failed send is logged and not
 * tried again: the alert is on the admin page either way.
 */
export const sendEmail = internalAction({
  args: { alertId: v.id("systemAlerts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const to = recipients();
    if (to.length === 0) {
      console.warn(
        "A problem was recorded but ALERT_EMAIL_TO isn't set, so no email was sent. Set it with `npx convex env set ALERT_EMAIL_TO you@example.com`.",
      );
      return null;
    }

    const alert = await ctx.runQuery(internal.systemAlerts.getForEmail, args);
    if (!alert) return null;

    const { title, help } = SYSTEM_ALERTS[alert.kind];
    const link = `${SITE_URL}/admin/alerts`;
    const seen =
      alert.count === 1
        ? `Seen once, ${formatTime(alert.firstSeenAt)} (Nairobi time).`
        : `Seen ${alert.count} times since ${formatTime(alert.firstSeenAt)} (Nairobi time).`;
    const lines = [
      ...(alert.detail ? [`Details: ${alert.detail}`] : []),
      ...(alert.reference ? [`Reference: ${alert.reference}`] : []),
      seen,
    ];

    const text = [
      title,
      "",
      ...lines,
      "",
      help.replaceAll("`", ""),
      "",
      `All open problems: ${link}`,
      "You won't get another email about this one for an hour.",
    ].join("\n");

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">
<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>
${lines.map((line) => `<p style="margin:0 0 6px">${escapeHtml(line)}</p>`).join("\n")}
<p style="margin:12px 0">${escapeHtml(help.replaceAll("`", ""))}</p>
<p style="margin:0 0 6px"><a href="${escapeHtml(link)}">See all open problems</a></p>
<p style="margin:0;color:#666;font-size:13px">You won't get another email about this one for an hour.</p>
</div>`;

    for (const [index, address] of to.entries()) {
      const outcome = await sendViaResend({
        to: address,
        subject: `[GoUplift] ${title}`,
        html,
        text,
        idempotencyKey: `system-alert/${args.alertId}/${alert.lastNotifiedAt}/${index}`,
      });
      if (outcome.kind === "failed") {
        console.error(
          `Could not email the ${alert.kind} alert (recipient ${index + 1} of ${to.length}):`,
          outcome.error,
        );
      }
    }
    return null;
  },
});

// ---- Staff ------------------------------------------------------------

export const emailsOn = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    await requireStaff(ctx);
    return recipients().length > 0 && Boolean(process.env.RESEND_API_KEY);
  },
});

/** Open problems, the one seen most recently first. */
export const listOpen = query({
  args: {},
  returns: v.array(alertValidator),
  handler: async (ctx) => {
    await requireStaff(ctx);
    const rows = await ctx.db
      .query("systemAlerts")
      .withIndex("by_status_and_lastSeenAt", (q) => q.eq("status", "OPEN"))
      .order("desc")
      .take(LIST_LIMIT);
    return rows.map((row) => toView(row, null));
  },
});

/** The last few that staff dealt with, so a recurrence can be compared. */
export const listResolved = query({
  args: {},
  returns: v.array(alertValidator),
  handler: async (ctx) => {
    await requireStaff(ctx);
    const rows = await ctx.db
      .query("systemAlerts")
      .withIndex("by_status_and_lastSeenAt", (q) => q.eq("status", "RESOLVED"))
      .order("desc")
      .take(RESOLVED_LIMIT);
    return await Promise.all(
      rows.map(async (row) => {
        const by = row.resolvedBy ? await ctx.db.get(row.resolvedBy) : null;
        return toView(row, by?.displayName ?? null);
      }),
    );
  },
});

/**
 * Marks a problem as dealt with. If it happens again that is a new alert, so
 * a fix that didn't hold shows up instead of being counted on a closed one.
 */
export const resolve = mutation({
  args: { alertId: v.id("systemAlerts"), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const note = cleanNote(args.note);
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new ConvexError("That alert no longer exists.");
    if (alert.status === "RESOLVED") {
      throw new ConvexError("Someone has already resolved this alert.");
    }
    await ctx.db.patch(alert._id, {
      status: "RESOLVED",
      resolvedBy: staff._id,
      resolvedAt: Date.now(),
      resolveNote: note,
    });
    return null;
  },
});

// ---- Clean-up ---------------------------------------------------------

/** Deletes resolved alerts nobody needs any more. Run daily from crons.ts. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("systemAlerts")
      .withIndex("by_status_and_lastSeenAt", (q) =>
        q
          .eq("status", "RESOLVED")
          .lt("lastSeenAt", Date.now() - SYSTEM_ALERT_KEEP_RESOLVED_MS),
      )
      .take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === PRUNE_BATCH) {
      // The guarded version, so a failure in a later batch raises an alert too.
      await ctx.scheduler.runAfter(0, internal.guardedJobs.pruneAlerts, {});
    } else {
      await clearJobAlerts(ctx, "JOB_ALERT_PRUNE_FAILED");
    }
    return null;
  },
});
