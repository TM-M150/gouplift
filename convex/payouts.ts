import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tierPayoutLimitKes } from "../lib/kyc";
import { payoutChangeHeldUntil } from "../lib/payout-accounts";
import {
  addMoney,
  availableBalance,
  LIMIT_COUNTING_PAYOUT_STATUSES,
  MAX_PAYOUT_REFERENCE_LENGTH,
  MIN_PAYOUT_KES,
  MIN_PAYOUT_REFERENCE_LENGTH,
  needsEnhancedApproval,
  payoutAmountProblem,
  roundMoney,
  tierRemainingKes,
  withdrawableKes,
  type PayoutStatus,
} from "../lib/payouts";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getApprovedKycSubmissions, getKycTier } from "./lib/kycTier";
import { getOwnerAccess } from "./lib/orgAccess";
import {
  getBalance,
  markReservationPaid,
  releaseReservation,
  reserveForPayout,
} from "./lib/payoutBalance";
import { getFundraiserPayoutSelection } from "./lib/payoutAccounts";
import {
  assertPayoutEligible,
  getPayoutBlockers,
} from "./lib/payoutEligibility";
import {
  describeDestination,
  ownerSafePayoutMessage,
  toOwnerPayoutView,
} from "./lib/payouts";
import { isMlro } from "./lib/mlro";
import { getCurrentUserDoc, requireAdmin } from "./lib/staff";

// Taking money out of a fundraiser. The owner asks for an amount; an admin
// approves it, sends the money from the SasaPay or bank dashboard, and records
// the reference here. The amount is set aside from the withdrawable balance
// the moment it is asked for (see lib/payoutBalance.ts), so it can't be asked
// for twice, and goes back if the request is cancelled, rejected or fails.

const HISTORY_LIMIT = 20;
const STAFF_LIST_LIMIT = 50;
// More payouts than this for one person is not a real case, so refuse rather
// than read without limit and risk undercounting what they were already paid.
const MAX_PAYOUTS_PER_OWNER = 1000;

type Ctx = QueryCtx | MutationCtx;
type Fundraiser = Doc<"fundraisers">;

async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUserDoc(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

/** Who may withdraw: the creator, or for an organization's fundraiser, its owner. */
async function maySpendFundraiser(
  ctx: Ctx,
  user: Doc<"users">,
  fundraiser: Fundraiser,
): Promise<boolean> {
  return fundraiser.organizationId
    ? (await getOwnerAccess(ctx, fundraiser.organizationId)) !== null
    : fundraiser.creatorId === user._id;
}

/**
 * What an individual has already been paid or asked for, across all their own
 * fundraisers. An organization's payouts are its own and don't count here.
 */
async function committedKes(
  ctx: Ctx,
  ownerUserId: Id<"users">,
): Promise<number> {
  let total = 0;
  for (const status of LIMIT_COUNTING_PAYOUT_STATUSES) {
    const rows = await ctx.db
      .query("payouts")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("status", status),
      )
      .take(MAX_PAYOUTS_PER_OWNER + 1);
    if (rows.length > MAX_PAYOUTS_PER_OWNER) {
      throw new ConvexError(
        "We can't process a withdrawal for this fundraiser right now. Please try again later.",
      );
    }
    for (const row of rows) {
      if (!row.organizationId) total = addMoney(total, row.amount);
    }
  }
  return total;
}

async function openRequestFor(
  ctx: Ctx,
  fundraiserId: Id<"fundraisers">,
): Promise<Doc<"payouts"> | null> {
  for (const status of ["REQUESTED", "APPROVED"] as const) {
    const open = await ctx.db
      .query("payouts")
      .withIndex("by_fundraiserId_and_status", (q) =>
        q.eq("fundraiserId", fundraiserId).eq("status", status),
      )
      .first();
    if (open) return open;
  }
  return null;
}

// ---- The owner ----------------------------------------------------------

/**
 * What an owner sees about withdrawing from a fundraiser: the balance, what
 * stops them if anything, and their payouts so far. Null for anyone else. It
 * can't read the clock, so the pause after changing account is returned as
 * `heldUntil` for the screen to compare.
 */
export const getMyPayoutOverview = query({
  args: { fundraiserId: v.id("fundraisers") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !(await maySpendFundraiser(ctx, user, fundraiser))) {
      return null;
    }

    const [balance, blockers, selection, open, recent] = await Promise.all([
      getBalance(ctx, fundraiser._id),
      getPayoutBlockers(ctx, fundraiser, null),
      getFundraiserPayoutSelection(ctx, fundraiser._id),
      openRequestFor(ctx, fundraiser._id),
      ctx.db
        .query("payouts")
        .withIndex("by_fundraiserId_and_requestedAt", (q) =>
          q.eq("fundraiserId", fundraiser._id),
        )
        .order("desc")
        .take(HISTORY_LIMIT),
    ]);

    const available = availableBalance(balance);
    const account = selection
      ? await ctx.db.get(selection.payoutAccountId)
      : null;
    const tier = fundraiser.organizationId
      ? null
      : await getKycTier(ctx, fundraiser.creatorId);
    const remaining =
      tier === null || tier === 3
        ? null
        : tierRemainingKes(tier, await committedKes(ctx, fundraiser.creatorId));

    return {
      available: withdrawableKes(available),
      pending: roundMoney(balance?.pendingNet ?? 0),
      reserved: roundMoney(balance?.reserved ?? 0),
      paid: roundMoney(balance?.paid ?? 0),
      minPayout: MIN_PAYOUT_KES,
      // Null when there is no cap: an organization, or above Level 2.
      limitRemaining: remaining,
      blockedReason: ownerSafePayoutMessage(blockers),
      // Where the money would go, masked the way the owner already sees it.
      destination: account ? describeDestination(account) : null,
      heldUntil: selection?.changedAt
        ? payoutChangeHeldUntil(selection.changedAt)
        : null,
      hasOpenRequest: open !== null,
      payouts: recent.map(toOwnerPayoutView),
    };
  },
});

export const requestPayout = mutation({
  args: { fundraiserId: v.id("fundraisers"), amount: v.number() },
  returns: v.id("payouts"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser || !(await maySpendFundraiser(ctx, user, fundraiser))) {
      throw new ConvexError("You can't withdraw from this fundraiser.");
    }

    const now = Date.now();
    const blockers = await getPayoutBlockers(ctx, fundraiser, now);
    const blocked = ownerSafePayoutMessage(blockers);
    if (blocked) throw new ConvexError(blocked);

    if (await openRequestFor(ctx, fundraiser._id)) {
      throw new ConvexError(
        "You already have a withdrawal waiting. Wait for it to be paid, or cancel it first.",
      );
    }

    const balance = await getBalance(ctx, fundraiser._id);
    const problem = payoutAmountProblem(
      args.amount,
      withdrawableKes(availableBalance(balance)),
    );
    if (problem) throw new ConvexError(problem);

    // Verification-level limit (policy 5.3), for an individual's fundraisers.
    let enhanced = false;
    if (!fundraiser.organizationId) {
      const tier = await getKycTier(ctx, fundraiser.creatorId);
      const committed = await committedKes(ctx, fundraiser.creatorId);
      if (args.amount > tierRemainingKes(tier, committed)) {
        const left = tierRemainingKes(tier, committed);
        throw new ConvexError(
          left <= 0
            ? `You've reached the Level ${tier} payout limit of KES ${tierPayoutLimitKes(tier).toLocaleString("en-KE")}. Verify to the next level to withdraw more.`
            : `That is over your Level ${tier} limit. You can withdraw up to KES ${left.toLocaleString("en-KE")} more. Verify to the next level to withdraw more.`,
        );
      }
      enhanced = needsEnhancedApproval(tier, addMoney(committed, args.amount));
    }

    // Eligibility has just confirmed the selected account exists and is
    // verified.
    const selection = await getFundraiserPayoutSelection(ctx, fundraiser._id);
    const account = selection ? await ctx.db.get(selection.payoutAccountId) : null;
    if (!account) throw new ConvexError("Choose where this fundraiser is paid first.");

    const payoutId = await ctx.db.insert("payouts", {
      fundraiserId: fundraiser._id,
      ownerUserId: fundraiser.creatorId,
      organizationId: fundraiser.organizationId,
      requestedBy: user._id,
      payoutAccountId: account._id,
      destination: describeDestination(account),
      amount: args.amount,
      status: "REQUESTED",
      needsEnhancedApproval: enhanced,
      requestedAt: now,
    });
    await reserveForPayout(ctx, fundraiser._id, args.amount, now);
    return payoutId;
  },
});

/** The owner takes a request back before staff approve it. */
export const cancelPayoutRequest = mutation({
  args: { payoutId: v.id("payouts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const payout = await ctx.db.get(args.payoutId);
    const fundraiser = payout ? await ctx.db.get(payout.fundraiserId) : null;
    if (!payout || !fundraiser || !(await maySpendFundraiser(ctx, user, fundraiser))) {
      throw new ConvexError("Withdrawal not found.");
    }
    if (payout.status !== "REQUESTED") {
      throw new ConvexError(
        "Only a withdrawal that is still waiting for review can be cancelled.",
      );
    }

    const now = Date.now();
    await ctx.db.patch(payout._id, {
      status: "CANCELLED",
      cancelledAt: now,
      cancelledBy: user._id,
    });
    await releaseReservation(ctx, payout.fundraiserId, payout.amount, now);
    return null;
  },
});

// ---- Staff (admins only) ------------------------------------------------

function staffSummary(
  payout: Doc<"payouts">,
  fundraiser: Fundraiser | null,
  owner: Doc<"users"> | null,
  organization: Doc<"organizations"> | null,
) {
  return {
    _id: payout._id,
    fundraiserId: payout.fundraiserId,
    fundraiserTitle: fundraiser?.title ?? "Deleted fundraiser",
    // For an organization's fundraiser the payout is the organization's.
    ownerName: organization?.name ?? owner?.displayName ?? "Unknown",
    isOrganization: payout.organizationId !== undefined,
    amount: payout.amount,
    destination: payout.destination,
    status: payout.status,
    needsEnhancedApproval: payout.needsEnhancedApproval,
    requestedAt: payout.requestedAt,
    approvedAt: payout.approvedAt ?? null,
    paidAt: payout.paidAt ?? null,
  };
}

/** The payout queue. Waiting ones oldest first, decided ones newest first. */
export const listPayoutsForStaff = query({
  args: {
    status: v.union(
      v.literal("REQUESTED"),
      v.literal("APPROVED"),
      v.literal("PAID"),
      v.literal("REJECTED"),
      v.literal("CANCELLED"),
      v.literal("FAILED"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user || user.role !== "ADMIN") return [];

    const rows = await ctx.db
      .query("payouts")
      .withIndex("by_status_and_requestedAt", (q) => q.eq("status", args.status))
      .order(args.status === "REQUESTED" || args.status === "APPROVED" ? "asc" : "desc")
      .take(STAFF_LIST_LIMIT);

    return await Promise.all(
      rows.map(async (row) => {
        const [fundraiser, owner, organization] = await Promise.all([
          ctx.db.get(row.fundraiserId),
          ctx.db.get(row.ownerUserId),
          row.organizationId ? ctx.db.get(row.organizationId) : null,
        ]);
        return staffSummary(row, fundraiser, owner, organization);
      }),
    );
  },
});

/**
 * Everything staff need to decide on, and then to send, a payout: where the
 * money goes in full, whatever blocks it now, and how it fits the owner's
 * limit. Null for anyone who isn't an admin.
 */
export const getPayoutForStaff = query({
  // A string, not v.id(): the value comes straight from the URL, and an
  // invalid one should read as "not found" rather than throw.
  args: { payoutId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user || user.role !== "ADMIN") return null;

    const payoutId = ctx.db.normalizeId("payouts", args.payoutId);
    const payout = payoutId ? await ctx.db.get(payoutId) : null;
    if (!payout) return null;
    const [fundraiser, owner, organization, account, balance, selection] =
      await Promise.all([
        ctx.db.get(payout.fundraiserId),
        ctx.db.get(payout.ownerUserId),
        payout.organizationId ? ctx.db.get(payout.organizationId) : null,
        ctx.db.get(payout.payoutAccountId),
        getBalance(ctx, payout.fundraiserId),
        getFundraiserPayoutSelection(ctx, payout.fundraiserId),
      ]);
    const blockers = fundraiser ? await getPayoutBlockers(ctx, fundraiser, null) : [];
    const tier = payout.organizationId ? null : await getKycTier(ctx, payout.ownerUserId);
    // Who the account has to be in the name of: the identity verified at Level 1.
    const tierOne = payout.organizationId
      ? null
      : (await getApprovedKycSubmissions(ctx, payout.ownerUserId)).find(
          (submission) => submission.requestedTier === 1,
        );

    const names = new Map<Id<"users">, string>();
    const nameOf = async (userId: Id<"users"> | undefined) => {
      if (!userId) return null;
      const cached = names.get(userId);
      if (cached) return cached;
      const name = (await ctx.db.get(userId))?.displayName ?? "Unknown";
      names.set(userId, name);
      return name;
    };

    // What happened to it and when, in order, from the payout itself.
    const happened: Array<{
      kind: "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "PAID" | "FAILED";
      at: number;
      actor: Id<"users"> | undefined;
      note: string | null;
    }> = [
      { kind: "REQUESTED", at: payout.requestedAt, actor: payout.requestedBy, note: null },
    ];
    if (payout.approvedAt !== undefined) {
      happened.push({
        kind: "APPROVED",
        at: payout.approvedAt,
        actor: payout.approvedBy,
        note: payout.approvalNote ?? null,
      });
    }
    if (payout.rejectedAt !== undefined) {
      happened.push({
        kind: "REJECTED",
        at: payout.rejectedAt,
        actor: payout.rejectedBy,
        note: payout.rejectionReason ?? null,
      });
    }
    if (payout.cancelledAt !== undefined) {
      happened.push({
        kind: "CANCELLED",
        at: payout.cancelledAt,
        // Older cancellations didn't record who: it was the requester then.
        actor: payout.cancelledBy ?? payout.requestedBy,
        note: null,
      });
    }
    if (payout.paidAt !== undefined) {
      happened.push({ kind: "PAID", at: payout.paidAt, actor: payout.paidBy, note: null });
    }
    if (payout.failedAt !== undefined) {
      happened.push({
        kind: "FAILED",
        at: payout.failedAt,
        actor: payout.failedBy,
        note: payout.failureReason ?? null,
      });
    }
    happened.sort((a, b) => a.at - b.at);

    return {
      ...staffSummary(payout, fundraiser, owner, organization),
      ownerEmail: owner?.email ?? null,
      identityOnFile: tierOne
        ? {
            legalName: tierOne.legalName ?? null,
            phoneNumber: tierOne.phoneNumber ?? null,
          }
        : null,
      ownerTier: tier,
      // The limit, and what this person has been paid or asked for in total.
      ownerLimit: tier === null ? null : tierPayoutLimitKes(tier),
      ownerCommitted: payout.organizationId
        ? null
        : await committedKes(ctx, payout.ownerUserId),
      // Whole account details: this is what staff send the money to.
      account: account
        ? {
            method: account.method,
            holder: account.holder,
            accountName: account.accountName,
            mpesaNumber: account.mpesaNumber ?? null,
            bankName: account.bankName ?? null,
            bankAccountNumber: account.bankAccountNumber ?? null,
            status: account.status,
          }
        : null,
      // The account the fundraiser is paid to now, if it isn't the one asked for.
      accountChanged: selection?.payoutAccountId !== payout.payoutAccountId,
      blockers: blockers.map((b) => ({ code: b.code, message: b.message })),
      balance: {
        available: roundMoney(availableBalance(balance)),
        pending: roundMoney(balance?.pendingNet ?? 0),
        reserved: roundMoney(balance?.reserved ?? 0),
        paid: roundMoney(balance?.paid ?? 0),
      },
      requestedByName: await nameOf(payout.requestedBy),
      // Why this admin can't approve it, if they can't. Enforced on approval too.
      approveBlocked:
        payout.status === "REQUESTED" ? approvalBlockedReason(user, payout) : null,
      timeline: await Promise.all(
        happened.map(async (event) => ({
          kind: event.kind,
          at: event.at,
          actorName: await nameOf(event.actor),
          note: event.note,
        })),
      ),
      approvalNote: payout.approvalNote ?? null,
      rejectionReason: payout.rejectionReason ?? null,
      providerReference: payout.providerReference ?? null,
      transferFeeAmount: payout.transferFeeAmount ?? null,
      failureReason: payout.failureReason ?? null,
    };
  },
});

/**
 * Why this admin can't approve this payout, or null if they can. Shown on the
 * screen and enforced when approving, so the two can't disagree.
 */
function approvalBlockedReason(
  admin: Doc<"users">,
  payout: Doc<"payouts">,
): string | null {
  // Someone else has to look at it: nobody approves money going to themselves.
  if (payout.requestedBy === admin._id || payout.ownerUserId === admin._id) {
    return "You can't approve a payout to yourself. Ask another admin.";
  }
  // Above the Level 2 limit, the MLRO approves each payout (policy 5.3).
  if (payout.needsEnhancedApproval && !isMlro(admin)) {
    return "Only the MLRO can approve a payout above the Level 2 limit.";
  }
  return null;
}

async function loadPayout(ctx: MutationCtx, payoutId: Id<"payouts">) {
  const payout = await ctx.db.get(payoutId);
  if (!payout) throw new ConvexError("Payout not found.");
  return payout;
}

function requireStatus(payout: Doc<"payouts">, allowed: PayoutStatus[], message: string) {
  if (!allowed.includes(payout.status)) throw new ConvexError(message);
}

export const approvePayout = mutation({
  args: { payoutId: v.id("payouts"), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const payout = await loadPayout(ctx, args.payoutId);
    requireStatus(payout, ["REQUESTED"], "Only a payout waiting for review can be approved.");

    const blocked = approvalBlockedReason(admin, payout);
    if (blocked) throw new ConvexError(blocked);

    const note = cleanNote(args.note);
    if (payout.needsEnhancedApproval) {
      if ((note?.length ?? 0) < MIN_REJECTION_REASON_LENGTH) {
        throw new ConvexError(
          "This payout is above the Level 2 limit. Record the reason for approving it in the note.",
        );
      }
    }

    const now = Date.now();
    // Everything has to still hold today, not only when it was asked for.
    await assertPayoutEligible(ctx, payout.fundraiserId, now);
    const selection = await getFundraiserPayoutSelection(ctx, payout.fundraiserId);
    if (selection?.payoutAccountId !== payout.payoutAccountId) {
      throw new ConvexError(
        "The fundraiser's payout account has changed since this was requested. Reject it and ask the owner to request again.",
      );
    }

    await ctx.db.patch(payout._id, {
      status: "APPROVED",
      approvedBy: admin._id,
      approvedAt: now,
      approvalNote: note,
    });
    await logAction(ctx, {
      actorId: admin._id,
      action: "PAYOUT_APPROVED",
      fundraiserId: payout.fundraiserId,
      payoutId: payout._id,
      payoutAccountId: payout.payoutAccountId,
      statusBefore: "REQUESTED",
      statusAfter: "APPROVED",
      note,
    });
    return null;
  },
});

/** Declines a request, or stops an approved one that hasn't been sent. */
export const rejectPayout = mutation({
  args: { payoutId: v.id("payouts"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const payout = await loadPayout(ctx, args.payoutId);
    requireStatus(payout, ["REQUESTED", "APPROVED"], "This payout can't be rejected.");

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        `Give a reason of at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(payout._id, {
      status: "REJECTED",
      rejectedBy: admin._id,
      rejectedAt: now,
      rejectionReason: reason,
    });
    await releaseReservation(ctx, payout.fundraiserId, payout.amount, now);
    await logAction(ctx, {
      actorId: admin._id,
      action: "PAYOUT_REJECTED",
      fundraiserId: payout.fundraiserId,
      payoutId: payout._id,
      payoutAccountId: payout.payoutAccountId,
      statusBefore: payout.status,
      statusAfter: "REJECTED",
      note: reason,
    });
    return null;
  },
});

/**
 * Records that staff sent an approved payout. The reference is the M-Pesa code
 * or bank reference of the transfer, and can only be recorded once. Eligibility
 * is deliberately not checked again: the money has already gone.
 */
export const markPayoutPaid = mutation({
  args: {
    payoutId: v.id("payouts"),
    providerReference: v.string(),
    transferFeeAmount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const payout = await loadPayout(ctx, args.payoutId);
    requireStatus(payout, ["APPROVED"], "Only an approved payout can be marked as paid.");

    const reference = args.providerReference.trim().toUpperCase();
    if (
      reference.length < MIN_PAYOUT_REFERENCE_LENGTH ||
      reference.length > MAX_PAYOUT_REFERENCE_LENGTH
    ) {
      throw new ConvexError(
        `Enter the M-Pesa code or bank reference (${MIN_PAYOUT_REFERENCE_LENGTH} to ${MAX_PAYOUT_REFERENCE_LENGTH} characters).`,
      );
    }
    const used = await ctx.db
      .query("payouts")
      .withIndex("by_providerReference", (q) => q.eq("providerReference", reference))
      .first();
    if (used) {
      throw new ConvexError("That reference is already recorded against another payout.");
    }

    const fee = roundMoney(args.transferFeeAmount ?? 0);
    if (!Number.isFinite(fee) || fee < 0 || fee >= payout.amount) {
      throw new ConvexError("The transfer charge has to be zero or more, and less than the payout.");
    }

    const now = Date.now();
    await ctx.db.patch(payout._id, {
      status: "PAID",
      paidBy: admin._id,
      paidAt: now,
      providerReference: reference,
      transferFeeAmount: fee,
    });
    await markReservationPaid(ctx, payout.fundraiserId, payout.amount, now);
    await logAction(ctx, {
      actorId: admin._id,
      action: "PAYOUT_PAID",
      fundraiserId: payout.fundraiserId,
      payoutId: payout._id,
      payoutAccountId: payout.payoutAccountId,
      statusBefore: "APPROVED",
      statusAfter: "PAID",
      note: `Reference ${reference}. Transfer charge KES ${fee}.`,
    });
    return null;
  },
});

/** The transfer didn't go through. The money goes back to the balance. */
export const markPayoutFailed = mutation({
  args: { payoutId: v.id("payouts"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const payout = await loadPayout(ctx, args.payoutId);
    requireStatus(payout, ["APPROVED"], "Only an approved payout can be marked as failed.");

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        `Give a reason of at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(payout._id, {
      status: "FAILED",
      failedBy: admin._id,
      failedAt: now,
      failureReason: reason,
    });
    await releaseReservation(ctx, payout.fundraiserId, payout.amount, now);
    await logAction(ctx, {
      actorId: admin._id,
      action: "PAYOUT_FAILED",
      fundraiserId: payout.fundraiserId,
      payoutId: payout._id,
      payoutAccountId: payout.payoutAccountId,
      statusBefore: "APPROVED",
      statusAfter: "FAILED",
      note: reason,
    });
    return null;
  },
});
