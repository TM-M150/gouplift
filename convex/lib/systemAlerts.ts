import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  SYSTEM_ALERT_DETAIL_MAX_LENGTH,
  SYSTEM_ALERT_EMAIL_COOLDOWN_MS,
  SYSTEM_ALERT_EMAILS_PER_KIND,
  SYSTEM_ALERT_THROTTLE_MS,
  SYSTEM_ALERTS,
  type SystemAlertKind,
} from "../../lib/system-alerts";

// Recording a problem with a payment so staff find out about it. See
// lib/system-alerts.ts for what the kinds mean.
//
// Two ways in. `recordAlert` is for code that is already in a mutation and
// returns normally (it is rolled back with everything else if the mutation
// throws, so it can't report that). `reportProblem` is for an HTTP action,
// which has no database of its own: it records in a mutation of its own, so
// the alert survives whatever happens to the work it is reporting on.

export interface AlertInput {
  kind: SystemAlertKind;
  /**
   * What it is about when a kind covers many payments (the provider's id for
   * the payment or notification). The same kind with the same reference is one
   * alert that is counted again; leave it out for a problem with the setup.
   */
  reference?: string;
  /** What went wrong, in a sentence. Never a provider's payload. */
  detail?: string;
}

// Kept here, not in lib/system-alerts.ts: that file is also sent to staff's
// browsers, and these patterns (lookbehind) don't parse in older Safari.
// A Kenyan mobile number as people write it (0712 345 678, +254712345678), or
// any number that starts with a plus sign. It must not start in the middle of
// a word, so an id such as ws_CO_0712345678 (which is what finds a payment in
// the provider's dashboard) is left alone.
const PHONE_NUMBER =
  /(?<!\w)(?:\+?254|0)[\s-]?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)|(?<!\w)\+\d[\d\s-]{8,14}\d(?!\d)/g;
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * What goes in an alert's details. Short, on one line, and with anything that
 * looks like a person's email address or phone number taken out: details come
 * from error messages, and an error message can quote what it choked on.
 */
export function cleanAlertDetail(text: string): string {
  const scrubbed = text
    .replace(EMAIL_ADDRESS, "[email]")
    .replace(PHONE_NUMBER, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed.length > SYSTEM_ALERT_DETAIL_MAX_LENGTH
    ? `${scrubbed.slice(0, SYSTEM_ALERT_DETAIL_MAX_LENGTH - 1)}…`
    : scrubbed;
}

// More open alerts than this for one kind are counted on the newest one, so a
// flood can't grow the table.
const MAX_OPEN_PER_KIND = 50;
const MAX_REFERENCE_LENGTH = 100;

export async function recordAlert(
  ctx: MutationCtx,
  input: AlertInput,
): Promise<void> {
  const now = Date.now();
  const reference = input.reference?.trim().slice(0, MAX_REFERENCE_LENGTH);
  const detail = input.detail ? cleanAlertDetail(input.detail) : "";

  const open = await ctx.db
    .query("systemAlerts")
    .withIndex("by_kind_and_status", (q) =>
      q.eq("kind", input.kind).eq("status", "OPEN"),
    )
    .order("desc")
    .take(MAX_OPEN_PER_KIND);

  const same =
    open.find((row) => row.reference === (reference || undefined)) ??
    (open.length >= MAX_OPEN_PER_KIND ? open[0] : undefined);

  // Anyone can send a bad token, so a burst of them counts as one.
  if (same && now - same.lastSeenAt < SYSTEM_ALERT_THROTTLE_MS) return;

  const notify = shouldEmail(input.kind, same, open, now);

  let alertId: Id<"systemAlerts">;
  if (same) {
    alertId = same._id;
    await ctx.db.patch(same._id, {
      count: same.count + 1,
      lastSeenAt: now,
      detail: detail || same.detail,
      ...(notify ? { lastNotifiedAt: now } : {}),
    });
  } else {
    alertId = await ctx.db.insert("systemAlerts", {
      kind: input.kind,
      reference: reference || undefined,
      status: "OPEN",
      detail: detail || undefined,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      ...(notify ? { lastNotifiedAt: now } : {}),
    });
  }

  if (notify) {
    await ctx.scheduler.runAfter(0, internal.systemAlerts.sendEmail, {
      alertId,
    });
  }
}

/** Only real problems are emailed, and not the same one every few minutes. */
function shouldEmail(
  kind: SystemAlertKind,
  same: Doc<"systemAlerts"> | undefined,
  open: Doc<"systemAlerts">[],
  now: number,
): boolean {
  if (SYSTEM_ALERTS[kind].severity !== "ERROR") return false;

  const recently = (row: Doc<"systemAlerts">) =>
    row.lastNotifiedAt !== undefined &&
    now - row.lastNotifiedAt < SYSTEM_ALERT_EMAIL_COOLDOWN_MS;

  if (same && recently(same)) return false;
  return open.filter(recently).length < SYSTEM_ALERT_EMAILS_PER_KIND;
}

/**
 * For an HTTP action: records the problem and carries on. Never throws, so
 * reporting a problem can't change the answer the caller was about to give.
 */
export async function reportProblem(
  ctx: Pick<ActionCtx, "runMutation">,
  input: AlertInput,
): Promise<void> {
  try {
    await ctx.runMutation(internal.systemAlerts.record, input);
  } catch (error) {
    console.error(
      `Could not record the ${input.kind} alert:`,
      describeError(error),
    );
  }
}

/** An error as one line. Convex puts a request id in server errors' messages. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.replace(/\[Request ID: [^\]]*\]\s*/g, "").trim() || "Unknown error"
  );
}
