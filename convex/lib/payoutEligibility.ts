import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// AML policy 5.2 and 5.5: no money is released to a fundraiser who hasn't been
// verified, and staff can hold payouts at any time. There is no payout flow in
// the app yet, so this is the single check that flow must call before moving
// money (see assertPayoutEligible below).
//
// Individuals are checked with users.isVerified for now. The tiered KYC step
// (policy 5.3) replaces that with per-tier limits.

type FundraiserStatus = Doc<"fundraisers">["status"];

export type PayoutBlockerCode =
  | "ON_HOLD"
  | "FUNDRAISER_STATUS"
  | "OWNER_NOT_VERIFIED"
  | "ORGANIZATION_NOT_VERIFIED";

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
  fundraiser: Pick<Doc<"fundraisers">, "status" | "organizationId">;
  creator: Pick<Doc<"users">, "isVerified"> | null;
  organization: Pick<Doc<"organizations">, "verificationStatus"> | null;
  hasActiveHold: boolean;
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
  } else if (!input.creator?.isVerified) {
    blockers.push({
      code: "OWNER_NOT_VERIFIED",
      message: "The fundraiser's owner hasn't been verified.",
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

/** Loads what the rules need and returns whatever is stopping a payout. */
export async function getPayoutBlockers(
  ctx: QueryCtx | MutationCtx,
  fundraiser: Doc<"fundraisers">,
): Promise<PayoutBlocker[]> {
  const [creator, organization, hold] = await Promise.all([
    ctx.db.get(fundraiser.creatorId),
    fundraiser.organizationId ? ctx.db.get(fundraiser.organizationId) : null,
    getActivePayoutHold(ctx, fundraiser._id),
  ]);

  return evaluatePayoutEligibility({
    fundraiser,
    creator,
    organization,
    hasActiveHold: hold !== null,
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
): Promise<void> {
  const fundraiser = await ctx.db.get(fundraiserId);
  if (!fundraiser) throw new ConvexError("Fundraiser not found.");

  const blockers = await getPayoutBlockers(ctx, fundraiser);
  if (blockers.length > 0) {
    throw new ConvexError(
      `Payout blocked: ${blockers.map((b) => b.message).join(" ")}`,
    );
  }
}
