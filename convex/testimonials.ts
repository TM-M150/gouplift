import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  MAX_TESTIMONIAL_LENGTH,
  MIN_TESTIMONIAL_KYC_TIER,
  publicAuthorName,
} from "../lib/testimonials";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getKycTier } from "./lib/kycTier";
import { getCurrentUserDoc, getStaffUser, requireStaff } from "./lib/staff";

// A donor's message, offered as a public testimonial. Three things have to be
// true before anyone sees it: the donor asked for it (the checkbox on the
// donate form), they are a signed-in person with approved identity
// verification, and a moderator approved the wording. The public list checks
// the second and the donation again, so a refund or a lapsed verification
// takes the testimonial down without anyone having to remember to.

const REVIEW_LIMIT = 50;
const MY_LIMIT = 50;
// Newest approved ones are read, and the first few that still qualify shown.
const PUBLIC_CANDIDATES = 24;
const PUBLIC_LIMIT = 6;

/**
 * Why a testimonial can't be shown right now, or null when it can: the
 * donation behind it has to still stand, and its author has to still hold an
 * approved verification.
 */
async function publishBlocker(
  ctx: QueryCtx | MutationCtx,
  testimonial: Doc<"testimonials">,
): Promise<string | null> {
  const donation = await ctx.db.get(testimonial.donationId);
  if (!donation || donation.status !== "COMPLETED") {
    return "The donation behind this message isn't complete (it may have been refunded).";
  }
  const tier = await getKycTier(ctx, testimonial.authorUserId);
  if (tier < MIN_TESTIMONIAL_KYC_TIER) {
    return "The author no longer has approved identity verification.";
  }
  return null;
}

/**
 * Called after a one-off donation completes. Queues the donor's message for
 * review when they opted in and are verified. It runs on its own, scheduled,
 * so nothing here can hold up or undo recording a payment, and it does
 * nothing when run again for the same donation.
 */
export const queueFromDonation = internalMutation({
  args: { donationId: v.id("donations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation || donation.status !== "COMPLETED") return null;
    if (donation.shareAsTestimonial !== true || donation.isAnonymous) {
      return null;
    }
    // A guest can never qualify: there is no account to have verified.
    if (!donation.donorUserId) return null;

    const message = donation.message?.trim();
    if (!message || message.length > MAX_TESTIMONIAL_LENGTH) return null;

    const existing = await ctx.db
      .query("testimonials")
      .withIndex("by_donationId", (q) => q.eq("donationId", args.donationId))
      .first();
    if (existing) return null;

    const author = await ctx.db.get(donation.donorUserId);
    if (!author) return null;
    if ((await getKycTier(ctx, author._id)) < MIN_TESTIMONIAL_KYC_TIER) {
      return null;
    }

    await ctx.db.insert("testimonials", {
      donationId: donation._id,
      authorUserId: author._id,
      fundraiserId: donation.fundraiserId,
      authorName: publicAuthorName(author.displayName),
      message,
      status: "PENDING",
      createdAt: Date.now(),
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
        const [fundraiser, blocker] = await Promise.all([
          ctx.db.get(row.fundraiserId),
          publishBlocker(ctx, row),
        ]);
        return {
          _id: row._id,
          message: row.message,
          authorName: row.authorName,
          fundraiserId: row.fundraiserId,
          fundraiserTitle: fundraiser?.title ?? "Deleted fundraiser",
          createdAt: row.createdAt,
          reviewedAt: row.reviewedAt ?? null,
          reviewNote: row.reviewNote ?? null,
          // Set when it can't be approved (or shown) as things stand.
          blocker,
        };
      }),
    );
  },
});

export const approveTestimonial = mutation({
  args: { testimonialId: v.id("testimonials"), note: v.optional(v.string()) },
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

    const blocker = await publishBlocker(ctx, testimonial);
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

// ---- The author -------------------------------------------------------

/** The signed-in person's own testimonials. Empty when signed out. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return [];

    const rows = await ctx.db
      .query("testimonials")
      .withIndex("by_authorUserId", (q) => q.eq("authorUserId", user._id))
      .order("desc")
      .take(MY_LIMIT);

    return await Promise.all(
      rows.map(async (row) => {
        const fundraiser = await ctx.db.get(row.fundraiserId);
        return {
          _id: row._id,
          message: row.message,
          status: row.status,
          fundraiserTitle: fundraiser?.title ?? "Deleted fundraiser",
          createdAt: row.createdAt,
        };
      }),
    );
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

// ---- Public -----------------------------------------------------------

/**
 * What the homepage shows: approved testimonials that still qualify, newest
 * first. A testimonial is left out when its donation was refunded, its author
 * is no longer verified, or its fundraiser isn't open to the public, so a
 * donor's endorsement is never shown against a campaign that was flagged,
 * made private or taken down.
 */
export const listPublic = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("testimonials"),
      message: v.string(),
      authorName: v.string(),
      fundraiserId: v.id("fundraisers"),
      fundraiserTitle: v.string(),
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

      const fundraiser = await ctx.db.get(row.fundraiserId);
      const isPublic =
        fundraiser !== null &&
        !fundraiser.isPrivate &&
        fundraiser.isFlagged !== true &&
        (fundraiser.status === "ACTIVE" || fundraiser.status === "COMPLETED");
      if (!isPublic) continue;
      if ((await publishBlocker(ctx, row)) !== null) continue;

      shown.push({
        _id: row._id,
        message: row.message,
        authorName: row.authorName,
        fundraiserId: row.fundraiserId,
        fundraiserTitle: fundraiser.title,
        approvedAt: row.approvedAt ?? row.createdAt,
      });
    }
    return shown;
  },
});
