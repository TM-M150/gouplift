import type { Doc } from "../_generated/dataModel";
import { COMMENT_STATUSES } from "../../lib/comments";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getCurrentUserDoc } from "./staff";

// A draft, a fundraiser waiting for review and a rejected one are not public.
const RESTRICTED_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "REJECTED"]);

/**
 * Whether a fundraiser is suspended: taken off the public site while staff
 * look into it (see fundraiserReports.ts). Its creator and staff still see it.
 */
export function isSuspended(fundraiser: Doc<"fundraisers">): boolean {
  return fundraiser.isFlagged === true;
}

/**
 * Whether the fundraiser is one the public could see if it weren't suspended:
 * not private, and not a draft, one waiting for review or a rejected one.
 */
export function isOpenToThePublic(fundraiser: Doc<"fundraisers">): boolean {
  return !fundraiser.isPrivate && !RESTRICTED_STATUSES.has(fundraiser.status);
}

/** Whether anybody at all, signed in or not, may see this fundraiser. */
export function isPubliclyVisible(fundraiser: Doc<"fundraisers">): boolean {
  return isOpenToThePublic(fundraiser) && !isSuspended(fundraiser);
}

/**
 * Whether donors may be emailed about something on this fundraiser. It has to
 * be one they can open, which a suspended one isn't.
 */
export function canEmailDonorsAbout(fundraiser: Doc<"fundraisers">): boolean {
  return isPubliclyVisible(fundraiser);
}

/**
 * Whether donors may leave comments on this fundraiser right now: one people
 * can open, still in a state that takes comments, and with comments not
 * switched off by its creator.
 */
export function canCommentOn(fundraiser: Doc<"fundraisers">): boolean {
  return (
    isPubliclyVisible(fundraiser) &&
    fundraiser.commentsEnabled !== false &&
    COMMENT_STATUSES.has(fundraiser.status)
  );
}

/**
 * Whether the person asking may see this fundraiser at all. Everyone may see a
 * public one. A private, suspended or not-yet-approved one is visible only to
 * its creator and to staff, and to everybody else it should look as if it
 * doesn't exist,
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
