import type { TestConvex } from "convex-test";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertOrgRiskProfile } from "./org.fixtures";
import { insertRiskProfile } from "./risk.fixtures";
import { recordCompletedDonation } from "./lib/payoutBalance";

// Test helpers, not a Convex module: the extra dot in the name keeps it out of
// the deploy, the same way *.test.ts files are. The test files that use this
// have to mock ./auth themselves (see payouts.test.ts), because vi.mock is
// per test file.

export type T = TestConvex<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A verified Level 1 owner with an active fundraiser paid to a verified M-Pesa
 * account, two admins (a payout can't be approved by the person it is for), a
 * moderator and a stranger.
 */
export async function seedPayoutWorld(t: T) {
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const user = (authUserId: string, role: Doc<"users">["role"]) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName: authUserId,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });

    const owner = await user("auth_owner", "USER");
    const admin = await user("auth_admin", "ADMIN");
    const admin2 = await user("auth_admin2", "ADMIN");
    const moderator = await user("auth_mod", "MODERATOR");
    const stranger = await user("auth_stranger", "USER");

    // Verified means an approved KYC submission, and a Low risk rating.
    const kycId = await ctx.db.insert("kycSubmissions", {
      userId: owner,
      requestedTier: 1,
      status: "APPROVED",
      submittedAt: now,
    });
    await insertRiskProfile(ctx, {
      userId: owner,
      kycSubmissionId: kycId,
      ratedBy: admin,
    });

    // Paid to the number confirmed at Level 1, which needs no further review.
    const payoutAccount = await ctx.db.insert("payoutAccounts", {
      userId: owner,
      method: "MPESA",
      holder: "OWN",
      accountName: "Verified Owner",
      mpesaNumber: "+254712345678",
      status: "VERIFIED",
      verifiedVia: "KYC_PHONE",
      createdAt: now,
    });
    const fundraiser = await ctx.db.insert("fundraisers", {
      creatorId: owner,
      beneficiaryType: "SELF",
      title: "Water for Kajiado",
      story: "A story that is long enough to be a story.",
      type: "COMMUNITY_HARAMBEE",
      goalAmount: 100000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status: "ACTIVE",
      isPrivate: false,
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("fundraiserPayoutAccounts", {
      fundraiserId: fundraiser,
      payoutAccountId: payoutAccount,
      selectedBy: owner,
      selectedAt: now,
    });

    return {
      owner,
      admin,
      admin2,
      moderator,
      stranger,
      kycId,
      payoutAccount,
      fundraiser,
    };
  });

  const as = (subject: string) => t.withIdentity({ subject });
  return {
    t,
    ids,
    asOwner: as("auth_owner"),
    asAdmin: as("auth_admin"),
    asAdmin2: as("auth_admin2"),
    asModerator: as("auth_mod"),
    asStranger: as("auth_stranger"),
  };
}

export type World = Awaited<ReturnType<typeof seedPayoutWorld>>;

/** Another active fundraiser for the same person, paid to the same account. */
export function addFundraiser(
  t: T,
  creatorId: Id<"users">,
  payoutAccountId: Id<"payoutAccounts">,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const fundraiserId = await ctx.db.insert("fundraisers", {
      creatorId,
      beneficiaryType: "SELF",
      title: "School fees",
      story: "A story that is long enough to be a story.",
      type: "EDUCATION",
      goalAmount: 100000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status: "ACTIVE",
      isPrivate: false,
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("fundraiserPayoutAccounts", {
      fundraiserId,
      payoutAccountId,
      selectedBy: creatorId,
      selectedAt: now,
    });
    return fundraiserId;
  });
}

/** Level 2 on top of Level 1, so the higher limit applies. */
export function approveLevel2(t: T, userId: Id<"users">) {
  return t.run((ctx) =>
    ctx.db.insert("kycSubmissions", {
      userId,
      requestedTier: 2,
      status: "APPROVED",
      submittedAt: Date.now(),
    }),
  );
}

/**
 * A verified, risk-rated organization that the owner owns, with a fundraiser
 * paid to its own verified bank account. The owner is the fundraiser's creator.
 */
export function addOrganizationFundraiser(
  t: T,
  ids: World["ids"],
  options: { role?: Doc<"organizationMembers">["role"] } = {},
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: "Kajiado Youth Trust",
      slug: "kajiado-youth-trust",
      verificationStatus: "VERIFIED",
      createdBy: ids.owner,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizationMembers", {
      organizationId,
      userId: ids.owner,
      role: options.role ?? "OWNER",
      joinedAt: now,
    });
    await insertOrgRiskProfile(ctx, {
      organizationId,
      ratedBy: ids.admin,
    });
    const payoutAccountId = await ctx.db.insert("payoutAccounts", {
      userId: ids.owner,
      organizationId,
      method: "BANK",
      holder: "OWN",
      accountName: "Kajiado Youth Trust",
      bankName: "Equity Bank",
      bankAccountNumber: "0123456789012",
      status: "VERIFIED",
      verifiedVia: "STAFF_REVIEW",
      createdAt: now,
    });
    const fundraiserId = await ctx.db.insert("fundraisers", {
      creatorId: ids.owner,
      organizationId,
      beneficiaryType: "ORGANIZATION",
      title: "Clean water",
      story: "A story that is long enough to be a story.",
      type: "NONPROFIT",
      goalAmount: 100000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status: "ACTIVE",
      isPrivate: false,
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("fundraiserPayoutAccounts", {
      fundraiserId,
      payoutAccountId,
      selectedBy: ids.owner,
      selectedAt: now,
    });
    return { organizationId, fundraiserId, payoutAccountId };
  });
}

/**
 * A completed donation of exactly `net` shillings after the platform fee,
 * counted into the fundraiser's balance the way the real payment paths do.
 * (The fee is left out of the fixture: the balance only ever reads netAmount.)
 */
export function fund(
  t: T,
  fundraiserId: Id<"fundraisers">,
  net: number,
  options: {
    provider?: "SASAPAY" | "PAYPAL";
    completedAt?: number;
    // Insert it without going through the balance, like a donation made before
    // payouts existed.
    uncounted?: boolean;
    status?: Doc<"donations">["status"];
  } = {},
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const donationId = await ctx.db.insert("donations", {
      fundraiserId,
      isAnonymous: false,
      grossAmount: net,
      currency: "KES",
      ...(options.provider ? { provider: options.provider } : {}),
      platformFeeRate: 0,
      platformFeeAmount: 0,
      netAmount: net,
      status: options.status ?? "COMPLETED",
      payoutStatus: "PENDING_PAYOUT",
      completedAt: options.completedAt ?? now,
      createdAt: options.completedAt ?? now,
      updatedAt: now,
    });
    if (!options.uncounted) await recordCompletedDonation(ctx, donationId, now);
    return donationId;
  });
}

export const balanceOf = (t: T, fundraiserId: Id<"fundraisers">) =>
  t.run((ctx) =>
    ctx.db
      .query("fundraiserBalances")
      .withIndex("by_fundraiserId", (q) => q.eq("fundraiserId", fundraiserId))
      .unique(),
  );

/** The four stored figures, for comparing without the ids and timestamps. */
export async function figures(t: T, fundraiserId: Id<"fundraisers">) {
  const row = await balanceOf(t, fundraiserId);
  return {
    settledNet: row?.settledNet ?? 0,
    pendingNet: row?.pendingNet ?? 0,
    reserved: row?.reserved ?? 0,
    paid: row?.paid ?? 0,
  };
}

/** A payout row as it would be after the owner asked, for tests that skip that. */
export function insertPayout(
  t: T,
  world: Pick<World, "ids">,
  options: {
    fundraiserId?: Id<"fundraisers">;
    amount: number;
    status: Doc<"payouts">["status"];
    requestedAt?: number;
  },
) {
  return t.run((ctx) =>
    ctx.db.insert("payouts", {
      fundraiserId: options.fundraiserId ?? world.ids.fundraiser,
      ownerUserId: world.ids.owner,
      requestedBy: world.ids.owner,
      payoutAccountId: world.ids.payoutAccount,
      destination: "M-Pesa +254712345678",
      amount: options.amount,
      status: options.status,
      needsEnhancedApproval: false,
      requestedAt: options.requestedAt ?? Date.now(),
    }),
  );
}

export const auditEntries = (t: T) =>
  t.run((ctx) => ctx.db.query("adminAuditLog").collect());

export const payoutRow = (t: T, payoutId: Id<"payouts">) =>
  t.run((ctx) => ctx.db.get(payoutId));

export { DAY_MS };
