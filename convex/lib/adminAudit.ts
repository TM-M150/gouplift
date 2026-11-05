import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Shared by every staff decision (organization review, payout holds, KYC
// review), so each writes its notes and its audit entry the same way.

export const MAX_NOTE_LENGTH = 1000;
export const MIN_REJECTION_REASON_LENGTH = 10;

/** Trimmed note, or undefined when blank. Throws when it is too long. */
export function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new ConvexError(`Keep notes under ${MAX_NOTE_LENGTH} characters.`);
  }
  return trimmed;
}

export async function logAction(
  ctx: MutationCtx,
  entry: Omit<Doc<"adminAuditLog">, "_id" | "_creationTime" | "createdAt">,
) {
  await ctx.db.insert("adminAuditLog", { ...entry, createdAt: Date.now() });
}
