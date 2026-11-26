import { ConvexError, v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  ANONYMOUS_DONOR_NAME,
  checkCommentBody,
  COMMENT_RATE_WINDOW_MS,
  MAX_COMMENTS_PER_DAY,
  MAX_REPORTS_PER_DAY,
  REPORT_RATE_WINDOW_MS,
} from "../lib/comments";
import { publicAuthorName } from "../lib/testimonials";
import { noteNewComment } from "./commentEmails";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { canCommentOn, canViewFundraiser } from "./lib/fundraiserAccess";
import { consumeRateLimit } from "./lib/rateLimit";
import {
  getCurrentUserDoc,
  getStaffUser,
  isActiveStaff,
  requireStaff,
} from "./lib/staff";

// Comments: a person who has donated to a fundraiser can say something on its
// page. (Someone who gave without an account does it through the private link
// in their receipt: see guestComments.ts.) Anyone who may see the fundraiser
// may read them. Their author may edit or remove one; the fundraiser's creator
// and staff may hide one (staff can put any back, the creator only the ones
// they hid); anyone signed in may report one, and staff work through the
// reports.

const PAGE_LIMIT = 50;
const HIDDEN_LIMIT = 30;
// A person has a handful of donations to one fundraiser at most; this only
// keeps the read bounded.
const DONATION_SCAN_LIMIT = 100;
// Open reports read for the staff queue, and comments shown from them.
const REPORT_SCAN_LIMIT = 200;
const QUEUE_LIMIT = 50;
// Open reports on one comment resolved at once when staff act on it.
const RESOLVE_LIMIT = 200;

const reportReasonValidator = v.union(
  v.literal("SPAM"),
  v.literal("ABUSIVE"),
  v.literal("OFF_PLATFORM_PAYMENT"),
  v.literal("PRIVATE_INFO"),
  v.literal("OTHER"),
);

const publicCommentValidator = v.object({
  _id: v.id("fundraiserComments"),
  authorName: v.string(),
  body: v.string(),
  createdAt: v.number(),
  editedAt: v.union(v.number(), v.null()),
  // Whether the person asking wrote it, so they get edit and remove.
  mine: v.boolean(),
});

function present(row: Doc<"fundraiserComments">, viewerId: Id<"users"> | null) {
  return {
    _id: row._id,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    mine: viewerId !== null && row.authorUserId === viewerId,
  };
}

async function isStaffUser(
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
): Promise<boolean> {
  return await isActiveStaff(ctx, user);
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUserDoc(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

/** Keeps the fundraiser's count of published comments in step. */
export async function changeCommentsCount(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  change: 1 | -1,
) {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!fundraiser) return;
  await ctx.db.patch(fundraiserId, {
    commentsCount: Math.max(0, (fundraiser.commentsCount ?? 0) + change),
  });
}

/** A comment the signed-in person wrote, or an error that says nothing more. */
async function requireOwnComment(
  ctx: MutationCtx,
  commentId: Id<"fundraiserComments">,
) {
  const user = await requireUser(ctx);
  const comment = await ctx.db.get(commentId);
  if (!comment || comment.authorUserId !== user._id) {
    throw new ConvexError("Comment not found.");
  }
  return { user, comment };
}

/** The person's completed donations to the fundraiser, oldest first. */
async function completedDonations(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  fundraiserId: Id<"fundraisers">,
) {
  const donations = await ctx.db
    .query("donations")
    .withIndex("by_donorUserId_and_fundraiserId", (q) =>
      q.eq("donorUserId", userId).eq("fundraiserId", fundraiserId),
    )
    .take(DONATION_SCAN_LIMIT);
  return donations.filter((donation) => donation.status === "COMPLETED");
}

/** Marks the open reports on a comment as dealt with. */
async function resolveReports(
  ctx: MutationCtx,
  commentId: Id<"fundraiserComments">,
  status: "ACTIONED" | "DISMISSED",
  staffId: Id<"users">,
) {
  const open = await ctx.db
    .query("fundraiserCommentReports")
    .withIndex("by_commentId_and_status", (q) =>
      q.eq("commentId", commentId).eq("status", "OPEN"),
    )
    .take(RESOLVE_LIMIT);
  const now = Date.now();
  for (const report of open) {
    await ctx.db.patch(report._id, {
      status,
      resolvedBy: staffId,
      resolvedAt: now,
    });
  }
}

// ---- Reading ----------------------------------------------------------

/** The published comments of a fundraiser, newest first. */
export const list = query({
  args: {
    fundraiserId: v.id("fundraisers"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(publicCommentValidator),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    // Not visible, or not there: the same empty answer either way.
    if (!fundraiser || !(await canViewFundraiser(ctx, fundraiser))) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const viewer = await getCurrentUserDoc(ctx);
    const numItems = Math.min(args.paginationOpts.numItems, PAGE_LIMIT);
    const result = await ctx.db
      .query("fundraiserComments")
      .withIndex("by_fundraiserId_and_status_and_createdAt", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "PUBLISHED"),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems });
    return {
      ...result,
      page: result.page.map((row) => present(row, viewer?._id ?? null)),
    };
  },
});

/**
 * What the person asking can do about commenting on this fundraiser.
 * CLOSED: nobody can, right now. SIGNED_OUT and NOT_A_DONOR: the comment box
 * isn't theirs, and why. CAN_COMMENT: it is.
 */
export const myAccess = query({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.union(
    v.literal("CLOSED"),
    v.literal("SIGNED_OUT"),
    v.literal("NOT_A_DONOR"),
    v.literal("CAN_COMMENT"),
  ),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !canCommentOn(fundraiser)) return "CLOSED";

    const user = await getCurrentUserDoc(ctx);
    if (!user) return "SIGNED_OUT";

    const donations = await completedDonations(ctx, user._id, fundraiser._id);
    return donations.length > 0 ? "CAN_COMMENT" : "NOT_A_DONOR";
  },
});

/**
 * Hidden comments of a fundraiser. Staff see all of them, with the reason. The
 * creator sees the ones hidden by them (which they can restore) and the ones
 * hidden by staff (which they can't). Anyone else sees only their own, so a
 * comment that vanished isn't a mystery.
 */
export const listHidden = query({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.array(
    v.object({
      _id: v.id("fundraiserComments"),
      authorName: v.string(),
      body: v.string(),
      createdAt: v.number(),
      hiddenAt: v.union(v.number(), v.null()),
      // Who hid it, for the creator and staff; the author isn't told.
      hiddenBy: v.union(v.literal("CREATOR"), v.literal("STAFF"), v.null()),
      reason: v.union(v.string(), v.null()),
      canRestore: v.boolean(),
      mine: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) return [];

    const staff = await getStaffUser(ctx);
    const user = staff ?? (await getCurrentUserDoc(ctx));
    if (!user) return [];
    const isStaff = staff !== null;
    const isCreator = user._id === fundraiser.creatorId;

    const rows = await ctx.db
      .query("fundraiserComments")
      .withIndex("by_fundraiserId_and_status_and_createdAt", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "HIDDEN"),
      )
      .order("desc")
      .take(HIDDEN_LIMIT);

    return rows
      .filter((row) => isStaff || isCreator || row.authorUserId === user._id)
      .map((row) => ({
        _id: row._id,
        authorName: row.authorName,
        body: row.body,
        createdAt: row.createdAt,
        hiddenAt: row.hiddenAt ?? null,
        hiddenBy: isStaff || isCreator ? (row.hiddenBy ?? null) : null,
        reason: isStaff ? (row.hiddenReason ?? null) : null,
        canRestore: isStaff || (isCreator && row.hiddenBy === "CREATOR"),
        mine: row.authorUserId === user._id,
      }));
  },
});

// ---- The author -------------------------------------------------------

export const postComment = mutation({
  args: { fundraiserId: v.id("fundraisers"), body: v.string() },
  returns: v.id("fundraiserComments"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !(await canViewFundraiser(ctx, fundraiser))) {
      throw new ConvexError("Fundraiser not found.");
    }
    if (!canCommentOn(fundraiser)) {
      throw new ConvexError("Comments are closed on this fundraiser.");
    }

    const donations = await completedDonations(ctx, user._id, fundraiser._id);
    const latest = donations[donations.length - 1];
    if (!latest) {
      throw new ConvexError(
        "Only people who have donated to this fundraiser can comment.",
      );
    }

    const checked = checkCommentBody(args.body);
    if (!checked.ok) throw new ConvexError(checked.problem);

    const limit = await consumeRateLimit(
      ctx,
      `fundraiserComment:${fundraiser._id}:${user._id}`,
      { max: MAX_COMMENTS_PER_DAY, windowMs: COMMENT_RATE_WINDOW_MS },
    );
    if (!limit.allowed) {
      throw new ConvexError(
        "You've left a lot of comments here today. Please try again tomorrow.",
      );
    }

    // Named, unless every donation they made here was given anonymously.
    const named = donations.some((donation) => !donation.isAnonymous);
    const createdAt = Date.now();
    const commentId = await ctx.db.insert("fundraiserComments", {
      fundraiserId: fundraiser._id,
      authorUserId: user._id,
      donationId: latest._id,
      authorName: named
        ? publicAuthorName(user.displayName)
        : ANONYMOUS_DONOR_NAME,
      body: checked.body,
      status: "PUBLISHED",
      createdAt,
    });
    await changeCommentsCount(ctx, fundraiser._id, 1);
    // Lets the organizer know, in a digest rather than one email per comment.
    await noteNewComment(ctx, fundraiser, user._id, createdAt);
    return commentId;
  },
});

export const editComment = mutation({
  args: { commentId: v.id("fundraiserComments"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { comment } = await requireOwnComment(ctx, args.commentId);
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
export const removeComment = mutation({
  args: { commentId: v.id("fundraiserComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { comment } = await requireOwnComment(ctx, args.commentId);
    if (comment.status !== "PUBLISHED") {
      throw new ConvexError("This comment can't be removed.");
    }
    await ctx.db.patch(comment._id, { status: "REMOVED" });
    await changeCommentsCount(ctx, comment.fundraiserId, -1);
    return null;
  },
});

// ---- The creator and staff --------------------------------------------

/**
 * Hides a published comment. The fundraiser's creator may hide any comment on
 * it, without giving a reason. Staff must give one, which goes in the audit
 * log, and it marks the reports on the comment as dealt with.
 */
export const hideComment = mutation({
  args: {
    commentId: v.id("fundraiserComments"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new ConvexError("Comment not found.");

    const fundraiser = await ctx.db.get(comment.fundraiserId);
    const isStaff = await isStaffUser(ctx, user);
    const isCreator = fundraiser?.creatorId === user._id;
    // Anyone else is told what they'd be told about a comment that isn't there.
    if (!isStaff && !isCreator) throw new ConvexError("Comment not found.");

    if (comment.status !== "PUBLISHED") {
      throw new ConvexError("Only a published comment can be hidden.");
    }

    const now = Date.now();
    if (isStaff) {
      const reason = cleanNote(args.reason);
      if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
        throw new ConvexError(
          `Give a reason of at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
        );
      }
      await ctx.db.patch(comment._id, {
        status: "HIDDEN",
        hiddenBy: "STAFF",
        hiddenByUserId: user._id,
        hiddenAt: now,
        hiddenReason: reason,
      });
      await resolveReports(ctx, comment._id, "ACTIONED", user._id);
      await logAction(ctx, {
        actorId: user._id,
        action: "FUNDRAISER_COMMENT_HIDDEN",
        fundraiserId: comment.fundraiserId,
        fundraiserCommentId: comment._id,
        statusBefore: "PUBLISHED",
        statusAfter: "HIDDEN",
        note: reason,
      });
    } else {
      await ctx.db.patch(comment._id, {
        status: "HIDDEN",
        hiddenBy: "CREATOR",
        hiddenByUserId: user._id,
        hiddenAt: now,
      });
    }
    await changeCommentsCount(ctx, comment.fundraiserId, -1);
    return null;
  },
});

/**
 * Puts a hidden comment back. Staff can restore any. The creator can restore
 * one they hid themselves, not one staff hid.
 */
export const restoreComment = mutation({
  args: { commentId: v.id("fundraiserComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new ConvexError("Comment not found.");

    const fundraiser = await ctx.db.get(comment.fundraiserId);
    const isStaff = await isStaffUser(ctx, user);
    const isCreator = fundraiser?.creatorId === user._id;
    if (!isStaff && !isCreator) throw new ConvexError("Comment not found.");

    if (comment.status !== "HIDDEN") {
      throw new ConvexError("Only a hidden comment can be restored.");
    }
    if (!isStaff && comment.hiddenBy !== "CREATOR") {
      throw new ConvexError("Only GoUplift staff can restore this comment.");
    }

    await ctx.db.patch(comment._id, {
      status: "PUBLISHED",
      hiddenBy: undefined,
      hiddenByUserId: undefined,
      hiddenAt: undefined,
      hiddenReason: undefined,
    });
    await changeCommentsCount(ctx, comment.fundraiserId, 1);
    if (isStaff) {
      await logAction(ctx, {
        actorId: user._id,
        action: "FUNDRAISER_COMMENT_RESTORED",
        fundraiserId: comment.fundraiserId,
        fundraiserCommentId: comment._id,
        statusBefore: "HIDDEN",
        statusAfter: "PUBLISHED",
      });
    }
    return null;
  },
});

// ---- Reports ----------------------------------------------------------

/** Tells staff a comment shouldn't be there. Once per person per comment. */
export const reportComment = mutation({
  args: {
    commentId: v.id("fundraiserComments"),
    reason: reportReasonValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    const fundraiser = comment ? await ctx.db.get(comment.fundraiserId) : null;
    if (
      !comment ||
      comment.status !== "PUBLISHED" ||
      !fundraiser ||
      !(await canViewFundraiser(ctx, fundraiser))
    ) {
      throw new ConvexError("Comment not found.");
    }
    if (comment.authorUserId === user._id) {
      throw new ConvexError("You can't report your own comment.");
    }

    // Reporting twice changes nothing, and doesn't count against the limit.
    const already = await ctx.db
      .query("fundraiserCommentReports")
      .withIndex("by_commentId_and_reporterUserId", (q) =>
        q.eq("commentId", comment._id).eq("reporterUserId", user._id),
      )
      .first();
    if (already) return null;

    const limit = await consumeRateLimit(ctx, `commentReport:${user._id}`, {
      max: MAX_REPORTS_PER_DAY,
      windowMs: REPORT_RATE_WINDOW_MS,
    });
    if (!limit.allowed) {
      throw new ConvexError(
        "You've sent a lot of reports today. Please try again tomorrow.",
      );
    }

    await ctx.db.insert("fundraiserCommentReports", {
      commentId: comment._id,
      fundraiserId: comment.fundraiserId,
      reporterUserId: user._id,
      reason: args.reason,
      status: "OPEN",
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * The reported comments staff have yet to look at, the one reported longest
 * ago first. Comments that are no longer shown (hidden, removed) are left out.
 */
export const listReported = query({
  args: {},
  returns: v.array(
    v.object({
      commentId: v.id("fundraiserComments"),
      fundraiserId: v.id("fundraisers"),
      fundraiserTitle: v.string(),
      authorName: v.string(),
      // A guest has no account, so staff can't look the person up.
      isGuest: v.boolean(),
      body: v.string(),
      createdAt: v.number(),
      reportCount: v.number(),
      reasons: v.array(
        v.object({ reason: reportReasonValidator, count: v.number() }),
      ),
      firstReportedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    const open = await ctx.db
      .query("fundraiserCommentReports")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "OPEN"))
      .order("asc")
      .take(REPORT_SCAN_LIMIT);

    // One entry per comment, in the order its first report came in.
    const grouped = new Map<
      Id<"fundraiserComments">,
      {
        firstAt: number;
        reasons: Map<Doc<"fundraiserCommentReports">["reason"], number>;
      }
    >();
    for (const report of open) {
      const entry = grouped.get(report.commentId) ?? {
        firstAt: report.createdAt,
        reasons: new Map(),
      };
      entry.reasons.set(
        report.reason,
        (entry.reasons.get(report.reason) ?? 0) + 1,
      );
      grouped.set(report.commentId, entry);
    }

    const rows = [];
    for (const [commentId, entry] of grouped) {
      if (rows.length >= QUEUE_LIMIT) break;
      const comment = await ctx.db.get(commentId);
      if (!comment || comment.status !== "PUBLISHED") continue;
      const fundraiser = await ctx.db.get(comment.fundraiserId);
      const reasons = [...entry.reasons].map(([reason, count]) => ({
        reason,
        count,
      }));
      rows.push({
        commentId,
        fundraiserId: comment.fundraiserId,
        fundraiserTitle: fundraiser?.title ?? "Deleted fundraiser",
        authorName: comment.authorName,
        isGuest: comment.authorUserId === undefined,
        body: comment.body,
        createdAt: comment.createdAt,
        reportCount: reasons.reduce((sum, item) => sum + item.count, 0),
        reasons,
        firstReportedAt: entry.firstAt,
      });
    }
    return rows;
  },
});

/** Staff looked and the comment can stay: the open reports on it are closed. */
export const dismissReports = mutation({
  args: { commentId: v.id("fundraiserComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new ConvexError("Comment not found.");

    await resolveReports(ctx, comment._id, "DISMISSED", staff._id);
    await logAction(ctx, {
      actorId: staff._id,
      action: "FUNDRAISER_COMMENT_REPORTS_DISMISSED",
      fundraiserId: comment.fundraiserId,
      fundraiserCommentId: comment._id,
    });
    return null;
  },
});
