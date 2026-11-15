import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentUserDoc } from "./staff";

// A draft, a fundraiser waiting for review and a rejected one are not public.
const RESTRICTED_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "REJECTED"]);

/** Whether anybody at all, signed in or not, may see this fundraiser. */
export function isPubliclyVisible(fundraiser: Doc<"fundraisers">): boolean {
  return !fundraiser.isPrivate && !RESTRICTED_STATUSES.has(fundraiser.status);
}

/**
 * Whether donors may be emailed about something on this fundraiser. It has to
 * be one they can open, and not one under review after a report.
 */
export function canEmailDonorsAbout(fundraiser: Doc<"fundraisers">): boolean {
  return isPubliclyVisible(fundraiser) && !fundraiser.isFlagged;
}

/**
 * Whether the person asking may see this fundraiser at all. Everyone may see a
 * public one. A private or not-yet-approved one is visible only to its creator
 * and to staff, and to everybody else it should look as if it doesn't exist,
 * so anything that hangs off a fundraiser (its updates, for one) has to ask
 * the same question the fundraiser page does.
 */
export async function canViewFundraiser(
  ctx: QueryCtx | MutationCtx,
  fundraiser: Doc<"fundraisers">,
): Promise<boolean> {
  if (isPubliclyVisible(fundraiser)) return true;

  const user = await getCurrentUserDoc(ctx);
  if (!user) return false;
  return (
    user._id === fundraiser.creatorId ||
    user.role === "ADMIN" ||
    user.role === "MODERATOR"
  );
}
