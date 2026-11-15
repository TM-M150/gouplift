import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Who has asked not to be emailed about fundraiser updates. Addresses are
// compared in lower case, however they were typed at checkout.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Whether this address has opted out of this fundraiser's updates, of all of them, or both. */
export async function optOutState(
  ctx: QueryCtx | MutationCtx,
  email: string,
  fundraiserId: Id<"fundraisers">,
): Promise<{ forFundraiser: boolean; forAll: boolean }> {
  const forFundraiser = await ctx.db
    .query("updateEmailOptOuts")
    .withIndex("by_email_and_fundraiserId", (q) =>
      q.eq("email", email).eq("fundraiserId", fundraiserId),
    )
    .first();
  const forAll = await ctx.db
    .query("updateEmailOptOuts")
    .withIndex("by_email_and_fundraiserId", (q) =>
      q.eq("email", email).eq("fundraiserId", undefined),
    )
    .first();
  return { forFundraiser: forFundraiser !== null, forAll: forAll !== null };
}

/** Whether this address must not be emailed about this fundraiser's updates. */
export async function isOptedOut(
  ctx: QueryCtx | MutationCtx,
  email: string,
  fundraiserId: Id<"fundraisers">,
): Promise<boolean> {
  const state = await optOutState(ctx, email, fundraiserId);
  return state.forFundraiser || state.forAll;
}

/** Records an opt-out, once however many times it is asked for. */
export async function recordOptOut(
  ctx: MutationCtx,
  email: string,
  fundraiserId: Id<"fundraisers"> | undefined,
): Promise<void> {
  const existing = await ctx.db
    .query("updateEmailOptOuts")
    .withIndex("by_email_and_fundraiserId", (q) =>
      q.eq("email", email).eq("fundraiserId", fundraiserId),
    )
    .first();
  if (existing) return;
  await ctx.db.insert("updateEmailOptOuts", {
    email,
    fundraiserId,
    createdAt: Date.now(),
  });
}
