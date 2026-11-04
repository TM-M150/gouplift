/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertPayoutEligible,
  evaluatePayoutEligibility,
  getPayoutBlockers,
  PAYABLE_STATUSES,
} from "./lib/payoutEligibility";

// The real auth component needs a running Better Auth deployment. These tests
// only need `safeGetAuthUser`, so it reads the identity convex-test attaches.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
  },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
type Status = Doc<"fundraisers">["status"];
type OrgStatus = Doc<"organizations">["verificationStatus"];

const REASON = "Donor reported that the story is copied from another campaign.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("evaluatePayoutEligibility", () => {
  const verifiedCreator = { isVerified: true };
  const base = {
    fundraiser: { status: "ACTIVE" as Status, organizationId: undefined },
    creator: verifiedCreator,
    organization: null,
    hasActiveHold: false,
  };
  const codes = (input: Parameters<typeof evaluatePayoutEligibility>[0]) =>
    evaluatePayoutEligibility(input).map((b) => b.code);

  it("allows a verified individual's active fundraiser", () => {
    expect(codes(base)).toEqual([]);
  });

  it("blocks an individual who isn't verified", () => {
    expect(codes({ ...base, creator: { isVerified: false } })).toEqual([
      "OWNER_NOT_VERIFIED",
    ]);
  });

  it("blocks when the creator can't be found", () => {
    expect(codes({ ...base, creator: null })).toEqual(["OWNER_NOT_VERIFIED"]);
  });

  it("blocks while a hold is in place, even for a verified owner", () => {
    expect(codes({ ...base, hasActiveHold: true })).toEqual(["ON_HOLD"]);
  });

  it.each(["ACTIVE", "COMPLETED", "EXPIRED"] as Status[])(
    "pays out a %s fundraiser",
    (status) => {
      expect(PAYABLE_STATUSES.has(status)).toBe(true);
      expect(codes({ ...base, fundraiser: { ...base.fundraiser, status } })).toEqual([]);
    },
  );

  it.each(["DRAFT", "PENDING_REVIEW", "PAUSED", "CANCELLED", "REJECTED"] as Status[])(
    "doesn't pay out a %s fundraiser",
    (status) => {
      expect(codes({ ...base, fundraiser: { ...base.fundraiser, status } })).toEqual([
        "FUNDRAISER_STATUS",
      ]);
    },
  );

  describe("for an organization's fundraiser", () => {
    const orgFundraiser = {
      status: "ACTIVE" as Status,
      organizationId: "org1" as Id<"organizations">,
    };

    it("needs the organization to be VERIFIED", () => {
      const statuses: OrgStatus[] = [
        "UNVERIFIED",
        "PENDING_REVIEW",
        "REJECTED",
      ];
      for (const verificationStatus of statuses) {
        expect(
          codes({
            ...base,
            fundraiser: orgFundraiser,
            organization: { verificationStatus },
          }),
        ).toEqual(["ORGANIZATION_NOT_VERIFIED"]);
      }
      expect(
        codes({
          ...base,
          fundraiser: orgFundraiser,
          organization: { verificationStatus: "VERIFIED" },
        }),
      ).toEqual([]);
    });

    it("treats a missing organization as unverified", () => {
      expect(
        codes({ ...base, fundraiser: orgFundraiser, organization: null }),
      ).toEqual(["ORGANIZATION_NOT_VERIFIED"]);
    });

    it("looks at the organization, not the individual who created the campaign", () => {
      expect(
        codes({
          ...base,
          creator: { isVerified: false },
          fundraiser: orgFundraiser,
          organization: { verificationStatus: "VERIFIED" },
        }),
      ).toEqual([]);
    });
  });

  it("reports every reason at once", () => {
    expect(
      codes({
        fundraiser: { status: "PAUSED", organizationId: undefined },
        creator: { isVerified: false },
        organization: null,
        hasActiveHold: true,
      }),
    ).toEqual(["ON_HOLD", "FUNDRAISER_STATUS", "OWNER_NOT_VERIFIED"]);
  });
});

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const user = (authUserId: string, role: Doc<"users">["role"], isVerified = false) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName: authUserId,
        role,
        isPrivate: false,
        isVerified,
        createdAt: now,
        updatedAt: now,
      });

    const owner = await user("auth_owner", "USER");
    const verifiedOwner = await user("auth_verified_owner", "USER", true);
    const moderator = await user("auth_mod", "MODERATOR");
    const admin = await user("auth_admin", "ADMIN");
    const stranger = await user("auth_stranger", "USER");

    const fundraiser = (creatorId: Id<"users">) =>
      ctx.db.insert("fundraisers", {
        creatorId,
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

    return {
      owner,
      verifiedOwner,
      moderator,
      admin,
      stranger,
      unverifiedFundraiser: await fundraiser(owner),
      verifiedFundraiser: await fundraiser(verifiedOwner),
    };
  });

  const as = (subject: string) => t.withIdentity({ subject });
  return {
    t,
    ids,
    asOwner: as("auth_owner"),
    asModerator: as("auth_mod"),
    asAdmin: as("auth_admin"),
    asStranger: as("auth_stranger"),
  };
}

const holds = (t: T) =>
  t.run((ctx) => ctx.db.query("fundraiserPayoutHolds").collect());
const auditEntries = (t: T) =>
  t.run((ctx) => ctx.db.query("adminAuditLog").collect());

// t.run turns undefined into null, so report a plain value when nothing throws.
const checkPayout = (t: T, fundraiserId: Id<"fundraisers">) =>
  t.run(async (ctx) => {
    await assertPayoutEligible(ctx, fundraiserId);
    return "allowed";
  });

describe("payout eligibility against the database", () => {
  it("blocks an unverified owner and allows a verified one", async () => {
    const { t, ids } = await setup();

    const blockedFor = (fundraiserId: Id<"fundraisers">) =>
      t.run(async (ctx) => {
        const fundraiser = await ctx.db.get(fundraiserId);
        return (await getPayoutBlockers(ctx, fundraiser!)).map((b) => b.code);
      });

    expect(await blockedFor(ids.unverifiedFundraiser)).toEqual([
      "OWNER_NOT_VERIFIED",
    ]);
    expect(await blockedFor(ids.verifiedFundraiser)).toEqual([]);
  });

  it("assertPayoutEligible explains why, and passes when there is nothing in the way", async () => {
    const { t, ids } = await setup();

    await expect(
      t.run((ctx) => assertPayoutEligible(ctx, ids.unverifiedFundraiser)),
    ).rejects.toThrow(/Payout blocked.*owner hasn't been verified/);
    expect(await checkPayout(t, ids.verifiedFundraiser)).toBe("allowed");
  });

  it("checks the organization's status for an organization's fundraiser", async () => {
    const { t, ids } = await setup();
    const now = Date.now();

    const { orgId, fundraiserId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Kajiado Youth Trust",
        slug: "kajiado-youth-trust",
        verificationStatus: "PENDING_REVIEW",
        createdBy: ids.owner,
        createdAt: now,
        updatedAt: now,
      });
      const fundraiserId = await ctx.db.insert("fundraisers", {
        creatorId: ids.owner,
        organizationId: orgId,
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
      return { orgId, fundraiserId };
    });

    await expect(
      t.run((ctx) => assertPayoutEligible(ctx, fundraiserId)),
    ).rejects.toThrow(/organization hasn't been verified/);

    await t.run((ctx) =>
      ctx.db.patch(orgId, { verificationStatus: "VERIFIED" }),
    );
    expect(await checkPayout(t, fundraiserId)).toBe("allowed");
  });

  it("assertPayoutEligible refuses a fundraiser that doesn't exist", async () => {
    const { t, ids } = await setup();
    await t.run((ctx) => ctx.db.delete(ids.verifiedFundraiser));
    await expect(
      t.run((ctx) => assertPayoutEligible(ctx, ids.verifiedFundraiser)),
    ).rejects.toThrow(/Fundraiser not found/);
  });
});

describe("placePayoutHold", () => {
  it("is for staff only", async () => {
    const { t, ids, asStranger } = await setup();

    await expect(
      t.mutation(api.admin.placePayoutHold, {
        fundraiserId: ids.verifiedFundraiser,
        reason: REASON,
      }),
    ).rejects.toThrow(/signed in/);
    await expect(
      asStranger.mutation(api.admin.placePayoutHold, {
        fundraiserId: ids.verifiedFundraiser,
        reason: REASON,
      }),
    ).rejects.toThrow(/permission/);
    expect(await holds(t)).toHaveLength(0);
  });

  it("lets a moderator hold payouts, records who and why, and logs it", async () => {
    const { t, ids, asModerator } = await setup();

    await asModerator.mutation(api.admin.placePayoutHold, {
      fundraiserId: ids.verifiedFundraiser,
      reason: REASON,
    });

    expect(await holds(t)).toMatchObject([
      {
        fundraiserId: ids.verifiedFundraiser,
        status: "ACTIVE",
        reason: REASON,
        placedBy: ids.moderator,
      },
    ]);
    expect(await auditEntries(t)).toMatchObject([
      {
        action: "PAYOUT_HOLD_PLACED",
        actorId: ids.moderator,
        fundraiserId: ids.verifiedFundraiser,
        note: REASON,
      },
    ]);
  });

  it("stops a verified owner's payout", async () => {
    const { t, ids, asModerator } = await setup();
    await asModerator.mutation(api.admin.placePayoutHold, {
      fundraiserId: ids.verifiedFundraiser,
      reason: REASON,
    });

    await expect(
      t.run((ctx) => assertPayoutEligible(ctx, ids.verifiedFundraiser)),
    ).rejects.toThrow(/on hold/);
  });

  it("needs a real reason", async () => {
    const { t, ids, asModerator } = await setup();
    for (const reason of ["", "   ", "too short"]) {
      await expect(
        asModerator.mutation(api.admin.placePayoutHold, {
          fundraiserId: ids.verifiedFundraiser,
          reason,
        }),
      ).rejects.toThrow(/at least 10 characters/);
    }
    expect(await holds(t)).toHaveLength(0);
  });

  it("refuses a second hold while one is in place", async () => {
    const { t, ids, asModerator } = await setup();
    const place = () =>
      asModerator.mutation(api.admin.placePayoutHold, {
        fundraiserId: ids.verifiedFundraiser,
        reason: REASON,
      });

    await place();
    await expect(place()).rejects.toThrow(/already on hold/);
    expect(await holds(t)).toHaveLength(1);
  });

  it("refuses a fundraiser that doesn't exist", async () => {
    const { t, ids, asModerator } = await setup();
    await t.run((ctx) => ctx.db.delete(ids.verifiedFundraiser));
    await expect(
      asModerator.mutation(api.admin.placePayoutHold, {
        fundraiserId: ids.verifiedFundraiser,
        reason: REASON,
      }),
    ).rejects.toThrow(/Fundraiser not found/);
  });
});

describe("releasePayoutHold", () => {
  const NOTE = "Checked with the beneficiary and the hospital; story confirmed.";

  async function setupWithHold() {
    const ctx = await setup();
    await ctx.asModerator.mutation(api.admin.placePayoutHold, {
      fundraiserId: ctx.ids.verifiedFundraiser,
      reason: REASON,
    });
    return ctx;
  }

  it("is for admins only: a moderator can't lift a hold", async () => {
    const { t, ids, asModerator, asStranger } = await setupWithHold();

    for (const who of [asModerator, asStranger]) {
      await expect(
        who.mutation(api.admin.releasePayoutHold, {
          fundraiserId: ids.verifiedFundraiser,
          note: NOTE,
        }),
      ).rejects.toThrow(/permission/);
    }
    expect((await holds(t))[0].status).toBe("ACTIVE");
  });

  it("lets an admin lift it, keeps the record, and logs it", async () => {
    const { t, ids, asAdmin } = await setupWithHold();

    await asAdmin.mutation(api.admin.releasePayoutHold, {
      fundraiserId: ids.verifiedFundraiser,
      note: NOTE,
    });

    expect(await holds(t)).toMatchObject([
      {
        status: "RELEASED",
        reason: REASON,
        placedBy: ids.moderator,
        releasedBy: ids.admin,
        releaseNote: NOTE,
      },
    ]);
    const log = await auditEntries(t);
    expect(log.map((e) => e.action)).toEqual([
      "PAYOUT_HOLD_PLACED",
      "PAYOUT_HOLD_RELEASED",
    ]);

    expect(await checkPayout(t, ids.verifiedFundraiser)).toBe("allowed");
  });

  it("needs a real note", async () => {
    const { ids, asAdmin } = await setupWithHold();
    await expect(
      asAdmin.mutation(api.admin.releasePayoutHold, {
        fundraiserId: ids.verifiedFundraiser,
        note: "ok",
      }),
    ).rejects.toThrow(/at least 10 characters/);
  });

  it("refuses when there is no hold", async () => {
    const { ids, asAdmin } = await setup();
    await expect(
      asAdmin.mutation(api.admin.releasePayoutHold, {
        fundraiserId: ids.verifiedFundraiser,
        note: NOTE,
      }),
    ).rejects.toThrow(/aren't on hold/);
  });

  it("allows a new hold after one was lifted, keeping both rows", async () => {
    const { t, ids, asAdmin, asModerator } = await setupWithHold();
    await asAdmin.mutation(api.admin.releasePayoutHold, {
      fundraiserId: ids.verifiedFundraiser,
      note: NOTE,
    });

    await asModerator.mutation(api.admin.placePayoutHold, {
      fundraiserId: ids.verifiedFundraiser,
      reason: "A second donor raised the same concern about this campaign.",
    });

    expect((await holds(t)).map((h) => h.status)).toEqual([
      "RELEASED",
      "ACTIVE",
    ]);
  });
});

describe("a hold stays out of sight of the fundraiser and the public", () => {
  it("isn't in what getFundraiserById returns", async () => {
    const { t, ids, asModerator, asOwner } = await setup();
    await asModerator.mutation(api.admin.placePayoutHold, {
      fundraiserId: ids.verifiedFundraiser,
      reason: REASON,
    });

    for (const who of [t, asOwner]) {
      const result = await who.query(api.fundraiser.getFundraiserById, {
        fundraiserId: ids.verifiedFundraiser,
      });
      expect(result).not.toBeNull();
      const json = JSON.stringify(result);
      expect(json).not.toContain(REASON);
      expect(json).not.toMatch(/hold/i);
    }
  });
});
