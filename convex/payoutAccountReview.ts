import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PAYOUT_ACCOUNT_REVIEW_CHECK_LABELS,
  PAYOUT_METHOD_LABELS,
  requiredPayoutAccountChecks,
} from "../lib/payout-accounts";
import {
  cleanNote,
  logAction,
  MIN_REJECTION_REASON_LENGTH,
} from "./lib/adminAudit";
import { getApprovedKycSubmissions, highestKycTier } from "./lib/kycTier";
import { findSharedPayoutAccounts } from "./lib/payoutAccounts";
import {
  payoutAccountReviewCheckValidator,
  payoutAccountStatusValidator,
} from "./lib/payoutAccountValidators";
import { getStaffUser, requireStaff } from "./lib/staff";

// Staff side of payout accounts (AML policy 5.5). Nothing here is reachable by
// the owner: the queries return nothing to anyone who isn't staff, and a signed
// URL for the proof is only ever produced in getPayoutAccountForReview.

const LIST_LIMIT = 100;
const HISTORY_LIMIT = 30;
const USAGE_LIMIT = 10;

async function ownerName(ctx: QueryCtx, account: Doc<"payoutAccounts">) {
  if (account.organizationId) {
    const organization = await ctx.db.get(account.organizationId);
    return organization?.name ?? "Unknown organization";
  }
  const user = await ctx.db.get(account.userId);
  return user?.displayName ?? "Unknown";
}

export const listPayoutAccountsForReview = query({
  args: { status: payoutAccountStatusValidator },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return [];

    // Waiting accounts oldest first so nobody is left queueing; decided ones
    // newest first.
    const accounts = await ctx.db
      .query("payoutAccounts")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", args.status))
      .order(args.status === "PENDING_REVIEW" ? "asc" : "desc")
      .take(LIST_LIMIT);

    return await Promise.all(
      accounts.map(async (account) => ({
        _id: account._id,
        ownerName: await ownerName(ctx, account),
        isOrganization: account.organizationId !== undefined,
        method: account.method,
        holder: account.holder,
        status: account.status,
        verifiedVia: account.verifiedVia ?? null,
        createdAt: account.createdAt,
        reviewedAt: account.reviewedAt ?? null,
      })),
    );
  },
});

export const getPayoutAccountForReview = query({
  // A string, not v.id(): the value comes straight from the URL, and an
  // invalid one should read as "not found" rather than throw.
  args: { payoutAccountId: v.string() },
  handler: async (ctx, args) => {
    const staff = await getStaffUser(ctx);
    if (!staff) return null;

    const payoutAccountId = ctx.db.normalizeId("payoutAccounts", args.payoutAccountId);
    if (!payoutAccountId) return null;

    const account = await ctx.db.get(payoutAccountId);
    if (!account) return null;

    const [owner, organization, approved, shared, usage, history] =
      await Promise.all([
        ctx.db.get(account.userId),
        account.organizationId ? ctx.db.get(account.organizationId) : null,
        getApprovedKycSubmissions(ctx, account.userId),
        findSharedPayoutAccounts(ctx, account),
        ctx.db
          .query("fundraiserPayoutAccounts")
          .withIndex("by_payoutAccountId", (q) =>
            q.eq("payoutAccountId", account._id),
          )
          .take(USAGE_LIMIT),
        ctx.db
          .query("adminAuditLog")
          .withIndex("by_payoutAccountId", (q) =>
            q.eq("payoutAccountId", account._id),
          )
          .order("desc")
          .take(HISTORY_LIMIT),
      ]);

    const names = new Map<Id<"users">, string>();
    const nameOf = async (userId: Id<"users"> | undefined) => {
      if (!userId) return null;
      const cached = names.get(userId);
      if (cached) return cached;
      const user = await ctx.db.get(userId);
      const name = user?.displayName ?? "Unknown";
      names.set(userId, name);
      return name;
    };

    const tier = highestKycTier(approved);
    const tierOne = approved.find((s) => s.requestedTier === 1);

    const standing = decisionBlockedReason(staff, account, tier, organization);

    return {
      _id: account._id,
      status: account.status,
      verifiedVia: account.verifiedVia ?? null,
      createdAt: account.createdAt,
      reviewedAt: account.reviewedAt ?? null,
      reviewedByName: await nameOf(account.reviewedBy),
      rejectionReason: account.rejectionReason ?? null,
      confirmedChecks: account.confirmedChecks ?? [],
      method: account.method,
      holder: account.holder,
      accountName: account.accountName,
      mpesaNumber: account.mpesaNumber ?? null,
      bankName: account.bankName ?? null,
      bankAccountNumber: account.bankAccountNumber ?? null,
      justification: account.justification ?? null,
      proof: account.proofStorageId
        ? {
            fileName: account.proofFileName ?? "proof",
            contentType: account.proofContentType ?? "",
            size: account.proofSize ?? 0,
            url: await ctx.storage.getUrl(account.proofStorageId),
          }
        : null,
      owner: owner ? { name: owner.displayName, email: owner.email } : null,
      organization: organization
        ? {
            _id: organization._id,
            name: organization.name,
            verificationStatus: organization.verificationStatus,
          }
        : null,
      // Who the account has to be in the name of: the verified identity.
      identityOnFile: tierOne
        ? {
            legalName: tierOne.legalName ?? null,
            idNumber: tierOne.idNumber ?? null,
            phoneNumber: tierOne.phoneNumber ?? null,
          }
        : null,
      ownerTier: tier,
      requiredChecks: requiredPayoutAccountChecks(account.holder),
      sharedAccounts: await Promise.all(
        shared.map(async (match) => ({
          payoutAccountId: match.payoutAccountId,
          status: match.status,
          createdAt: match.createdAt,
          ownerName: match.organizationId
            ? ((await ctx.db.get(match.organizationId))?.name ?? "an organization")
            : await nameOf(match.userId),
        })),
      ),
      fundraisersUsing: await Promise.all(
        usage.map(async (row) => {
          const fundraiser = await ctx.db.get(row.fundraiserId);
          return {
            fundraiserId: row.fundraiserId,
            title: fundraiser?.title ?? "Unknown fundraiser",
            changedAt: row.changedAt ?? null,
          };
        }),
      ),
      canDecide: account.status === "PENDING_REVIEW" && standing === null,
      decisionBlocked: standing,
      history: await Promise.all(
        history.map(async (entry) => ({
          _id: entry._id,
          action: entry.action,
          note: entry.note ?? null,
          createdAt: entry.createdAt,
          actorName: await nameOf(entry.actorId),
        })),
      ),
    };
  },
});

// Why this account can't be decided on right now, or null if it can. The same
// answer is shown to the reviewer and enforced when they approve.
function decisionBlockedReason(
  staff: Doc<"users">,
  account: Doc<"payoutAccounts">,
  ownerTier: number,
  organization: Doc<"organizations"> | null,
): string | null {
  // Someone with staff access can still add a payout account. They must not be
  // the one to approve it.
  if (account.userId === staff._id) {
    return "You can't review your own payout account.";
  }
  if (account.organizationId) {
    if (organization?.verificationStatus !== "VERIFIED") {
      return "The organization isn't verified.";
    }
  } else if (ownerTier < 2) {
    return "The owner isn't verified to Level 2, so can't use this account.";
  }
  return null;
}

async function loadPendingAccount(
  ctx: MutationCtx,
  payoutAccountId: Id<"payoutAccounts">,
  staff: Doc<"users">,
) {
  const account = await ctx.db.get(payoutAccountId);
  if (!account) throw new ConvexError("Payout account not found.");
  if (account.status !== "PENDING_REVIEW") {
    throw new ConvexError("This account is no longer waiting for review.");
  }
  if (account.userId === staff._id) {
    throw new ConvexError("You can't review your own payout account.");
  }
  return account;
}

export const approvePayoutAccount = mutation({
  args: {
    payoutAccountId: v.id("payoutAccounts"),
    // What the reviewer confirmed against the proof. Every check the account
    // needs has to be among them, and is stored with the approval.
    confirmedChecks: v.array(payoutAccountReviewCheckValidator),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const account = await loadPendingAccount(ctx, args.payoutAccountId, staff);

    const required = requiredPayoutAccountChecks(account.holder);
    const unconfirmed = required.filter(
      (check) => !args.confirmedChecks.includes(check),
    );
    if (unconfirmed.length > 0) {
      throw new ConvexError(
        `Confirm each check before approving: ${unconfirmed
          .map((check) => PAYOUT_ACCOUNT_REVIEW_CHECK_LABELS[check])
          .join("; ")}.`,
      );
    }

    const [approved, organization] = await Promise.all([
      getApprovedKycSubmissions(ctx, account.userId),
      account.organizationId ? ctx.db.get(account.organizationId) : null,
    ]);
    const blocked = decisionBlockedReason(
      staff,
      account,
      highestKycTier(approved),
      organization,
    );
    if (blocked) throw new ConvexError(blocked);

    await ctx.db.patch(account._id, {
      status: "VERIFIED",
      verifiedVia: "STAFF_REVIEW",
      reviewedBy: staff._id,
      reviewedAt: Date.now(),
      confirmedChecks: [...required],
      rejectionReason: undefined,
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "PAYOUT_ACCOUNT_APPROVED",
      payoutAccountId: account._id,
      statusBefore: account.status,
      statusAfter: "VERIFIED",
      note: `${PAYOUT_METHOD_LABELS[account.method]}, ${account.holder === "OWN" ? "own account" : "someone else's account"}`,
    });
  },
});

export const rejectPayoutAccount = mutation({
  args: {
    payoutAccountId: v.id("payoutAccounts"),
    // Shown to the owner, so it says what to fix and nothing else.
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const account = await loadPendingAccount(ctx, args.payoutAccountId, staff);

    const reason = cleanNote(args.reason);
    if (!reason || reason.length < MIN_REJECTION_REASON_LENGTH) {
      throw new ConvexError(
        "Give the owner a reason (at least 10 characters).",
      );
    }

    await ctx.db.patch(account._id, {
      status: "REJECTED",
      reviewedBy: staff._id,
      reviewedAt: Date.now(),
      rejectionReason: reason,
    });

    await logAction(ctx, {
      actorId: staff._id,
      action: "PAYOUT_ACCOUNT_REJECTED",
      payoutAccountId: account._id,
      statusBefore: account.status,
      statusAfter: "REJECTED",
      note: reason,
    });
  },
});
