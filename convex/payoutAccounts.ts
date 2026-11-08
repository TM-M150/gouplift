import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  PAYOUT_METHOD_LABELS,
  MAX_OPEN_PAYOUT_ACCOUNTS,
  isVerifiedKycPhone,
  maskAccountNumber,
} from "../lib/payout-accounts";
import { payoutAccountDetailsSchema } from "../lib/validations/payout-account";
import { logAction } from "./lib/adminAudit";
import { claimRegisteredFile } from "./lib/documentFiles";
import { getApprovedKycSubmissions, highestKycTier } from "./lib/kycTier";
import { getOwnerAccess, NOT_ORGANIZATION_OWNER } from "./lib/orgAccess";
import {
  getFundraiserPayoutSelection,
  payoutAccountBelongsToFundraiser,
  wasEverVerified,
} from "./lib/payoutAccounts";
import {
  payoutHolderValidator,
  payoutMethodValidator,
} from "./lib/payoutAccountValidators";
import { getCurrentUserDoc } from "./lib/staff";

// Where a fundraiser's money can be sent (AML policy 5.5). An account is added
// here, verified (see payoutAccountReview.ts) and then chosen for each
// fundraiser. Details never change once saved: to change where money goes, add
// another account and choose it, which pauses payouts for a while.

const LIST_LIMIT = 50;
const ORGANIZATION_LIMIT = 20;
const FUNDRAISER_LIMIT = 50;

// What the owner sees of an account. A full bank account number never goes
// back to the browser, only its last four digits, and a rejection carries only
// the reason staff wrote for the owner.
function toOwnerView(account: Doc<"payoutAccounts">) {
  return {
    _id: account._id,
    method: account.method,
    holder: account.holder,
    accountName: account.accountName,
    mpesaNumber: account.mpesaNumber ?? null,
    bankName: account.bankName ?? null,
    bankAccountMasked: account.bankAccountNumber
      ? maskAccountNumber(account.bankAccountNumber)
      : null,
    justification: account.justification ?? null,
    status: account.status,
    verifiedVia: account.verifiedVia ?? null,
    rejectionReason: account.rejectionReason ?? null,
    createdAt: account.createdAt,
  };
}

const isOpen = (account: Doc<"payoutAccounts">) =>
  account.status === "PENDING_REVIEW" || account.status === "VERIFIED";

export const getMyPayoutAccounts = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;

    const approved = await getApprovedKycSubmissions(ctx, user._id);
    const tierOne = approved.find((s) => s.requestedTier === 1);

    const personal = (
      await ctx.db
        .query("payoutAccounts")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(LIST_LIMIT)
    ).filter((account) => !account.organizationId && account.status !== "CLOSED");

    // Only an organization's owner decides where its money goes.
    const memberships = (
      await ctx.db
        .query("organizationMembers")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .take(ORGANIZATION_LIMIT)
    ).filter((membership) => membership.role === "OWNER");

    const organizations = [];
    for (const membership of memberships) {
      const organization = await ctx.db.get(membership.organizationId);
      if (!organization) continue;
      const accounts = (
        await ctx.db
          .query("payoutAccounts")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", organization._id),
          )
          .order("desc")
          .take(LIST_LIMIT)
      ).filter((account) => account.status !== "CLOSED");
      organizations.push({
        _id: organization._id,
        name: organization.name,
        isVerified: organization.verificationStatus === "VERIFIED",
        accounts: accounts.map(toOwnerView),
      });
    }

    return {
      tier: highestKycTier(approved),
      // The mobile number already confirmed in the owner's name: an M-Pesa
      // account on it needs no further review.
      verifiedPhone: tierOne?.phoneNumber ?? null,
      maxOpenAccounts: MAX_OPEN_PAYOUT_ACCOUNTS,
      personal: personal.map(toOwnerView),
      organizations,
    };
  },
});

// Each of the owner's fundraisers with the account it is paid to. Holds and
// the reasons for them are not part of this (policy 12.3): the owner sees only
// the state of their own account.
export const getMyPayoutDestinations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;

    const rows: Array<{
      fundraiser: Doc<"fundraisers">;
      organizationName: string | null;
    }> = (
      await ctx.db
        .query("fundraisers")
        .withIndex("by_creatorId", (q) => q.eq("creatorId", user._id))
        .order("desc")
        .take(FUNDRAISER_LIMIT)
    )
      .filter((fundraiser) => !fundraiser.organizationId)
      .map((fundraiser) => ({ fundraiser, organizationName: null }));

    const memberships = (
      await ctx.db
        .query("organizationMembers")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .take(ORGANIZATION_LIMIT)
    ).filter((membership) => membership.role === "OWNER");
    for (const membership of memberships) {
      const organization = await ctx.db.get(membership.organizationId);
      if (!organization) continue;
      const organizationFundraisers = await ctx.db
        .query("fundraisers")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organization._id),
        )
        .order("desc")
        .take(FUNDRAISER_LIMIT);
      rows.push(
        ...organizationFundraisers.map((fundraiser) => ({
          fundraiser,
          organizationName: organization.name,
        })),
      );
    }

    return await Promise.all(
      rows.map(async ({ fundraiser, organizationName }) => {
        const selection = await getFundraiserPayoutSelection(
          ctx,
          fundraiser._id,
        );
        const account = selection
          ? await ctx.db.get(selection.payoutAccountId)
          : null;
        return {
          fundraiserId: fundraiser._id,
          title: fundraiser.title,
          status: fundraiser.status,
          organizationId: fundraiser.organizationId ?? null,
          organizationName,
          payoutAccountId: selection?.payoutAccountId ?? null,
          accountStatus: account?.status ?? null,
          // When the account replaced an earlier one. The app works out how long
          // payouts stay paused from this, so the query needs no clock.
          changedAt: selection?.changedAt ?? null,
        };
      }),
    );
  },
});

async function requireUser(ctx: MutationCtx) {
  const user = await getCurrentUserDoc(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

// The owner of an account: the organization's owner for an organization's
// account, otherwise the person who added it.
async function canManageAccount(
  ctx: MutationCtx,
  user: Doc<"users">,
  account: Pick<Doc<"payoutAccounts">, "userId" | "organizationId">,
) {
  if (account.organizationId) {
    return (await getOwnerAccess(ctx, account.organizationId)) !== null;
  }
  return account.userId === user._id;
}

export const addPayoutAccount = mutation({
  args: {
    // Set to add an account for an organization you own.
    organizationId: v.optional(v.id("organizations")),
    method: payoutMethodValidator,
    holder: payoutHolderValidator,
    accountName: v.string(),
    mpesaNumber: v.optional(v.string()),
    bankName: v.optional(v.string()),
    bankAccountNumber: v.optional(v.string()),
    justification: v.optional(v.string()),
    // Needed unless the account is the number already verified at Level 1.
    proof: v.optional(
      v.object({ storageId: v.id("_storage"), fileName: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    if (args.organizationId) {
      const access = await getOwnerAccess(ctx, args.organizationId);
      if (!access) throw new ConvexError(NOT_ORGANIZATION_OWNER);
      if (access.organization.verificationStatus !== "VERIFIED") {
        throw new ConvexError(
          "Your organization has to be verified before you can add a payout account.",
        );
      }
    }

    const parsed = payoutAccountDetailsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Check the details you entered.",
      );
    }
    const details = parsed.data;

    // Who may add what (policy 5.3). An individual's first account is the
    // mobile number a reviewer already confirmed is theirs, which needs no
    // further review. Any other account needs Level 2, whose requirements
    // include proof the account is theirs.
    let verifiedName: string | null = null;
    if (!args.organizationId) {
      const approved = await getApprovedKycSubmissions(ctx, user._id);
      const tier = highestKycTier(approved);
      if (tier < 1) {
        throw new ConvexError("Verify your identity before adding a payout account.");
      }
      const tierOne = approved.find((s) => s.requestedTier === 1);
      if (isVerifiedKycPhone(details, tierOne?.phoneNumber)) {
        verifiedName = tierOne?.legalName ?? null;
      } else if (tier < 2) {
        throw new ConvexError(
          "At Level 1, payouts go to the mobile number you verified. Reach Level 2 to use another account.",
        );
      }
    }
    const autoVerified = verifiedName !== null;

    // The accounts already added by this owner.
    const existing = (
      args.organizationId
        ? await ctx.db
            .query("payoutAccounts")
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", args.organizationId),
            )
            .take(LIST_LIMIT)
        : (
            await ctx.db
              .query("payoutAccounts")
              .withIndex("by_userId", (q) => q.eq("userId", user._id))
              .take(LIST_LIMIT)
          ).filter((account) => !account.organizationId)
    ).filter(isOpen);

    if (existing.length >= MAX_OPEN_PAYOUT_ACCOUNTS) {
      throw new ConvexError(
        `You can have up to ${MAX_OPEN_PAYOUT_ACCOUNTS} payout accounts. Remove one first.`,
      );
    }
    const duplicate = existing.some((account) =>
      details.method === "MPESA"
        ? account.mpesaNumber === details.mpesaNumber
        : account.bankAccountNumber === details.bankAccountNumber &&
          account.bankName?.toLowerCase() === details.bankName?.toLowerCase(),
    );
    if (duplicate) {
      throw new ConvexError("You've already added this account.");
    }

    if (!autoVerified && !args.proof) {
      throw new ConvexError(
        "Upload proof that the account is what you say it is.",
      );
    }
    const proof = args.proof
      ? await claimRegisteredFile(ctx, user._id, args.proof)
      : null;

    const now = Date.now();
    const payoutAccountId = await ctx.db.insert("payoutAccounts", {
      userId: user._id,
      organizationId: args.organizationId,
      method: details.method,
      holder: details.holder,
      accountName: verifiedName ?? details.accountName,
      mpesaNumber: details.mpesaNumber,
      bankName: details.bankName,
      bankAccountNumber: details.bankAccountNumber,
      justification: details.justification,
      ...(proof && args.proof
        ? {
            proofStorageId: args.proof.storageId,
            proofFileName: proof.fileName,
            proofContentType: proof.contentType,
            proofSize: proof.size,
          }
        : {}),
      status: autoVerified ? "VERIFIED" : "PENDING_REVIEW",
      verifiedVia: autoVerified ? "KYC_PHONE" : undefined,
      createdAt: now,
    });

    if (autoVerified) {
      // An automatic decision is still a decision, so it is on the record.
      await logAction(ctx, {
        actorId: user._id,
        action: "PAYOUT_ACCOUNT_APPROVED",
        payoutAccountId,
        statusBefore: "NEW",
        statusAfter: "VERIFIED",
        note: "Automatic: the M-Pesa number is the mobile number verified at Level 1.",
      });
    }

    return { payoutAccountId, status: autoVerified ? "VERIFIED" : "PENDING_REVIEW" } as const;
  },
});

export const closePayoutAccount = mutation({
  args: { payoutAccountId: v.id("payoutAccounts") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const account = await ctx.db.get(args.payoutAccountId);
    if (!account || !(await canManageAccount(ctx, user, account))) {
      throw new ConvexError("Payout account not found.");
    }
    if (!isOpen(account)) {
      throw new ConvexError("This account can't be removed.");
    }

    // A fundraiser still set to be paid to it simply stops being payable until
    // another account is chosen (and verified).
    await ctx.db.patch(account._id, { status: "CLOSED", closedAt: Date.now() });
  },
});

export const setFundraiserPayoutAccount = mutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    payoutAccountId: v.id("payoutAccounts"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const fundraiser = await ctx.db.get(args.fundraiserId);
    const mayChoose = fundraiser
      ? fundraiser.organizationId
        ? (await getOwnerAccess(ctx, fundraiser.organizationId)) !== null
        : fundraiser.creatorId === user._id
      : false;
    if (!fundraiser || !mayChoose) {
      throw new ConvexError("You can't change where this fundraiser is paid.");
    }

    const account = await ctx.db.get(args.payoutAccountId);
    if (!account || !payoutAccountBelongsToFundraiser(account, fundraiser)) {
      throw new ConvexError("Choose one of your own payout accounts.");
    }
    if (!isOpen(account)) {
      throw new ConvexError("That account can't be used.");
    }

    const current = await getFundraiserPayoutSelection(ctx, fundraiser._id);
    if (current?.payoutAccountId === account._id) return;

    const now = Date.now();
    if (!current) {
      await ctx.db.insert("fundraiserPayoutAccounts", {
        fundraiserId: fundraiser._id,
        payoutAccountId: account._id,
        selectedBy: user._id,
        selectedAt: now,
      });
      return;
    }

    // Replacing an account is a change of payout details (policy 5.5): the new
    // account has to be verified, and payouts pause for a while. Swapping out an
    // account that was never verified isn't, since nothing could be paid to it.
    const previous = await ctx.db.get(current.payoutAccountId);
    const isChange = previous !== null && wasEverVerified(previous);

    await ctx.db.patch(current._id, {
      payoutAccountId: account._id,
      selectedBy: user._id,
      selectedAt: now,
      changedAt: isChange ? now : current.changedAt,
    });

    if (isChange) {
      await logAction(ctx, {
        actorId: user._id,
        action: "PAYOUT_ACCOUNT_CHANGED",
        fundraiserId: fundraiser._id,
        payoutAccountId: account._id,
        statusBefore: previous.status,
        statusAfter: account.status,
        note: `Changed from ${describeAccount(previous)} to ${describeAccount(account)}.`,
      });
    }
  },
});

function describeAccount(account: Doc<"payoutAccounts">): string {
  const identifier = account.mpesaNumber
    ? account.mpesaNumber
    : maskAccountNumber(account.bankAccountNumber ?? "");
  return `${PAYOUT_METHOD_LABELS[account.method]} ${identifier}`;
}
