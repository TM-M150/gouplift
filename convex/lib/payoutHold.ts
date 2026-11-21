import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logAction } from "./adminAudit";

/**
 * Stops payouts for a fundraiser and writes it in the audit log. The caller has
 * already checked who may do this, that the reason is a proper one, and that
 * the fundraiser isn't on hold already. Shared by the staff action that holds
 * payouts on its own and by suspending a fundraiser, so both leave the same
 * record.
 */
export async function placePayoutHoldFor(
  ctx: MutationCtx,
  input: {
    fundraiserId: Id<"fundraisers">;
    staffId: Id<"users">;
    reason: string;
  },
): Promise<void> {
  await ctx.db.insert("fundraiserPayoutHolds", {
    fundraiserId: input.fundraiserId,
    status: "ACTIVE",
    reason: input.reason,
    placedBy: input.staffId,
    placedAt: Date.now(),
  });

  await logAction(ctx, {
    actorId: input.staffId,
    action: "PAYOUT_HOLD_PLACED",
    fundraiserId: input.fundraiserId,
    statusBefore: "NO_HOLD",
    statusAfter: "ON_HOLD",
    note: input.reason,
  });
}
