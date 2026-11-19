import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  checkTestimonial,
  MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY,
  MIN_TESTIMONIAL_KYC_TIER,
  publicAuthorName,
  TESTIMONIAL_RATE_WINDOW_MS,
} from "../lib/testimonials";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getKycTier } from "./lib/kycTier";
import { consumeRateLimit } from "./lib/rateLimit";
import { getCurrentUserDoc, getStaffUser, requireStaff } from "./lib/staff";

// What people say about GoUplift, written from their profile: a star rating, a
// few words, and a private suggestion for our team. Anyone with an account can
// write one. Two things then have to be true before anyone else sees the words:
// a moderator approved them, and their author holds an approved identity
// verification (which comes mainly from the payout system). The public list
// checks the second every time, so a lapsed verification takes a testimonial
// down, and one approved before its author was verified starts showing once
// they are.
//
// The suggestion is for staff only. It is returned by listForReview (staff) and
// listMine (its author), and by nothing else.
//
// Older rows came from a donor offering their donation message; see the
// testimonials table in schema.ts. They are still shown, held and withdrawn
// here, and also need their donation to stand.

const REVIEW_LIMIT = 50;
const MY_LIMIT = 50;
// Newest approved ones are read, and the first few that still qualify shown.
const PUBLIC_CANDIDATES = 24;
const PUBLIC_LIMIT = 6;

const RATE_LIMITED =
  "You've sent your testimonial in a lot today. Please try again tomorrow.";

/** The part of a row that says when its rating or words last changed. */
function versionOf(row: Doc<"testimonials">): number {
  return row.editedAt ?? row.createdAt;
}

/**
 * Why a testimonial can't be shown right now, or null when it can: its author
 * has to hold an approved verification and, for an older one that came from a
 * donation, the donation has to still stand.
 */
async function publishBlocker(
  ctx: QueryCtx | MutationCtx,
  testimonial: Doc<"testimonials">,
  tier?: number,
): Promise<string | null> {
  if (testimonial.donationId !== undefined) {
    const donation = await ctx.db.get(testimonial.donationId);
    if (!donation || donation.status !== "COMPLETED") {
      return "The donation behind this message isn't complete (it may have been refunded).";
    }
  }
  const authorTier = tier ?? (await getKycTier(ctx, testimonial.authorUserId));
  if (authorTier < MIN_TESTIMONIAL_KYC_TIER) {
    return testimonial.source === "PROFILE"
      ? "The author doesn't have approved identity verification yet."
      : "The author no longer has approved identity verification.";
  }
  return null;
}

/**
 * Why staff can't approve it. Approving is about the words, so a testimonial
 * from someone who isn't verified yet can still be approved: it just waits to
 * be shown (see publishBlocker). An older one is held to the old rule.
 */
async function approveBlocker(
  ctx: QueryCtx | MutationCtx,
  testimonial: Doc<"testimonials">,
  tier?: number,
): Promise<string | null> {
  return testimonial.source === "PROFILE"
    ? null
    : await publishBlocker(ctx, testimonial, tier);
}

// ---- The author -------------------------------------------------------

const ratingNote = v.union(v.number(), v.null());

/**
 * The signed-in person's own testimonials, newest first: the one they wrote
 * from their profile (source PROFILE) and any older ones from a donation.
 * Empty when signed out.
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("testimonials"),
      source: v.union(v.literal("DONATION"), v.literal("PROFILE")),
      message: v.string(),
      rating: ratingNote,
      recommendation: v.union(v.string(), v.null()),
      status: v.union(
        v.literal("PENDING"),
        v.literal("APPROVED"),
        v.literal("REJECTED"),
        v.literal("WITHDRAWN"),
      ),
      fundraiserTitle: v.union(v.string(), v.null()),
      // Approved, but the author isn't verified, so it isn't being shown yet.
      awaitingVerification: v.boolean(),
      createdAt: v.number(),
      editedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return [];
    const tier = await getKycTier(ctx, user._id);

    const rows = await ctx.db
      .query("testimonials")
      .withIndex("by_authorUserId", (q) => q.eq("authorUserId", user._id))
      .order("desc")
      .take(MY_LIMIT);

    return await Promise.all(
      rows.map(async (row) => {
        const fundraiser = row.fundraiserId
          ? await ctx.db.get(row.fundraiserId)
          : null;
        return {
          _id: row._id,
          source: row.source ?? ("DONATION" as const),
          message: row.message,
          rating: row.rating ?? null,
          recommendation: row.recommendation ?? null,
          status: row.status,
          fundraiserTitle: row.fundraiserId
            ? (fundraiser?.title ?? "Deleted fundraiser")
            : null,
          awaitingVerification:
            row.status === "APPROVED" && tier < MIN_TESTIMONIAL_KYC_TIER,
          createdAt: row.createdAt,
          editedAt: row.editedAt ?? null,
        };
      }),
    );
  },
});

/**
 * Saves the signed-in person's testimonial: writes it the first time, and
 * changes it after that. There is only ever one.
 *
 * Writing it, changing the rating or the words, or sending one back after
 * withdrawing it puts it in front of staff again (PENDING) and takes it off the
 * homepage until they approve it. Changing only the suggestion doesn't: nobody
 * sees that but staff. Saving what is already saved changes nothing, so a
 * rejected testimonial isn't sent back until it is edited.
 */
export const saveMine = mutation({
  args: {
    rating: v.number(),
    message: v.string(),
    recommendation: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) throw new ConvexError("You must be signed in.");

    const checked = checkTestimonial(args);
    if (!checked.ok) throw new ConvexError(checked.problem);
    const { rating, message, recommendation } = checked.value;

    const existing = await ctx.db
      .query("testimonials")
      .withIndex("by_authorUserId_and_source", (q) =>
        q.eq("authorUserId", user._id).eq("source", "PROFILE"),
      )
      .unique();

    const spendOneSubmission = async () => {
      const limit = await consumeRateLimit(ctx, `testimonial:${user._id}`, {
        max: MAX_TESTIMONIAL_SUBMISSIONS_PER_DAY,
        windowMs: TESTIMONIAL_RATE_WINDOW_MS,
      });
      if (!limit.allowed) throw new ConvexError(RATE_LIMITED);
    };

    const now = Date.now();
    if (!existing) {
      await spendOneSubmission();
      await ctx.db.insert("testimonials", {
        source: "PROFILE",
        authorUserId: user._id,
        authorName: publicAuthorName(user.displayName),
        message,
        rating,
        recommendation: recommendation ?? undefined,
        status: "PENDING",
        createdAt: now,
      });
      return null;
    }

    const wordsChanged =
      existing.rating !== rating || existing.message !== message;
    const suggestionChanged =
      (existing.recommendation ?? null) !== recommendation;
    const comingBack = existing.status === "WITHDRAWN";

    if (!wordsChanged && !comingBack) {
      if (suggestionChanged) {
        await ctx.db.patch(existing._id, {
          recommendation: recommendation ?? undefined,
        });
      }
      return null;
    }

    await spendOneSubmission();
    await ctx.db.patch(existing._id, {
      authorName: publicAuthorName(user.displayName),
      message,
      rating,
      recommendation: recommendation ?? undefined,
      status: "PENDING",
      editedAt: now,
      // A fresh review: nothing of the last one carries over.
      reviewedBy: undefined,
      reviewedAt: undefined,
      reviewNote: undefined,
      approvedAt: undefined,
    });
    return null;
  },
});

/** Pulls a testimonial back, whether it is waiting or already on show. */
export const withdrawTestimonial = mutation({
  args: { testimonialId: v.id("testimonials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) throw new ConvexError("You must be signed in.");

    const testimonial = await ctx.db.get(args.testimonialId);
    if (!testimonial || testimonial.authorUserId !== user._id) {
      throw new ConvexError("Testimonial not found.");
    }
    if (testimonial.status !== "PENDING" && testimonial.status !== "APPROVED") {
      throw new ConvexError("This testimonial isn't on show or waiting.");
    }

    await ctx.db.patch(testimonial._id, {
      status: "WITHDRAWN",
      approvedAt: undefined,
    });
    return null;
  },
});

// ---- Staff ------------------------------------------------------------

export const listForReview = query({
  args: {
    status: v.union(
      v.literal("PENDING"),
      v.literal("APPROVED"),
      v.literal("REJECTED"),
    ),
  },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    // Waiting ones oldest first so nobody is left queueing; decided ones
    // newest first.
    const rows = await ctx.db
      .query("testimonials")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", args.status))
      .order(args.status === "PENDING" ? "asc" : "desc")
      .take(REVIEW_LIMIT);

    return await Promise.all(
      rows.map(async (row) => {
        const [author, fundraiser, tier] = await Promise.all([
          ctx.db.get(row.authorUserId),
          row.fundraiserId ? ctx.db.get(row.fundraiserId) : null,
          getKycTier(ctx, row.authorUserId),
        ]);
        const [shownBlocker, cantApprove] = await Promise.all([
          publishBlocker(ctx, row, tier),
          approveBlocker(ctx, row, tier),
        ]);
        return {
          _id: row._id,
          source: row.source ?? ("DONATION" as const),
          message: row.message,
          rating: row.rating ?? null,
          // Private: this is the one place besides the author's own list.
          recommendation: row.recommendation ?? null,
          authorName: row.authorName,
          // The name on the account, so staff know whom a suggestion is from.
          authorDisplayName: author?.displayName ?? row.authorName,
          authorVerified: tier >= MIN_TESTIMONIAL_KYC_TIER,
          fundraiserId: row.fundraiserId ?? null,
          fundraiserTitle: row.fundraiserId
            ? (fundraiser?.title ?? "Deleted fundraiser")
            : null,
          createdAt: row.createdAt,
          editedAt: row.editedAt ?? null,
          // Sent back with an approval, so what staff approve is what they read.
          version: versionOf(row),
          reviewedAt: row.reviewedAt ?? null,
          reviewNote: row.reviewNote ?? null,
          // Set when it can't be approved as things stand.
          blocker: cantApprove,
          // Set when it isn't being shown (or won't be once approved).
          shownBlocker,
        };
      }),
    );
  },
});

export const approveTestimonial = mutation({
  args: {
    testimonialId: v.id("testimonials"),
    // The `version` the reviewer was reading. If the author has changed it
    // since, it has to be read again.
    version: v.number(),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const testimonial = await ctx.db.get(args.testimonialId);
    if (!testimonial) throw new ConvexError("Testimonial not found.");
    if (testimonial.status !== "PENDING") {
      throw new ConvexError(
        "Only a testimonial waiting for review can be approved.",
      );
    }
    if (versionOf(testimonial) !== args.version) {
      throw new ConvexError(
        "The author changed this testimonial after you opened it. Please read it again.",
      );
    }

    const blocker = await approveBlocker(ctx, testimonial);
    if (blocker) throw new ConvexError(blocker);

    const note = cleanNote(args.note);
    const now = Date.now();
    await ctx.db.patch(testimonial._id, {
      status: "APPROVED",
      reviewedBy: staff._id,
      reviewedAt: now,
      approvedAt: now,
      reviewNote: note,
    });
    await logAction(ctx, {
      actorId: staff._id,
      action: "TESTIMONIAL_APPROVED",
      testimonialId: testimonial._id,
      fundraiserId: testimonial.fundraiserId,
      statusBefore: "PENDING",
      statusAfter: "APPROVED",
      note,
    });
    return null;
  },
});

/** Declines a waiting testimonial, or takes an approved one back down. */
export const rejectTestimonial = mutation({
  args: { testimonialId: v.id("testimonials"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const testimonial = await ctx.db.get(args.testimonialId);
    if (!testimonial) throw new ConvexError("Testimonial not found.");
    if (testimonial.status !== "PENDING" && testimonial.status !== "APPROVED") {
      throw new ConvexError("This testimonial can't be rejected.");
    }

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        `Give a reason of at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
      );
    }

    await ctx.db.patch(testimonial._id, {
      status: "REJECTED",
      reviewedBy: staff._id,
      reviewedAt: Date.now(),
      reviewNote: reason,
      approvedAt: undefined,
    });
    await logAction(ctx, {
      actorId: staff._id,
      action: "TESTIMONIAL_REJECTED",
      testimonialId: testimonial._id,
      fundraiserId: testimonial.fundraiserId,
      statusBefore: testimonial.status,
      statusAfter: "REJECTED",
      note: reason,
    });
    return null;
  },
});

// ---- Public -----------------------------------------------------------

/**
 * What the homepage shows: approved testimonials that still qualify, newest
 * first. One is left out when its author doesn't hold an approved verification,
 * and, for an older one that came from a donation, when the donation was
 * refunded or its fundraiser isn't open to the public, so a donor's
 * endorsement is never shown against a campaign that was flagged, made private
 * or taken down.
 *
 * Only the words, the rating and the public name leave here. The suggestion
 * never does.
 */
export const listPublic = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("testimonials"),
      message: v.string(),
      rating: ratingNote,
      authorName: v.string(),
      // Only an older testimonial, from a donation, is about a fundraiser.
      fundraiserId: v.union(v.id("fundraisers"), v.null()),
      fundraiserTitle: v.union(v.string(), v.null()),
      approvedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const candidates = await ctx.db
      .query("testimonials")
      .withIndex("by_status_and_approvedAt", (q) => q.eq("status", "APPROVED"))
      .order("desc")
      .take(PUBLIC_CANDIDATES);

    const shown = [];
    for (const row of candidates) {
      if (shown.length >= PUBLIC_LIMIT) break;

      let fundraiserId: Doc<"fundraisers">["_id"] | null = null;
      let fundraiserTitle: string | null = null;
      if (row.fundraiserId) {
        const fundraiser = await ctx.db.get(row.fundraiserId);
        const isPublic =
          fundraiser !== null &&
          !fundraiser.isPrivate &&
          fundraiser.isFlagged !== true &&
          (fundraiser.status === "ACTIVE" || fundraiser.status === "COMPLETED");
        if (!isPublic) continue;
        fundraiserId = fundraiser._id;
        fundraiserTitle = fundraiser.title;
      }
      if ((await publishBlocker(ctx, row)) !== null) continue;

      shown.push({
        _id: row._id,
        message: row.message,
        rating: row.rating ?? null,
        authorName: row.authorName,
        fundraiserId,
        fundraiserTitle,
        approvedAt: row.approvedAt ?? row.createdAt,
      });
    }
    return shown;
  },
});
