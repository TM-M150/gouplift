import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { EMAIL_NOT_CONFIRMED_MESSAGE } from "../../lib/email-confirmation";

/**
 * Stops anyone whose email address has not been confirmed. Used where money
 * moves out: asking for a payout, and adding or changing the account it goes to.
 * Everything else on GoUplift works without it.
 *
 * It fails closed: if the account can't be read, or says anything other than
 * "confirmed", the answer is no. The sign-in state lives in better-auth, so this
 * asks it directly rather than a copy.
 */
export async function requireConfirmedEmail(
  ctx: QueryCtx | MutationCtx,
): Promise<void> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (authUser?.emailVerified !== true) {
    throw new ConvexError(EMAIL_NOT_CONFIRMED_MESSAGE);
  }
}
