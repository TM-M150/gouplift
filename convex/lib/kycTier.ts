import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { KycTier } from "../../lib/kyc";

// A person has at most one approved submission per tier, so this is far more
// than enough; it only keeps the read bounded.
const MAX_APPROVED_SUBMISSIONS = 10;

/** Every approved submission a person has, one per tier at most. */
export async function getApprovedKycSubmissions(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"kycSubmissions">[]> {
  return await ctx.db
    .query("kycSubmissions")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", "APPROVED"),
    )
    .take(MAX_APPROVED_SUBMISSIONS);
}

/** The highest tier among approved submissions, or 0 if there are none. */
export function highestKycTier(
  approved: ReadonlyArray<Pick<Doc<"kycSubmissions">, "requestedTier">>,
): KycTier {
  let tier: KycTier = 0;
  for (const submission of approved) {
    if (submission.requestedTier > tier) tier = submission.requestedTier;
  }
  return tier;
}

/**
 * The tier an individual fundraiser has been verified to: the highest one with
 * an approved submission, or 0 if there is none. This is the only place a
 * tier is worked out, so everything that asks (payout eligibility, the
 * verification page, staff review) agrees.
 */
export async function getKycTier(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<KycTier> {
  return highestKycTier(await getApprovedKycSubmissions(ctx, userId));
}
