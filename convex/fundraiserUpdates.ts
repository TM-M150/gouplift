import { ConvexError, v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import type { Doc } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  checkUpdateBody,
  MAX_UPDATES_PER_DAY,
  UPDATE_POSTING_STATUSES,
  UPDATE_RATE_WINDOW_MS,
} from "../lib/updates";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { canViewFundraiser } from "./lib/fundraiserAccess";
import { consumeRateLimit } from "./lib/rateLimit";
import { getCurrentUserDoc, getStaffUser, requireStaff } from "./lib/staff";

// Progress updates: the fundraiser's creator tells donors how it is going.
// Anyone who may see the fundraiser may read its updates; only its creator
// may post, edit or remove them; staff may hide one and put it back.

const PAGE_LIMIT = 50;
const HIDDEN_LIMIT = 20;

const publicUpdateValidator = v.object({
  _id: v.id("fundraiserUpdates"),
  body: v.string(),
  createdAt: v.number(),
  editedAt: v.union(v.number(), v.null()),
});

function present(row: Doc<"fundraiserUpdates">) {
  return {
    _id: row._id,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
  };
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUserDoc(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

/** Keeps the fundraiser's count of published updates in step. */
async function changeUpdatesCount(
  ctx: MutationCtx,
  fundraiserId: Doc<"fundraisers">["_id"],
  change: 1 | -1,
) {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!fundraiser) return;
  await ctx.db.patch(fundraiserId, {
    updatesCount: Math.max(0, (fundraiser.updatesCount ?? 0) + change),
  });
}

/** An update the signed-in person wrote, or an error that says nothing more. */
async function requireOwnUpdate(
  ctx: MutationCtx,
  updateId: Doc<"fundraiserUpdates">["_id"],
) {
  const user = await requireUser(ctx);
  const update = await ctx.db.get(updateId);
  if (!update || update.authorUserId !== user._id) {
    throw new ConvexError("Update not found.");
  }
  return { user, update };
}

// ---- Public -----------------------------------------------------------

/** The published updates of a fundraiser, newest first. */
export const list = query({
  args: {
    fundraiserId: v.id("fundraisers"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(publicUpdateValidator),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    // Not visible, or not there: the same empty answer either way.
    if (!fundraiser || !(await canViewFundraiser(ctx, fundraiser))) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const numItems = Math.min(args.paginationOpts.numItems, PAGE_LIMIT);
    const result = await ctx.db
      .query("fundraiserUpdates")
      .withIndex("by_fundraiserId_and_status_and_createdAt", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "PUBLISHED"),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems });
    return { ...result, page: result.page.map(present) };
  },
});

// ---- The creator ------------------------------------------------------

export const postUpdate = mutation({
  args: { fundraiserId: v.id("fundraisers"), body: v.string() },
  returns: v.object({ updateId: v.id("fundraiserUpdates") }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const fundraiser = await ctx.db.get(args.fundraiserId);
    // Someone else's fundraiser looks the same as one that isn't there.
    if (!fundraiser || fundraiser.creatorId !== user._id) {
      throw new ConvexError("Fundraiser not found.");
    }
    if (!UPDATE_POSTING_STATUSES.has(fundraiser.status)) {
      throw new ConvexError(
        "You can post updates once your fundraiser has been approved.",
      );
    }

    const checked = checkUpdateBody(args.body);
    if (!checked.ok) throw new ConvexError(checked.problem);

    const limit = await consumeRateLimit(
      ctx,
      `fundraiserUpdate:${fundraiser._id}`,
      { max: MAX_UPDATES_PER_DAY, windowMs: UPDATE_RATE_WINDOW_MS },
    );
    if (!limit.allowed) {
      throw new ConvexError(
        "You've posted a lot of updates today. Please try again tomorrow.",
      );
    }

    const updateId = await ctx.db.insert("fundraiserUpdates", {
      fundraiserId: fundraiser._id,
      authorUserId: user._id,
      body: checked.body,
      status: "PUBLISHED",
      createdAt: Date.now(),
    });
    await changeUpdatesCount(ctx, fundraiser._id, 1);
    return { updateId };
  },
});

export const editUpdate = mutation({
  args: { updateId: v.id("fundraiserUpdates"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { update } = await requireOwnUpdate(ctx, args.updateId);
    if (update.status !== "PUBLISHED") {
      throw new ConvexError("This update can't be edited.");
    }

    const checked = checkUpdateBody(args.body);
    if (!checked.ok) throw new ConvexError(checked.problem);
    if (checked.body === update.body) return null;

    await ctx.db.patch(update._id, {
      body: checked.body,
      editedAt: Date.now(),
    });
    return null;
  },
});

/** Takes an update down for good. Staff-hidden ones are left to staff. */
export const removeUpdate = mutation({
  args: { updateId: v.id("fundraiserUpdates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { update } = await requireOwnUpdate(ctx, args.updateId);
    if (update.status !== "PUBLISHED") {
      throw new ConvexError("This update can't be removed.");
    }
    await ctx.db.patch(update._id, { status: "REMOVED" });
    await changeUpdatesCount(ctx, update.fundraiserId, -1);
    return null;
  },
});

// ---- Staff ------------------------------------------------------------

export const hideUpdate = mutation({
  args: { updateId: v.id("fundraiserUpdates"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const update = await ctx.db.get(args.updateId);
    if (!update) throw new ConvexError("Update not found.");
    if (update.status !== "PUBLISHED") {
      throw new ConvexError("Only a published update can be hidden.");
    }

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        `Give a reason of at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
      );
    }

    await ctx.db.patch(update._id, {
      status: "HIDDEN",
      hiddenBy: staff._id,
      hiddenAt: Date.now(),
      hiddenReason: reason,
    });
    await changeUpdatesCount(ctx, update.fundraiserId, -1);
    await logAction(ctx, {
      actorId: staff._id,
      action: "FUNDRAISER_UPDATE_HIDDEN",
      fundraiserId: update.fundraiserId,
      fundraiserUpdateId: update._id,
      statusBefore: "PUBLISHED",
      statusAfter: "HIDDEN",
      note: reason,
    });
    return null;
  },
});

export const restoreUpdate = mutation({
  args: { updateId: v.id("fundraiserUpdates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const update = await ctx.db.get(args.updateId);
    if (!update) throw new ConvexError("Update not found.");
    if (update.status !== "HIDDEN") {
      throw new ConvexError("Only a hidden update can be restored.");
    }

    await ctx.db.patch(update._id, {
      status: "PUBLISHED",
      hiddenBy: undefined,
      hiddenAt: undefined,
      hiddenReason: undefined,
    });
    await changeUpdatesCount(ctx, update.fundraiserId, 1);
    await logAction(ctx, {
      actorId: staff._id,
      action: "FUNDRAISER_UPDATE_RESTORED",
      fundraiserId: update.fundraiserId,
      fundraiserUpdateId: update._id,
      statusBefore: "HIDDEN",
      statusAfter: "PUBLISHED",
    });
    return null;
  },
});

/**
 * Hidden updates of a fundraiser. Staff see all of them with the reason, so
 * they can put one back. The creator sees their own, without the reason, so
 * an update that vanished isn't a mystery. Everyone else gets nothing.
 */
export const listHidden = query({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.array(
    v.object({
      _id: v.id("fundraiserUpdates"),
      body: v.string(),
      createdAt: v.number(),
      hiddenAt: v.union(v.number(), v.null()),
      reason: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) return [];

    const staff = await getStaffUser(ctx);
    const user = staff ?? (await getCurrentUserDoc(ctx));
    const isStaff = staff !== null;
    if (!user || (!isStaff && user._id !== fundraiser.creatorId)) return [];

    const rows = await ctx.db
      .query("fundraiserUpdates")
      .withIndex("by_fundraiserId_and_status_and_createdAt", (q) =>
        q.eq("fundraiserId", args.fundraiserId).eq("status", "HIDDEN"),
      )
      .order("desc")
      .take(HIDDEN_LIMIT);

    return rows.map((row) => ({
      _id: row._id,
      body: row.body,
      createdAt: row.createdAt,
      hiddenAt: row.hiddenAt ?? null,
      reason: isStaff ? (row.hiddenReason ?? null) : null,
    }));
  },
});
