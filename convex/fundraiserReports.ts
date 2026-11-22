import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  checkReportDetails,
  FUNDRAISER_REPORT_REASONS,
  FUNDRAISER_REPORT_WINDOW_MS,
  MAX_FUNDRAISER_REPORTS_PER_DAY,
} from "../lib/fundraiser-reports";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import {
  isOpenToThePublic,
  isPubliclyVisible,
  isSuspended,
} from "./lib/fundraiserAccess";
import { getKycTier } from "./lib/kycTier";
import { getBalance } from "./lib/payoutBalance";
import { getActivePayoutHold } from "./lib/payoutEligibility";
import { placePayoutHoldFor } from "./lib/payoutHold";
import { consumeRateLimit } from "./lib/rateLimit";
import { getCurrentUserDoc, getStaffUser, requireStaff } from "./lib/staff";
import { literalUnion } from "./lib/organizationValidators";
import { availableBalance } from "../lib/payouts";

// Reporting a fundraiser, and what staff do about it.
//
// Anyone signed in can report a fundraiser they can see, once at a time, and
// the person behind it is never told who did. A report changes nothing by
// itself: it goes in a queue for staff, so a crowd (or a rival) can't take a
// fundraiser down by clicking.
//
// Staff can suspend a fundraiser, reported or not. A suspended fundraiser is
// off the public site (lists, search, its own page, the sitemap, embeds), takes
// no new donations, and by default has its payouts held. Its organizer and
// staff still see it, with the reason. Lifting the suspension puts it back;
// releasing a payout hold stays an admin's decision (see admin.ts).

const reasonValidator = literalUnion(FUNDRAISER_REPORT_REASONS);

// Open reports read for the staff queue, and fundraisers shown from them.
const REPORT_SCAN_LIMIT = 200;
const QUEUE_LIMIT = 50;
// Open reports on one fundraiser resolved at once when staff act on it.
const RESOLVE_LIMIT = 200;
// What the review page shows of one fundraiser.
const REVIEW_REPORT_LIMIT = 50;
const REVIEW_HISTORY_LIMIT = 10;
const REVIEW_AUDIT_LIMIT = 20;
const OTHER_FUNDRAISERS_LIMIT = 10;

async function requireUser(ctx: Parameters<typeof getCurrentUserDoc>[0]) {
  const user = await getCurrentUserDoc(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

/** Closes the open reports on a fundraiser. Says how many it closed. */
async function resolveOpenReports(
  ctx: MutationCtx,
  fundraiserId: Id<"fundraisers">,
  status: "ACTIONED" | "DISMISSED",
  staffId: Id<"users">,
): Promise<number> {
  const open = await ctx.db
    .query("fundraiserReports")
    .withIndex("by_fundraiserId_and_status", (q) =>
      q.eq("fundraiserId", fundraiserId).eq("status", "OPEN"),
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
  return open.length;
}

/** A name for staff to read: the person's name, or a note that they're gone. */
async function nameOf(
  ctx: Parameters<typeof getCurrentUserDoc>[0],
  userId: Id<"users"> | undefined,
): Promise<string> {
  if (!userId) return "Unknown";
  const user = await ctx.db.get(userId);
  return user?.displayName ?? "Deleted account";
}

// ---- Reporting --------------------------------------------------------

/**
 * Tells staff a fundraiser shouldn't be there. One open report per person per
 * fundraiser: reporting again while theirs is still waiting changes nothing,
 * and doesn't count against the daily limit.
 */
export const report = mutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    reason: reasonValidator,
    details: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Only a fundraiser the public can see can be reported, and to everyone
    // else any other one doesn't exist.
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !isPubliclyVisible(fundraiser)) {
      throw new ConvexError("Fundraiser not found.");
    }
    if (fundraiser.creatorId === user._id) {
      throw new ConvexError("You can't report your own fundraiser.");
    }

    const checked = checkReportDetails(args.reason, args.details);
    if (!checked.ok) throw new ConvexError(checked.problem);

    const already = await ctx.db
      .query("fundraiserReports")
      .withIndex("by_fundraiserId_and_reporterUserId_and_status", (q) =>
        q
          .eq("fundraiserId", fundraiser._id)
          .eq("reporterUserId", user._id)
          .eq("status", "OPEN"),
      )
      .first();
    if (already) return null;

    const limit = await consumeRateLimit(ctx, `fundraiserReport:${user._id}`, {
      max: MAX_FUNDRAISER_REPORTS_PER_DAY,
      windowMs: FUNDRAISER_REPORT_WINDOW_MS,
    });
    if (!limit.allowed) {
      throw new ConvexError(
        "You've sent a lot of reports today. Please try again tomorrow.",
      );
    }

    await ctx.db.insert("fundraiserReports", {
      fundraiserId: fundraiser._id,
      reporterUserId: user._id,
      reason: args.reason,
      details: checked.details,
      status: "OPEN",
      createdAt: Date.now(),
    });
    return null;
  },
});

// ---- Staff queues -----------------------------------------------------

/**
 * The fundraisers with open reports: the one with the most reports first, and
 * among those the one reported longest ago. Quietly empty for everyone but
 * staff.
 */
export const listReported = query({
  args: {},
  returns: v.array(
    v.object({
      fundraiserId: v.id("fundraisers"),
      title: v.string(),
      status: v.string(),
      suspended: v.boolean(),
      ownerName: v.string(),
      amountRaised: v.number(),
      currency: v.union(v.literal("KES"), v.literal("USD")),
      donorCount: v.number(),
      reportCount: v.number(),
      reasons: v.array(
        v.object({ reason: reasonValidator, count: v.number() }),
      ),
      firstReportedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    const open = await ctx.db
      .query("fundraiserReports")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "OPEN"))
      .order("asc")
      .take(REPORT_SCAN_LIMIT);

    const grouped = new Map<
      Id<"fundraisers">,
      {
        firstAt: number;
        count: number;
        reasons: Map<Doc<"fundraiserReports">["reason"], number>;
      }
    >();
    for (const item of open) {
      const entry = grouped.get(item.fundraiserId) ?? {
        firstAt: item.createdAt,
        count: 0,
        reasons: new Map(),
      };
      entry.count += 1;
      entry.reasons.set(item.reason, (entry.reasons.get(item.reason) ?? 0) + 1);
      grouped.set(item.fundraiserId, entry);
    }

    const ordered = [...grouped].sort(
      ([, a], [, b]) => b.count - a.count || a.firstAt - b.firstAt,
    );

    const rows = [];
    for (const [fundraiserId, entry] of ordered) {
      if (rows.length >= QUEUE_LIMIT) break;
      const fundraiser = await ctx.db.get(fundraiserId);
      if (!fundraiser) continue;
      rows.push({
        fundraiserId,
        title: fundraiser.title,
        status: fundraiser.status,
        suspended: isSuspended(fundraiser),
        ownerName: await nameOf(ctx, fundraiser.creatorId),
        amountRaised: fundraiser.amountRaised,
        currency: fundraiser.currency,
        donorCount: fundraiser.donorCount,
        reportCount: entry.count,
        reasons: [...entry.reasons].map(([reason, count]) => ({
          reason,
          count,
        })),
        firstReportedAt: entry.firstAt,
      });
    }
    return rows;
  },
});

/** The fundraisers that are suspended now, the one suspended longest first. */
export const listSuspended = query({
  args: {},
  returns: v.array(
    v.object({
      fundraiserId: v.id("fundraisers"),
      title: v.string(),
      status: v.string(),
      ownerName: v.string(),
      amountRaised: v.number(),
      currency: v.union(v.literal("KES"), v.literal("USD")),
      reason: v.string(),
      placedAt: v.number(),
      placedByName: v.string(),
      payoutsOnHold: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    const active = await ctx.db
      .query("fundraiserSuspensions")
      .withIndex("by_status_and_placedAt", (q) => q.eq("status", "ACTIVE"))
      .order("asc")
      .take(QUEUE_LIMIT);

    const rows = [];
    for (const suspension of active) {
      const fundraiser = await ctx.db.get(suspension.fundraiserId);
      if (!fundraiser) continue;
      rows.push({
        fundraiserId: fundraiser._id,
        title: fundraiser.title,
        status: fundraiser.status,
        ownerName: await nameOf(ctx, fundraiser.creatorId),
        amountRaised: fundraiser.amountRaised,
        currency: fundraiser.currency,
        reason: suspension.reason,
        placedAt: suspension.placedAt,
        placedByName: await nameOf(ctx, suspension.placedBy),
        payoutsOnHold:
          (await getActivePayoutHold(ctx, fundraiser._id)) !== null,
      });
    }
    return rows;
  },
});

// ---- The review page --------------------------------------------------

/**
 * Everything staff need to decide about one fundraiser, reported or not: what
 * it says, who is behind it, how much money is at stake, who reported it and
 * why, and what staff have done about it so far. Null for everyone but staff.
 */
export const getForStaff = query({
  // A string, not an id: the page takes it from the address bar, and a
  // mistyped address should read as "not found" rather than fail validation.
  args: { fundraiserId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      fundraiser: v.object({
        _id: v.id("fundraisers"),
        title: v.string(),
        tagline: v.union(v.string(), v.null()),
        story: v.string(),
        type: v.string(),
        status: v.string(),
        isPrivate: v.boolean(),
        suspended: v.boolean(),
        goalAmount: v.number(),
        amountRaised: v.number(),
        currency: v.union(v.literal("KES"), v.literal("USD")),
        donorCount: v.number(),
        createdAt: v.number(),
        coverImageUrl: v.union(v.string(), v.null()),
      }),
      owner: v.union(
        v.null(),
        v.object({
          _id: v.id("users"),
          name: v.string(),
          email: v.string(),
          phoneNumber: v.union(v.string(), v.null()),
          joinedAt: v.number(),
          kycTier: v.number(),
          otherFundraisers: v.array(
            v.object({
              _id: v.id("fundraisers"),
              title: v.string(),
              status: v.string(),
              suspended: v.boolean(),
              amountRaised: v.number(),
              currency: v.union(v.literal("KES"), v.literal("USD")),
            }),
          ),
        }),
      ),
      // What has been paid out of it and what is waiting to be, in KES after
      // the platform fee.
      money: v.object({
        paidOut: v.number(),
        available: v.number(),
        pending: v.number(),
      }),
      payoutHold: v.union(
        v.null(),
        v.object({
          reason: v.string(),
          placedAt: v.number(),
          placedByName: v.string(),
        }),
      ),
      suspensions: v.array(
        v.object({
          status: v.union(v.literal("ACTIVE"), v.literal("LIFTED")),
          reason: v.string(),
          placedAt: v.number(),
          placedByName: v.string(),
          liftedAt: v.union(v.number(), v.null()),
          liftedByName: v.union(v.string(), v.null()),
          liftNote: v.union(v.string(), v.null()),
        }),
      ),
      reports: v.array(
        v.object({
          _id: v.id("fundraiserReports"),
          reason: reasonValidator,
          details: v.union(v.string(), v.null()),
          status: v.union(
            v.literal("OPEN"),
            v.literal("ACTIONED"),
            v.literal("DISMISSED"),
          ),
          createdAt: v.number(),
          reporterName: v.string(),
          reporterEmail: v.string(),
        }),
      ),
      history: v.array(
        v.object({
          action: v.string(),
          at: v.number(),
          actorName: v.string(),
          note: v.union(v.string(), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return null;

    const fundraiserId = ctx.db.normalizeId("fundraisers", args.fundraiserId);
    if (!fundraiserId) return null;
    const fundraiser = await ctx.db.get(fundraiserId);
    if (!fundraiser) return null;

    const owner = await ctx.db.get(fundraiser.creatorId);
    const otherFundraisers = owner
      ? (
          await ctx.db
            .query("fundraisers")
            .withIndex("by_creatorId", (q) => q.eq("creatorId", owner._id))
            .order("desc")
            .take(OTHER_FUNDRAISERS_LIMIT + 1)
        )
          .filter((other) => other._id !== fundraiser._id)
          .slice(0, OTHER_FUNDRAISERS_LIMIT)
      : [];

    const balance = await getBalance(ctx, fundraiser._id);
    const hold = await getActivePayoutHold(ctx, fundraiser._id);

    const suspensions = await ctx.db
      .query("fundraiserSuspensions")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", fundraiser._id),
      )
      .order("desc")
      .take(REVIEW_HISTORY_LIMIT);
    // The index runs by status, so put them in the order they happened.
    suspensions.sort((a, b) => b.placedAt - a.placedAt);

    // Open reports first, then the ones already dealt with, newest first.
    const reports = [
      ...(await ctx.db
        .query("fundraiserReports")
        .withIndex("by_fundraiserId_and_status", (q) =>
          q.eq("fundraiserId", fundraiser._id).eq("status", "OPEN"),
        )
        .order("desc")
        .take(REVIEW_REPORT_LIMIT)),
    ];
    for (const status of ["ACTIONED", "DISMISSED"] as const) {
      if (reports.length >= REVIEW_REPORT_LIMIT) break;
      reports.push(
        ...(await ctx.db
          .query("fundraiserReports")
          .withIndex("by_fundraiserId_and_status", (q) =>
            q.eq("fundraiserId", fundraiser._id).eq("status", status),
          )
          .order("desc")
          .take(REVIEW_REPORT_LIMIT - reports.length)),
      );
    }

    const audit = await ctx.db
      .query("adminAuditLog")
      .withIndex("by_fundraiserId", (q) => q.eq("fundraiserId", fundraiser._id))
      .order("desc")
      .take(REVIEW_AUDIT_LIMIT);

    return {
      fundraiser: {
        _id: fundraiser._id,
        title: fundraiser.title,
        tagline: fundraiser.tagline ?? null,
        story: fundraiser.story,
        type: fundraiser.type,
        status: fundraiser.status,
        isPrivate: fundraiser.isPrivate,
        suspended: isSuspended(fundraiser),
        goalAmount: fundraiser.goalAmount,
        amountRaised: fundraiser.amountRaised,
        currency: fundraiser.currency,
        donorCount: fundraiser.donorCount,
        createdAt: fundraiser.createdAt,
        coverImageUrl: fundraiser.coverImageStorageId
          ? await ctx.storage.getUrl(fundraiser.coverImageStorageId)
          : (fundraiser.coverImage ?? null),
      },
      owner: owner
        ? {
            _id: owner._id,
            name: owner.displayName,
            email: owner.email,
            phoneNumber: owner.phoneNumber ?? null,
            joinedAt: owner.createdAt,
            kycTier: await getKycTier(ctx, owner._id),
            otherFundraisers: otherFundraisers.map((other) => ({
              _id: other._id,
              title: other.title,
              status: other.status,
              suspended: isSuspended(other),
              amountRaised: other.amountRaised,
              currency: other.currency,
            })),
          }
        : null,
      money: {
        paidOut: balance?.paid ?? 0,
        available: availableBalance(balance),
        pending: balance?.pendingNet ?? 0,
      },
      payoutHold: hold
        ? {
            reason: hold.reason,
            placedAt: hold.placedAt,
            placedByName: await nameOf(ctx, hold.placedBy),
          }
        : null,
      suspensions: await Promise.all(
        suspensions.map(async (suspension) => ({
          status: suspension.status,
          reason: suspension.reason,
          placedAt: suspension.placedAt,
          placedByName: await nameOf(ctx, suspension.placedBy),
          liftedAt: suspension.liftedAt ?? null,
          liftedByName: suspension.liftedBy
            ? await nameOf(ctx, suspension.liftedBy)
            : null,
          liftNote: suspension.liftNote ?? null,
        })),
      ),
      reports: await Promise.all(
        reports.map(async (item) => {
          const reporter = await ctx.db.get(item.reporterUserId);
          return {
            _id: item._id,
            reason: item.reason,
            details: item.details ?? null,
            status: item.status,
            createdAt: item.createdAt,
            reporterName: reporter?.displayName ?? "Deleted account",
            reporterEmail: reporter?.email ?? "",
          };
        }),
      ),
      history: await Promise.all(
        audit.map(async (entry) => ({
          action: entry.action,
          at: entry.createdAt,
          actorName: await nameOf(ctx, entry.actorId),
          note: entry.note ?? null,
        })),
      ),
    };
  },
});

// ---- Staff decisions --------------------------------------------------

/**
 * Takes a fundraiser off the public site while staff look into it. The reason
 * is shown to its organizer, so it is written for them. The open reports on it
 * are marked as acted on. Payouts are held too unless staff say not to, so
 * money doesn't leave while it is being looked into.
 */
export const suspend = mutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    reason: v.string(),
    holdPayouts: v.boolean(),
  },
  returns: v.object({ payoutsOnHold: v.boolean() }),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) throw new ConvexError("Fundraiser not found.");
    if (isSuspended(fundraiser)) {
      throw new ConvexError("This fundraiser is already suspended.");
    }

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Write why it is being suspended, for the organizer (at least 10 characters).",
      );
    }

    const now = Date.now();
    await ctx.db.patch(fundraiser._id, { isFlagged: true, updatedAt: now });
    await ctx.db.insert("fundraiserSuspensions", {
      fundraiserId: fundraiser._id,
      status: "ACTIVE",
      reason,
      placedBy: staff._id,
      placedAt: now,
    });
    await resolveOpenReports(ctx, fundraiser._id, "ACTIONED", staff._id);

    let payoutsOnHold =
      (await getActivePayoutHold(ctx, fundraiser._id)) !== null;
    if (args.holdPayouts && !payoutsOnHold) {
      await placePayoutHoldFor(ctx, {
        fundraiserId: fundraiser._id,
        staffId: staff._id,
        reason: `Fundraiser suspended: ${reason}`,
      });
      payoutsOnHold = true;
    }

    await logAction(ctx, {
      actorId: staff._id,
      action: "FUNDRAISER_SUSPENDED",
      fundraiserId: fundraiser._id,
      statusBefore: "NOT_SUSPENDED",
      statusAfter: "SUSPENDED",
      note: reason,
    });
    return { payoutsOnHold };
  },
});

/**
 * Puts a suspended fundraiser back on the public site. Any staff member can,
 * with a note. A payout hold stays until an admin releases it, so putting the
 * fundraiser back doesn't by itself let money go (the answer says whether it
 * is still held).
 */
export const reinstate = mutation({
  args: { fundraiserId: v.id("fundraisers"), note: v.string() },
  returns: v.object({ payoutsOnHold: v.boolean() }),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) throw new ConvexError("Fundraiser not found.");
    if (!isSuspended(fundraiser)) {
      throw new ConvexError("This fundraiser isn't suspended.");
    }

    const note = cleanNote(args.note);
    if (!note || note.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Record why it is being put back (at least 10 characters).",
      );
    }

    const now = Date.now();
    await ctx.db.patch(fundraiser._id, { isFlagged: false, updatedAt: now });
    const active = await ctx.db
      .query("fundraiserSuspensions")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", fundraiser._id).eq("status", "ACTIVE"),
      )
      .take(RESOLVE_LIMIT);
    for (const suspension of active) {
      await ctx.db.patch(suspension._id, {
        status: "LIFTED",
        liftedBy: staff._id,
        liftedAt: now,
        liftNote: note,
      });
    }

    await logAction(ctx, {
      actorId: staff._id,
      action: "FUNDRAISER_REINSTATED",
      fundraiserId: fundraiser._id,
      statusBefore: "SUSPENDED",
      statusAfter: "NOT_SUSPENDED",
      note,
    });
    return {
      payoutsOnHold: (await getActivePayoutHold(ctx, fundraiser._id)) !== null,
    };
  },
});

/**
 * Staff looked and the fundraiser can stay: the open reports on it are closed.
 * If someone reports it again, it comes back to the queue.
 */
export const dismissReports = mutation({
  args: { fundraiserId: v.id("fundraisers"), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) throw new ConvexError("Fundraiser not found.");

    const closed = await resolveOpenReports(
      ctx,
      fundraiser._id,
      "DISMISSED",
      staff._id,
    );
    // Nothing was waiting, so there is nothing to record.
    if (closed === 0) return null;

    await logAction(ctx, {
      actorId: staff._id,
      action: "FUNDRAISER_REPORTS_DISMISSED",
      fundraiserId: fundraiser._id,
      note: cleanNote(args.note),
    });
    return null;
  },
});

// ---- What the page shows ----------------------------------------------

/**
 * Whether a fundraiser the public could otherwise see is suspended, so its page
 * can say so instead of looking like it doesn't exist. It says nothing else
 * about it, and a private, draft or rejected fundraiser reads as nothing at
 * all.
 */
export const isUnderReview = query({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    return (
      fundraiser !== null &&
      isOpenToThePublic(fundraiser) &&
      isSuspended(fundraiser)
    );
  },
});

/**
 * Why a fundraiser is suspended, for its organizer and for staff. Null for
 * everyone else, and for a fundraiser that isn't suspended. The reason is
 * null for one flagged without a record.
 */
export const mySuspension = query({
  args: { fundraiserId: v.id("fundraisers") },
  returns: v.union(
    v.null(),
    v.object({
      reason: v.union(v.string(), v.null()),
      placedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !isSuspended(fundraiser)) return null;

    const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";
    if (!isStaff && fundraiser.creatorId !== user._id) return null;

    const suspension = await ctx.db
      .query("fundraiserSuspensions")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", fundraiser._id).eq("status", "ACTIVE"),
      )
      .order("desc")
      .first();
    return {
      reason: suspension?.reason ?? null,
      placedAt: suspension?.placedAt ?? fundraiser.updatedAt,
    };
  },
});
