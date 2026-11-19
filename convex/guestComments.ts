import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  ANONYMOUS_DONOR_NAME,
  checkCommentBody,
  checkGuestName,
  COMMENT_RATE_WINDOW_MS,
  MAX_COMMENTS_PER_DAY,
  suggestedGuestName,
} from "../lib/comments";
import { noteNewComment } from "./commentEmails";
import { changeCommentsCount } from "./fundraiserComments";
import { canCommentOn, isPubliclyVisible } from "./lib/fundraiserAccess";
import { consumeRateLimit } from "./lib/rateLimit";

// Comments from someone who gave without an account.
//
// A signed-in donor is known by their account. A guest is not, and the address
// they typed when they gave was never confirmed, so it proves nothing. What
// does prove something is the receipt: it went to that address, and it carries
// a private link (donationReceipts.commentToken) that belongs to one donation.
// Whoever opens the link can comment as that donor, and that is all it can do.
//
// The link is the only credential. It is unguessable, never contains the
// address, and works without signing in, because it is opened from a mail app.
// Everything else about a comment is as for a signed-in donor: it is shown
// straight away, the organizer and staff can hide it, and anyone signed in can
// report it (see fundraiserComments.ts).

// Tokens are 32 characters. Anything much longer is not one of ours.
const MAX_TOKEN_LENGTH = 100;

// One link only ever has a handful of comments; this keeps the read bounded.
const COMMENT_SCAN_LIMIT = 50;

const INVALID_LINK = "This link isn't valid.";

/** The receipt a link belongs to, and its donation. Null for a link that isn't ours. */
async function linkFor(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<{
  receipt: Doc<"donationReceipts">;
  donation: Doc<"donations">;
} | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const receipt = await ctx.db
    .query("donationReceipts")
    .withIndex("by_commentToken", (q) => q.eq("commentToken", token))
    .unique();
  if (!receipt) return null;
  const donation = await ctx.db.get(receipt.donationId);
  if (!donation) return null;
  return { receipt, donation };
}

/** A comment this link wrote, or an error that says nothing more. */
async function requireOwnComment(
  ctx: MutationCtx,
  token: string,
  commentId: Doc<"fundraiserComments">["_id"],
) {
  const link = await linkFor(ctx, token);
  if (!link) throw new ConvexError(INVALID_LINK);

  const comment = await ctx.db.get(commentId);
  if (
    !comment ||
    comment.authorUserId !== undefined ||
    comment.donationId !== link.donation._id
  ) {
    throw new ConvexError("Comment not found.");
  }
  return comment;
}

const ownCommentValidator = v.object({
  _id: v.id("fundraiserComments"),
  authorName: v.string(),
  body: v.string(),
  createdAt: v.number(),
  editedAt: v.union(v.number(), v.null()),
  // Always true here: these are the link's own comments. It has the same shape
  // as a comment on the fundraiser page so the same card can show it.
  mine: v.boolean(),
});

/**
 * What the page behind a link shows. Null for a link that isn't valid, which
 * is the same answer however it isn't, so the page can't be used to find out
 * which links exist.
 *
 * CAN_COMMENT: the box is open. CLOSED: it isn't, right now (comments are off,
 * the fundraiser has been taken down, or the donation was given back). The
 * person's own comments are listed either way, so they can still remove them.
 */
export const forToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      // Null when the fundraiser isn't public, so there's nothing to link to.
      fundraiserId: v.union(v.id("fundraisers"), v.null()),
      fundraiserTitle: v.string(),
      access: v.union(v.literal("CAN_COMMENT"), v.literal("CLOSED")),
      // False when the donation was anonymous: the comment then shows as
      // "Anonymous donor" and there is no name to ask for.
      askName: v.boolean(),
      suggestedName: v.string(),
      comments: v.array(ownCommentValidator),
      // Comments of theirs that were hidden, which they can't see or restore.
      hiddenCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const link = await linkFor(ctx, args.token);
    if (!link) return null;
    const { donation } = link;

    const fundraiser = await ctx.db.get(donation.fundraiserId);
    const isPublic = fundraiser !== null && isPubliclyVisible(fundraiser);
    const open =
      fundraiser !== null &&
      donation.status === "COMPLETED" &&
      canCommentOn(fundraiser);

    const rows = await ctx.db
      .query("fundraiserComments")
      .withIndex("by_donationId", (q) => q.eq("donationId", donation._id))
      .order("desc")
      .take(COMMENT_SCAN_LIMIT);
    const own = rows.filter((row) => row.authorUserId === undefined);

    return {
      fundraiserId: isPublic ? donation.fundraiserId : null,
      fundraiserTitle:
        isPublic && fundraiser ? fundraiser.title : "this fundraiser",
      access: open ? ("CAN_COMMENT" as const) : ("CLOSED" as const),
      askName: !donation.isAnonymous,
      suggestedName: suggestedGuestName(donation.donorName),
      comments: own
        .filter((row) => row.status === "PUBLISHED")
        .map((row) => ({
          _id: row._id,
          authorName: row.authorName,
          body: row.body,
          createdAt: row.createdAt,
          editedAt: row.editedAt ?? null,
          mine: true,
        })),
      hiddenCount: own.filter((row) => row.status === "HIDDEN").length,
    };
  },
});

/** Posts a comment for the donor behind the link. Shown straight away. */
export const post = mutation({
  args: {
    token: v.string(),
    body: v.string(),
    // The name to show. Not used, and not needed, for an anonymous donation.
    name: v.optional(v.string()),
  },
  returns: v.id("fundraiserComments"),
  handler: async (ctx, args) => {
    const link = await linkFor(ctx, args.token);
    if (!link) throw new ConvexError(INVALID_LINK);
    const { receipt, donation } = link;

    const fundraiser = await ctx.db.get(donation.fundraiserId);
    if (!fundraiser || !canCommentOn(fundraiser)) {
      throw new ConvexError("Comments are closed on this fundraiser.");
    }
    // Checked now, not just when the link was made: a donation that was given
    // back no longer lets anyone comment.
    if (donation.status !== "COMPLETED") {
      throw new ConvexError(
        "Only people who have donated to this fundraiser can comment.",
      );
    }

    const checkedBody = checkCommentBody(args.body);
    if (!checkedBody.ok) throw new ConvexError(checkedBody.problem);

    let authorName = ANONYMOUS_DONOR_NAME;
    if (!donation.isAnonymous) {
      const checkedName = checkGuestName(args.name ?? "");
      if (!checkedName.ok) throw new ConvexError(checkedName.problem);
      authorName = checkedName.name;
    }

    const limit = await consumeRateLimit(ctx, `guestComment:${receipt._id}`, {
      max: MAX_COMMENTS_PER_DAY,
      windowMs: COMMENT_RATE_WINDOW_MS,
    });
    if (!limit.allowed) {
      throw new ConvexError(
        "You've left a lot of comments today. Please try again tomorrow.",
      );
    }

    const createdAt = Date.now();
    const commentId = await ctx.db.insert("fundraiserComments", {
      fundraiserId: fundraiser._id,
      donationId: donation._id,
      authorName,
      body: checkedBody.body,
      status: "PUBLISHED",
      createdAt,
    });
    await changeCommentsCount(ctx, fundraiser._id, 1);
    await noteNewComment(ctx, fundraiser, null, createdAt);
    return commentId;
  },
});

export const edit = mutation({
  args: {
    token: v.string(),
    commentId: v.id("fundraiserComments"),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await requireOwnComment(ctx, args.token, args.commentId);
    if (comment.status !== "PUBLISHED") {
      throw new ConvexError("This comment can't be edited.");
    }

    const checked = checkCommentBody(args.body);
    if (!checked.ok) throw new ConvexError(checked.problem);
    if (checked.body === comment.body) return null;

    await ctx.db.patch(comment._id, {
      body: checked.body,
      editedAt: Date.now(),
    });
    return null;
  },
});

/** Takes a comment down for good. Hidden ones are left to who hid them. */
export const remove = mutation({
  args: { token: v.string(), commentId: v.id("fundraiserComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await requireOwnComment(ctx, args.token, args.commentId);
    if (comment.status !== "PUBLISHED") {
      throw new ConvexError("This comment can't be removed.");
    }
    await ctx.db.patch(comment._id, { status: "REMOVED" });
    await changeCommentsCount(ctx, comment.fundraiserId, -1);
    return null;
  },
});
