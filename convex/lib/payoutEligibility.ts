import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { KycTier } from "../../lib/kyc";
import { payoutChangeHeldUntil } from "../../lib/payout-accounts";
import { isEddOutstanding, type EddState } from "../../lib/risk";
import { getKycTier } from "./kycTier";
import {
  getFundraiserPayoutSelection,
  payoutAccountBelongsToFundraiser,
} from "./payoutAccounts";
import { getRiskProfile } from "./riskProfile";

// AML policy 5.2 and 5.5: no money is released to a fundraiser who hasn't been
// verified, and staff can hold payouts at any time. There is no payout flow in
// the app yet, so this is the single check that flow must call before moving
// money (see assertPayoutEligible below).
//
// An individual must have an approved Tier 1 or higher (policy 5.3, see
// lib/kycTier.ts). The money goes only to a verified payout account that
// belongs to the fundraiser's owner (policy 5.5), and not for a while after
// the account was changed. An individual must also have been rated for risk
// (policy 4.3), and if the rating calls for enhanced due diligence (policy 7,
// 8) the MLRO must have approved it and recorded it. This only says whether money may move at all;
// holding a payout to the tier's cumulative limit needs the amounts, and
// belongs to the payout flow.

type FundraiserStatus = Doc<"fundraisers">["status"];

export type PayoutBlockerCode =
  | "ON_HOLD"
  | "FUNDRAISER_STATUS"
  | "OWNER_NOT_VERIFIED"
  | "RISK_NOT_RATED"
  | "EDD_REQUIRED"
  | "ORGANIZATION_NOT_VERIFIED"
  | "PAYOUT_ACCOUNT_MISSING"
  | "PAYOUT_ACCOUNT_NOT_VERIFIED"
  | "PAYOUT_ACCOUNT_MISMATCH"
  | "PAYOUT_ACCOUNT_RECENTLY_CHANGED";

export interface PayoutBlocker {
  code: PayoutBlockerCode;
  // For staff and logs. Never show a hold's blocker to the fundraiser (policy 12.3).
  message: string;
}

// Statuses whose money may be paid out. A campaign that has finished (full,
// ended or expired) still owes its donations to the beneficiary. A paused,
// cancelled, rejected or unpublished one does not, until staff decide what
// happens to the money (policy 5.9).
export const PAYABLE_STATUSES: ReadonlySet<FundraiserStatus> = new Set([
  "ACTIVE",
  "COMPLETED",
  "EXPIRED",
]);

interface EligibilityInput {
  fundraiser: Pick<
    Doc<"fundraisers">,
    "status" | "organizationId" | "creatorId"
  >;
  // The KYC tier of the fundraiser's owner. Not looked at for an organization's
  // fundraiser, which is checked through the organization instead.
  ownerKycTier: KycTier;
  // The owner's risk profile, null if they haven't been rated. Not looked at
  // for an organization's fundraiser (organizations are rated separately).
  ownerRisk: EddState | null;
  organization: Pick<Doc<"organizations">, "verificationStatus"> | null;
  hasActiveHold: boolean;
  // The account the fundraiser is set to be paid to, null if none was chosen.
  payoutAccount: Pick<
    Doc<"payoutAccounts">,
    "status" | "userId" | "organizationId"
  > | null;
  // When that account replaced an earlier one, if it did.
  payoutAccountChangedAt: number | null;
  // The time to judge the hold after an account change against. Null skips
  // that rule, for queries, which can't read the clock.
  now: number | null;
}

/** Pure rules, no database. Empty array means the money may be released. */
export function evaluatePayoutEligibility(
  input: EligibilityInput,
): PayoutBlocker[] {
  const blockers: PayoutBlocker[] = [];

  if (input.hasActiveHold) {
    blockers.push({
      code: "ON_HOLD",
      message: "Payouts are on hold by staff.",
    });
  }

  if (!PAYABLE_STATUSES.has(input.fundraiser.status)) {
    blockers.push({
      code: "FUNDRAISER_STATUS",
      message: `The fundraiser is ${input.fundraiser.status.toLowerCase().replace("_", " ")}.`,
    });
  }

  if (input.fundraiser.organizationId) {
    // A missing organization is treated as unverified, never as "nothing to check".
    if (input.organization?.verificationStatus !== "VERIFIED") {
      blockers.push({
        code: "ORGANIZATION_NOT_VERIFIED",
        message: "The organization hasn't been verified.",
      });
    }
  } else if (input.ownerKycTier < 1) {
    blockers.push({
      code: "OWNER_NOT_VERIFIED",
      message: "The fundraiser's owner hasn't been verified.",
    });
  } else if (!input.ownerRisk) {
    // Verified, but nobody has rated them. Until then we don't know whether
    // they need enhanced due diligence, so the answer is no.
    blockers.push({
      code: "RISK_NOT_RATED",
      message: "The fundraiser's owner hasn't been risk rated.",
    });
  } else if (isEddOutstanding(input.ownerRisk)) {
    blockers.push({
      code: "EDD_REQUIRED",
      message:
        "The fundraiser's owner needs enhanced due diligence, approved by the MLRO.",
    });
  }

  if (!input.payoutAccount) {
    blockers.push({
      code: "PAYOUT_ACCOUNT_MISSING",
      message: "No payout account has been chosen.",
    });
  } else if (
    !payoutAccountBelongsToFundraiser(input.payoutAccount, input.fundraiser)
  ) {
    blockers.push({
      code: "PAYOUT_ACCOUNT_MISMATCH",
      message: "The payout account doesn't belong to the fundraiser's owner.",
    });
  } else if (input.payoutAccount.status !== "VERIFIED") {
    blockers.push({
      code: "PAYOUT_ACCOUNT_NOT_VERIFIED",
      message: "The payout account hasn't been verified.",
    });
  }

  if (
    input.now !== null &&
    input.payoutAccountChangedAt !== null &&
    input.now < payoutChangeHeldUntil(input.payoutAccountChangedAt)
  ) {
    blockers.push({
      code: "PAYOUT_ACCOUNT_RECENTLY_CHANGED",
      message: "The payout account was changed recently.",
    });
  }

  return blockers;
}

/** The current hold on a fundraiser, if there is one. */
export async function getActivePayoutHold(
  ctx: QueryCtx | MutationCtx,
  fundraiserId: Id<"fundraisers">,
): Promise<Doc<"fundraiserPayoutHolds"> | null> {
  return await ctx.db
    .query("fundraiserPayoutHolds")
    .withIndex("by_fundraiserId_and_status", (q) =>
      q.eq("fundraiserId", fundraiserId).eq("status", "ACTIVE"),
    )
    .first();
}

/**
 * Loads what the rules need and returns whatever is stopping a payout. Pass
 * the time to judge the hold after an account change against, or null from a
 * query, which can't read the clock.
 */
export async function getPayoutBlockers(
  ctx: QueryCtx | MutationCtx,
  fundraiser: Doc<"fundraisers">,
  now: number | null,
): Promise<PayoutBlocker[]> {
  const [ownerKycTier, ownerRisk, organization, hold, selection] =
    await Promise.all([
      // A missing creator has no approved submissions, so reads as tier 0.
      getKycTier(ctx, fundraiser.creatorId),
      getRiskProfile(ctx, fundraiser.creatorId),
      fundraiser.organizationId ? ctx.db.get(fundraiser.organizationId) : null,
      getActivePayoutHold(ctx, fundraiser._id),
      getFundraiserPayoutSelection(ctx, fundraiser._id),
    ]);
  const payoutAccount = selection
    ? await ctx.db.get(selection.payoutAccountId)
    : null;

  return evaluatePayoutEligibility({
    fundraiser,
    ownerKycTier,
    ownerRisk,
    organization,
    hasActiveHold: hold !== null,
    payoutAccount,
    payoutAccountChangedAt: selection?.changedAt ?? null,
    now,
  });
}

/**
 * Throws unless money for this fundraiser may be released. Every payout
 * mutation calls this first, inside the same transaction that marks donations
 * paid, so a hold placed a moment earlier can't be missed.
 */
export async function assertPayoutEligible(
  ctx: QueryCtx | MutationCtx,
  fundraiserId: Id<"fundraisers">,
  now: number = Date.now(),
): Promise<void> {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!fundraiser) throw new ConvexError("Fundraiser not found.");

  const blockers = await getPayoutBlockers(ctx, fundraiser, now);
  if (blockers.length > 0) {
    throw new ConvexError(
      `Payout blocked: ${blockers.map((b) => b.message).join(" ")}`,
    );
  }
}
