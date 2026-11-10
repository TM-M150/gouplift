/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PAYOUT_ACCOUNT_CHANGE_HOLD_MS } from "../lib/payout-accounts";
import { GENERIC_PAYOUT_BLOCKED_MESSAGE } from "./lib/payouts";
import {
  addFundraiser,
  addOrganizationFundraiser,
  approveLevel2,
  auditEntries,
  balanceOf,
  DAY_MS,
  figures,
  fund,
  insertPayout,
  payoutRow,
  seedPayoutWorld,
  type World,
} from "./payouts.fixtures";

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const REASON = "The account name doesn't match the fundraiser.";
const NOTE = "Checked the source of funds with the owner.";

/** A verified owner with KES 10,000 withdrawable, unless told otherwise. */
async function setup(net = 10_000): Promise<World> {
  const w = await seedPayoutWorld(convexTest(schema, modules));
  if (net > 0) await fund(w.t, w.ids.fundraiser, net);
  return w;
}

const request = (
  w: World,
  amount: number,
  fundraiserId: Id<"fundraisers"> = w.ids.fundraiser,
) => w.asOwner.mutation(api.payouts.requestPayout, { fundraiserId, amount });

const approve = (w: World, payoutId: Id<"payouts">, note?: string) =>
  w.asAdmin.mutation(api.payouts.approvePayout, { payoutId, note });

const reject = (w: World, payoutId: Id<"payouts">, reason = REASON) =>
  w.asAdmin.mutation(api.payouts.rejectPayout, { payoutId, reason });

const markPaid = (
  w: World,
  payoutId: Id<"payouts">,
  providerReference = "SLK1A2B3C4",
  transferFeeAmount?: number,
) =>
  w.asAdmin.mutation(api.payouts.markPayoutPaid, {
    payoutId,
    providerReference,
    transferFeeAmount,
  });

const overview = (w: World, fundraiserId = w.ids.fundraiser) =>
  w.asOwner.query(api.payouts.getMyPayoutOverview, { fundraiserId });

/** A request that staff have approved and are about to send. */
async function approved(w: World, amount: number) {
  const payoutId = await request(w, amount);
  await approve(w, payoutId);
  return payoutId;
}

const placeHold = (w: World) =>
  w.t.run((ctx) =>
    ctx.db.insert("fundraiserPayoutHolds", {
      fundraiserId: w.ids.fundraiser,
      status: "ACTIVE",
      reason: "Donor reported the story as copied.",
      placedBy: w.ids.admin,
      placedAt: Date.now(),
    }),
  );

describe("requestPayout", () => {
  it("asks for an amount and sets it aside", async () => {
    const w = await setup(10_000);

    const payoutId = await request(w, 4000);

    expect(await payoutRow(w.t, payoutId)).toMatchObject({
      fundraiserId: w.ids.fundraiser,
      ownerUserId: w.ids.owner,
      requestedBy: w.ids.owner,
      payoutAccountId: w.ids.payoutAccount,
      destination: "M-Pesa +254712345678",
      amount: 4000,
      status: "REQUESTED",
      needsEnhancedApproval: false,
    });
    expect(await figures(w.t, w.ids.fundraiser)).toEqual({
      settledNet: 10_000,
      pendingNet: 0,
      reserved: 4000,
      paid: 0,
    });
    expect((await overview(w))?.available).toBe(6000);
  });

  it("can take everything that is withdrawable", async () => {
    const w = await setup(2500.75);

    await request(w, 2500);

    expect((await overview(w))?.available).toBe(0);
  });

  it("is for signed-in owners of the fundraiser only", async () => {
    const w = await setup();
    const args = { fundraiserId: w.ids.fundraiser, amount: 1000 };

    await expect(w.t.mutation(api.payouts.requestPayout, args)).rejects.toThrow(
      /signed in/,
    );
    for (const other of [w.asStranger, w.asModerator, w.asAdmin]) {
      await expect(other.mutation(api.payouts.requestPayout, args)).rejects.toThrow(
        /can't withdraw from this fundraiser/,
      );
    }
    expect((await balanceOf(w.t, w.ids.fundraiser))?.reserved).toBe(0);
  });

  it("refuses amounts that aren't a whole payout", async () => {
    const w = await setup(5000);

    await expect(request(w, 249)).rejects.toThrow(/smallest payout is KES 250/);
    await expect(request(w, 0)).rejects.toThrow(/whole number/);
    await expect(request(w, -500)).rejects.toThrow(/whole number/);
    await expect(request(w, 500.5)).rejects.toThrow(/whole number/);
    await expect(request(w, Number.NaN)).rejects.toThrow(/whole number/);
    await expect(request(w, Number.POSITIVE_INFINITY)).rejects.toThrow(
      /whole number/,
    );
    await expect(request(w, 5001)).rejects.toThrow(/up to KES 5,000 right now/);
    expect((await balanceOf(w.t, w.ids.fundraiser))?.reserved).toBe(0);
  });

  it("says there is nothing to withdraw yet when there isn't enough", async () => {
    const w = await setup(0);
    await expect(request(w, 500)).rejects.toThrow(/isn't enough available/);

    // Money still inside a PayPal delay is not available.
    await fund(w.t, w.ids.fundraiser, 9000, { provider: "PAYPAL" });
    await expect(request(w, 500)).rejects.toThrow(/isn't enough available/);
    expect((await overview(w))?.pending).toBe(9000);
  });

  it("allows only one withdrawal at a time", async () => {
    const w = await setup(10_000);
    const first = await request(w, 1000);

    await expect(request(w, 1000)).rejects.toThrow(/already have a withdrawal/);
    await approve(w, first);
    await expect(request(w, 1000)).rejects.toThrow(/already have a withdrawal/);

    await markPaid(w, first);
    await expect(request(w, 1000)).resolves.toBeDefined();
  });

  it("never sets aside more than is available, even for two at once", async () => {
    const w = await setup(1000);

    const results = await Promise.allSettled([request(w, 800), request(w, 800)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balanceOf(w.t, w.ids.fundraiser))?.reserved).toBe(800);
  });

  describe("when the fundraiser can't be paid", () => {
    it("tells an unverified owner to verify", async () => {
      const w = await setup();
      await w.t.run((ctx) => ctx.db.delete(w.ids.kycId));

      await expect(request(w, 1000)).rejects.toThrow(
        "Verify your identity before you withdraw.",
      );
    });

    it("tells the owner about their own payout account", async () => {
      const w = await setup();
      await w.t.run((ctx) =>
        ctx.db.patch(w.ids.payoutAccount, { status: "PENDING_REVIEW" }),
      );
      await expect(request(w, 1000)).rejects.toThrow(/still being verified/);

      await w.t.run((ctx) => ctx.db.patch(w.ids.payoutAccount, { status: "VERIFIED" }));
      await w.t.run(async (ctx) => {
        const selection = await ctx.db.query("fundraiserPayoutAccounts").first();
        await ctx.db.patch(selection!._id, { changedAt: Date.now() });
      });
      await expect(request(w, 1000)).rejects.toThrow(/changed the payout account recently/);
    });

    it("tells nobody why when staff have a hold on it", async () => {
      const w = await setup();
      await placeHold(w);

      const error = await request(w, 1000).catch((e: Error) => e);

      expect((error as Error).message).toContain(GENERIC_PAYOUT_BLOCKED_MESSAGE);
      expect((error as Error).message).not.toMatch(/hold|staff|review|risk|due diligence/i);
    });

    it("tells nobody why when it hasn't been risk rated", async () => {
      const w = await setup();
      await w.t.run(async (ctx) => {
        for (const row of await ctx.db.query("customerRiskProfiles").collect()) {
          await ctx.db.delete(row._id);
        }
      });

      const error = await request(w, 1000).catch((e: Error) => e);

      expect((error as Error).message).toContain(GENERIC_PAYOUT_BLOCKED_MESSAGE);
      expect((error as Error).message).not.toMatch(/risk|rated|review/i);
    });

    it("refuses a fundraiser that isn't active, completed or ended", async () => {
      const w = await setup();
      await w.t.run((ctx) => ctx.db.patch(w.ids.fundraiser, { status: "PAUSED" }));

      await expect(request(w, 1000)).rejects.toThrow(/can't be paid out right now/);
    });

    it("pays out a completed or ended fundraiser", async () => {
      const w = await setup();
      for (const status of ["COMPLETED", "EXPIRED"] as const) {
        await w.t.run((ctx) => ctx.db.patch(w.ids.fundraiser, { status }));
        const payoutId = await request(w, 300);
        await w.asOwner.mutation(api.payouts.cancelPayoutRequest, { payoutId });
      }
    });

    it("sets nothing aside when it refuses", async () => {
      const w = await setup();
      await placeHold(w);

      await request(w, 1000).catch(() => {});

      expect((await balanceOf(w.t, w.ids.fundraiser))?.reserved).toBe(0);
      expect(await w.t.run((ctx) => ctx.db.query("payouts").collect())).toEqual([]);
    });
  });

  describe("the limit for the owner's verification level", () => {
    it("caps a Level 1 owner at KES 100,000 in total", async () => {
      const w = await setup(150_000);

      await expect(request(w, 100_001)).rejects.toThrow(
        /over your Level 1 limit.*up to KES 100,000 more/,
      );
      const payoutId = await request(w, 100_000);
      expect((await payoutRow(w.t, payoutId))?.needsEnhancedApproval).toBe(false);

      await w.asOwner.mutation(api.payouts.cancelPayoutRequest, { payoutId });
      // Taken back, so it no longer counts.
      await expect(request(w, 100_000)).resolves.toBeDefined();
    });

    it("counts what has been paid, and says when the limit is reached", async () => {
      const w = await setup(150_000);
      const first = await approved(w, 100_000);
      await markPaid(w, first);

      await expect(request(w, 1000)).rejects.toThrow(
        /reached the Level 1 payout limit of KES 100,000/,
      );
    });

    it("counts across all of the owner's fundraisers", async () => {
      const w = await setup(70_000);
      const second = await addFundraiser(w.t, w.ids.owner, w.ids.payoutAccount);
      await fund(w.t, second, 70_000);

      await request(w, 60_000);
      await expect(request(w, 50_000, second)).rejects.toThrow(
        /up to KES 40,000 more/,
      );
      await expect(request(w, 40_000, second)).resolves.toBeDefined();
    });

    it("doesn't count requests that were rejected, cancelled or failed", async () => {
      const w = await setup(150_000);
      const rejected = await request(w, 100_000);
      await reject(w, rejected);
      const failed = await approved(w, 100_000);
      await w.asAdmin.mutation(api.payouts.markPayoutFailed, {
        payoutId: failed,
        reason: "The M-Pesa number was not registered.",
      });

      await expect(request(w, 100_000)).resolves.toBeDefined();
    });

    it("lets a Level 2 owner withdraw up to KES 1,000,000", async () => {
      const w = await setup(1_500_000);
      await expect(request(w, 100_001)).rejects.toThrow(/Level 1 limit/);
      await approveLevel2(w.t, w.ids.owner);

      await expect(request(w, 1_000_001)).rejects.toThrow(
        /over your Level 2 limit.*up to KES 1,000,000 more/,
      );
      await expect(request(w, 1_000_000)).resolves.toBeDefined();
    });
  });

  describe("for an organization's fundraiser", () => {
    it("lets the organization's owner withdraw, with no personal limit", async () => {
      const w = await setup(0);
      const org = await addOrganizationFundraiser(w.t, w.ids);
      await fund(w.t, org.fundraiserId, 2_000_000);

      const payoutId = await request(w, 1_500_000, org.fundraiserId);

      expect(await payoutRow(w.t, payoutId)).toMatchObject({
        organizationId: org.organizationId,
        amount: 1_500_000,
        needsEnhancedApproval: false,
      });
      expect((await overview(w, org.fundraiserId))?.limitRemaining).toBeNull();
    });

    it("doesn't count the organization's payouts against the owner's own limit", async () => {
      const w = await setup(150_000);
      const org = await addOrganizationFundraiser(w.t, w.ids);
      await fund(w.t, org.fundraiserId, 500_000);

      await request(w, 400_000, org.fundraiserId);

      expect((await overview(w))?.limitRemaining).toBe(100_000);
      await expect(request(w, 100_000)).resolves.toBeDefined();
    });

    it("hides the full account number from the owner", async () => {
      const w = await setup(0);
      const org = await addOrganizationFundraiser(w.t, w.ids);
      await fund(w.t, org.fundraiserId, 5000);

      const payoutId = await request(w, 1000, org.fundraiserId);

      const mine = (await overview(w, org.fundraiserId))?.payouts[0];
      expect(mine?.destination).toContain("Equity Bank");
      expect(mine?.destination).toContain("9012");
      expect(mine?.destination).not.toContain("0123456789012");
      // Staff see the whole number, because they send the money to it.
      const staff = await w.asAdmin.query(api.payouts.getPayoutForStaff, { payoutId });
      expect(staff?.account?.bankAccountNumber).toBe("0123456789012");
    });

    it("lets another owner of the organization act, and records who", async () => {
      const w = await setup(0);
      const org = await addOrganizationFundraiser(w.t, w.ids);
      await fund(w.t, org.fundraiserId, 5000);
      await w.t.run((ctx) =>
        ctx.db.insert("organizationMembers", {
          organizationId: org.organizationId,
          userId: w.ids.stranger,
          role: "OWNER",
          joinedAt: Date.now(),
        }),
      );

      const payoutId = await w.asStranger.mutation(api.payouts.requestPayout, {
        fundraiserId: org.fundraiserId,
        amount: 1000,
      });

      expect(await payoutRow(w.t, payoutId)).toMatchObject({
        requestedBy: w.ids.stranger,
        ownerUserId: w.ids.owner,
      });
    });

    it("refuses someone who isn't an owner of the organization, even the creator", async () => {
      const w = await setup(0);
      const org = await addOrganizationFundraiser(w.t, w.ids, { role: "MEMBER" });
      await fund(w.t, org.fundraiserId, 5000);

      await expect(request(w, 1000, org.fundraiserId)).rejects.toThrow(
        /can't withdraw from this fundraiser/,
      );
      await expect(
        w.asStranger.mutation(api.payouts.requestPayout, {
          fundraiserId: org.fundraiserId,
          amount: 1000,
        }),
      ).rejects.toThrow(/can't withdraw from this fundraiser/);
      expect(await overview(w, org.fundraiserId)).toBeNull();
    });

    it("needs the organization to be verified", async () => {
      const w = await setup(0);
      const org = await addOrganizationFundraiser(w.t, w.ids);
      await fund(w.t, org.fundraiserId, 5000);
      await w.t.run((ctx) =>
        ctx.db.patch(org.organizationId, { verificationStatus: "PENDING_REVIEW" }),
      );

      await expect(request(w, 1000, org.fundraiserId)).rejects.toThrow(
        /organization has to be verified/,
      );
    });
  });
});

describe("cancelPayoutRequest", () => {
  it("takes the request back and frees the money", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    await w.asOwner.mutation(api.payouts.cancelPayoutRequest, { payoutId });

    expect(await payoutRow(w.t, payoutId)).toMatchObject({ status: "CANCELLED" });
    expect((await payoutRow(w.t, payoutId))?.cancelledAt).toBeGreaterThan(0);
    expect((await figures(w.t, w.ids.fundraiser)).reserved).toBe(0);
    expect((await overview(w))?.available).toBe(10_000);
    await expect(request(w, 10_000)).resolves.toBeDefined();
  });

  it("can't take back what staff have approved, or cancel twice", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await expect(
      w.asOwner.mutation(api.payouts.cancelPayoutRequest, { payoutId }),
    ).rejects.toThrow(/still waiting for review/);

    const other = await insertPayout(w.t, w, { amount: 500, status: "CANCELLED" });
    await expect(
      w.asOwner.mutation(api.payouts.cancelPayoutRequest, { payoutId: other }),
    ).rejects.toThrow(/still waiting for review/);
    expect((await figures(w.t, w.ids.fundraiser)).reserved).toBe(4000);
  });

  it("is for the owner only", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    for (const other of [w.asStranger, w.asModerator, w.asAdmin]) {
      await expect(
        other.mutation(api.payouts.cancelPayoutRequest, { payoutId }),
      ).rejects.toThrow(/Withdrawal not found/);
    }
    await expect(
      w.t.mutation(api.payouts.cancelPayoutRequest, { payoutId }),
    ).rejects.toThrow(/signed in/);
    expect((await payoutRow(w.t, payoutId))?.status).toBe("REQUESTED");
  });
});

describe("approvePayout", () => {
  it("approves a request and keeps the money set aside", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    await approve(w, payoutId, "  Checked.  ");

    expect(await payoutRow(w.t, payoutId)).toMatchObject({
      status: "APPROVED",
      approvedBy: w.ids.admin,
      approvalNote: "Checked.",
    });
    expect((await figures(w.t, w.ids.fundraiser)).reserved).toBe(4000);
    expect(await auditEntries(w.t)).toEqual([
      expect.objectContaining({
        actorId: w.ids.admin,
        action: "PAYOUT_APPROVED",
        payoutId,
        fundraiserId: w.ids.fundraiser,
        payoutAccountId: w.ids.payoutAccount,
        statusBefore: "REQUESTED",
        statusAfter: "APPROVED",
      }),
    ]);
  });

  it("is for admins only", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    for (const other of [w.asOwner, w.asModerator, w.asStranger]) {
      await expect(
        other.mutation(api.payouts.approvePayout, { payoutId }),
      ).rejects.toThrow(/don't have permission/);
    }
    await expect(
      w.t.mutation(api.payouts.approvePayout, { payoutId }),
    ).rejects.toThrow(/don't have permission/);
    expect((await payoutRow(w.t, payoutId))?.status).toBe("REQUESTED");
    expect(await auditEntries(w.t)).toEqual([]);
  });

  it("won't let an admin approve a payout to themselves", async () => {
    const w = await setup(10_000);
    await w.t.run((ctx) => ctx.db.patch(w.ids.owner, { role: "ADMIN" }));
    const payoutId = await request(w, 4000);

    await expect(
      w.asOwner.mutation(api.payouts.approvePayout, { payoutId }),
    ).rejects.toThrow(/can't approve a payout to yourself/);
    await expect(
      w.asAdmin2.mutation(api.payouts.approvePayout, { payoutId }),
    ).resolves.toBeNull();
  });

  it("only approves a payout that is waiting for review", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await expect(approve(w, payoutId)).rejects.toThrow(/waiting for review/);
    const rejected = await insertPayout(w.t, w, { amount: 300, status: "REJECTED" });
    await expect(approve(w, rejected)).rejects.toThrow(/waiting for review/);
  });

  it("checks the owner and account are still eligible today", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);
    await placeHold(w);

    await expect(approve(w, payoutId)).rejects.toThrow(
      /Payout blocked: Payouts are on hold/,
    );
    expect((await payoutRow(w.t, payoutId))?.status).toBe("REQUESTED");
    expect(await auditEntries(w.t)).toEqual([]);
  });

  it("refuses when the payout account was changed after the request", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);
    await w.t.run(async (ctx) => {
      const other = await ctx.db.insert("payoutAccounts", {
        userId: w.ids.owner,
        method: "MPESA",
        holder: "OWN",
        accountName: "Verified Owner",
        mpesaNumber: "+254722222222",
        status: "VERIFIED",
        verifiedVia: "STAFF_REVIEW",
        createdAt: Date.now(),
      });
      const selection = await ctx.db.query("fundraiserPayoutAccounts").first();
      // Long enough ago that the change hold is over.
      await ctx.db.patch(selection!._id, {
        payoutAccountId: other,
        changedAt: Date.now() - 10 * DAY_MS,
      });
    });

    await expect(approve(w, payoutId)).rejects.toThrow(
      /payout account has changed since this was requested/,
    );
    expect((await payoutRow(w.t, payoutId))?.status).toBe("REQUESTED");
  });

  describe("above the Level 2 limit", () => {
    // No one can reach Level 3 yet, so these set the flag a Level 3 owner's
    // request would carry.
    async function enhanced() {
      const w = await setup(10_000);
      const payoutId = await request(w, 4000);
      await w.t.run((ctx) => ctx.db.patch(payoutId, { needsEnhancedApproval: true }));
      return { w, payoutId };
    }

    it("needs a recorded reason from the MLRO", async () => {
      const { w, payoutId } = await enhanced();

      await expect(approve(w, payoutId)).rejects.toThrow(/Record the reason/);
      await expect(approve(w, payoutId, "ok")).rejects.toThrow(/Record the reason/);
      expect((await payoutRow(w.t, payoutId))?.status).toBe("REQUESTED");

      await approve(w, payoutId, NOTE);
      expect(await payoutRow(w.t, payoutId)).toMatchObject({
        status: "APPROVED",
        approvalNote: NOTE,
      });
    });

    it("isn't needed below it", async () => {
      const w = await setup(10_000);
      const payoutId = await request(w, 4000);

      await expect(approve(w, payoutId)).resolves.toBeNull();
    });
  });

  it("keeps notes to a sensible length", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    await expect(approve(w, payoutId, "x".repeat(1001))).rejects.toThrow(
      /under 1000 characters/,
    );
  });
});

describe("rejectPayout", () => {
  it("declines a request and frees the money", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    await reject(w, payoutId);

    expect(await payoutRow(w.t, payoutId)).toMatchObject({
      status: "REJECTED",
      rejectedBy: w.ids.admin,
      rejectionReason: REASON,
    });
    expect((await figures(w.t, w.ids.fundraiser)).reserved).toBe(0);
    expect(await auditEntries(w.t)).toEqual([
      expect.objectContaining({
        action: "PAYOUT_REJECTED",
        payoutId,
        statusBefore: "REQUESTED",
        statusAfter: "REJECTED",
        note: REASON,
      }),
    ]);
  });

  it("can stop one that was approved but not yet sent", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await reject(w, payoutId);

    expect((await payoutRow(w.t, payoutId))?.status).toBe("REJECTED");
    expect((await figures(w.t, w.ids.fundraiser)).reserved).toBe(0);
    expect((await auditEntries(w.t))[1]).toMatchObject({ statusBefore: "APPROVED" });
  });

  it("needs a real reason", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    await expect(reject(w, payoutId, "no")).rejects.toThrow(/reason of at least 10/);
    await expect(reject(w, payoutId, "          ")).rejects.toThrow(
      /reason of at least 10/,
    );
    expect((await payoutRow(w.t, payoutId))?.status).toBe("REQUESTED");
  });

  it("can't undo a payout that was already sent", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);
    await markPaid(w, payoutId);

    await expect(reject(w, payoutId)).rejects.toThrow(/can't be rejected/);
    expect((await figures(w.t, w.ids.fundraiser)).paid).toBe(4000);
  });

  it("is for admins only", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    for (const other of [w.asOwner, w.asModerator, w.asStranger]) {
      await expect(
        other.mutation(api.payouts.rejectPayout, { payoutId, reason: REASON }),
      ).rejects.toThrow(/don't have permission/);
    }
  });

  it("shows the owner the reason, and nothing else staff wrote", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);
    await reject(w, payoutId, "The account name doesn't match yours.");

    const view = (await overview(w))?.payouts[0];

    expect(view).toMatchObject({
      status: "REJECTED",
      rejectionReason: "The account name doesn't match yours.",
    });
    expect(Object.keys(view ?? {})).not.toEqual(
      expect.arrayContaining(["approvedBy", "approvalNote", "failureReason"]),
    );
  });
});

describe("markPayoutPaid", () => {
  it("records the transfer and moves the money from set aside to paid", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await markPaid(w, payoutId, "  slk1a2b3c4 ", 33);

    expect(await payoutRow(w.t, payoutId)).toMatchObject({
      status: "PAID",
      paidBy: w.ids.admin,
      providerReference: "SLK1A2B3C4",
      transferFeeAmount: 33,
    });
    expect(await figures(w.t, w.ids.fundraiser)).toEqual({
      settledNet: 10_000,
      pendingNet: 0,
      reserved: 0,
      paid: 4000,
    });
    expect((await overview(w))?.available).toBe(6000);
    expect((await auditEntries(w.t)).at(-1)).toMatchObject({
      action: "PAYOUT_PAID",
      payoutId,
      statusBefore: "APPROVED",
      statusAfter: "PAID",
    });
  });

  it("shows the owner what reached them after the transfer charge", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);
    await markPaid(w, payoutId, "SLK1A2B3C4", 33);

    const view = (await overview(w))?.payouts[0];

    expect(view).toMatchObject({
      status: "PAID",
      amount: 4000,
      transferFeeAmount: 33,
      received: 3967,
      providerReference: "SLK1A2B3C4",
    });
  });

  it("treats no transfer charge as zero", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await markPaid(w, payoutId);

    expect(await payoutRow(w.t, payoutId)).toMatchObject({ transferFeeAmount: 0 });
    expect((await overview(w))?.payouts[0].received).toBe(4000);
  });

  it("only records a payout that staff have approved", async () => {
    const w = await setup(10_000);
    const payoutId = await request(w, 4000);

    await expect(markPaid(w, payoutId)).rejects.toThrow(/approved payout/);
    expect((await figures(w.t, w.ids.fundraiser)).paid).toBe(0);

    await approve(w, payoutId);
    await markPaid(w, payoutId);
    await expect(markPaid(w, payoutId, "ANOTHER123")).rejects.toThrow(/approved payout/);
    expect((await figures(w.t, w.ids.fundraiser)).paid).toBe(4000);
  });

  it("records a reference once, however it is typed", async () => {
    const w = await setup(10_000);
    const first = await approved(w, 4000);
    await markPaid(w, first, "SLK1A2B3C4");
    const second = await approved(w, 3000);

    await expect(markPaid(w, second, "slk1a2b3c4")).rejects.toThrow(
      /already recorded against another payout/,
    );
    expect((await payoutRow(w.t, second))?.status).toBe("APPROVED");
    expect((await figures(w.t, w.ids.fundraiser)).paid).toBe(4000);

    await markPaid(w, second, "SLK9Z8Y7X6");
    expect((await figures(w.t, w.ids.fundraiser)).paid).toBe(7000);
  });

  it("needs a reference of a believable length", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await expect(markPaid(w, payoutId, "  ab  ")).rejects.toThrow(/3 to 100 characters/);
    await expect(markPaid(w, payoutId, "")).rejects.toThrow(/3 to 100 characters/);
    await expect(markPaid(w, payoutId, "X".repeat(101))).rejects.toThrow(
      /3 to 100 characters/,
    );
  });

  it("refuses a transfer charge that can't be right", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    for (const fee of [-1, 4000, 4001, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(markPaid(w, payoutId, "SLK1A2B3C4", fee)).rejects.toThrow(
        /transfer charge has to be zero or more, and less than the payout/,
      );
    }
    expect((await payoutRow(w.t, payoutId))?.status).toBe("APPROVED");
    await expect(markPaid(w, payoutId, "SLK1A2B3C4", 3999)).resolves.toBeNull();
  });

  it("still records a transfer that was sent, even if a hold went on since", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);
    await placeHold(w);

    await expect(markPaid(w, payoutId)).resolves.toBeNull();
    expect((await payoutRow(w.t, payoutId))?.status).toBe("PAID");
  });

  it("is for admins only", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    for (const other of [w.asOwner, w.asModerator, w.asStranger]) {
      await expect(
        other.mutation(api.payouts.markPayoutPaid, {
          payoutId,
          providerReference: "SLK1A2B3C4",
        }),
      ).rejects.toThrow(/don't have permission/);
    }
  });
});

describe("markPayoutFailed", () => {
  const FAILURE = "The M-Pesa number was not registered.";

  it("puts the money back and keeps the reason for staff only", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    await w.asAdmin.mutation(api.payouts.markPayoutFailed, {
      payoutId,
      reason: FAILURE,
    });

    expect(await payoutRow(w.t, payoutId)).toMatchObject({
      status: "FAILED",
      failedBy: w.ids.admin,
      failureReason: FAILURE,
    });
    expect(await figures(w.t, w.ids.fundraiser)).toMatchObject({
      reserved: 0,
      paid: 0,
    });
    expect((await auditEntries(w.t)).at(-1)).toMatchObject({
      action: "PAYOUT_FAILED",
      statusBefore: "APPROVED",
      statusAfter: "FAILED",
      note: FAILURE,
    });

    const view = (await overview(w))?.payouts[0];
    expect(view?.status).toBe("FAILED");
    expect(JSON.stringify(view)).not.toContain(FAILURE);
    await expect(request(w, 10_000)).resolves.toBeDefined();
  });

  it("only applies to an approved payout, with a reason", async () => {
    const w = await setup(10_000);
    const waiting = await request(w, 4000);

    await expect(
      w.asAdmin.mutation(api.payouts.markPayoutFailed, {
        payoutId: waiting,
        reason: FAILURE,
      }),
    ).rejects.toThrow(/approved payout/);

    await approve(w, waiting);
    await expect(
      w.asAdmin.mutation(api.payouts.markPayoutFailed, {
        payoutId: waiting,
        reason: "no",
      }),
    ).rejects.toThrow(/reason of at least 10/);
    expect((await figures(w.t, w.ids.fundraiser)).reserved).toBe(4000);
  });

  it("is for admins only", async () => {
    const w = await setup(10_000);
    const payoutId = await approved(w, 4000);

    for (const other of [w.asOwner, w.asModerator, w.asStranger]) {
      await expect(
        other.mutation(api.payouts.markPayoutFailed, { payoutId, reason: FAILURE }),
      ).rejects.toThrow(/don't have permission/);
    }
  });
});

describe("getMyPayoutOverview", () => {
  it("is for the owner only", async () => {
    const w = await setup();

    expect(await w.t.query(api.payouts.getMyPayoutOverview, { fundraiserId: w.ids.fundraiser })).toBeNull();
    for (const other of [w.asStranger, w.asModerator, w.asAdmin]) {
      expect(
        await other.query(api.payouts.getMyPayoutOverview, {
          fundraiserId: w.ids.fundraiser,
        }),
      ).toBeNull();
    }
  });

  it("shows zero for a fundraiser that has raised nothing", async () => {
    const w = await setup(0);

    expect(await overview(w)).toMatchObject({
      available: 0,
      pending: 0,
      reserved: 0,
      paid: 0,
      minPayout: 250,
      limitRemaining: 100_000,
      blockedReason: null,
      heldUntil: null,
      hasOpenRequest: false,
      payouts: [],
    });
  });

  it("separates what can be withdrawn from what is waiting, set aside and paid", async () => {
    const w = await setup(0);
    await fund(w.t, w.ids.fundraiser, 5000.75);
    await fund(w.t, w.ids.fundraiser, 1200, { provider: "PAYPAL" });
    const first = await approved(w, 1000);
    await markPaid(w, first);
    await request(w, 2000);

    expect(await overview(w)).toMatchObject({
      // 5,000.75 less 1,000 paid and 2,000 set aside, in whole shillings.
      available: 2000,
      pending: 1200,
      reserved: 2000,
      paid: 1000,
      hasOpenRequest: true,
      // 100,000 less the 1,000 paid and the 2,000 asked for.
      limitRemaining: 97_000,
    });
  });

  it("explains what the owner can do about a block, and nothing about a hold", async () => {
    const w = await setup();
    expect((await overview(w))?.blockedReason).toBeNull();

    await placeHold(w);
    expect((await overview(w))?.blockedReason).toBe(GENERIC_PAYOUT_BLOCKED_MESSAGE);
  });

  it("says when the pause after changing the payout account ends", async () => {
    const w = await setup();
    const changedAt = Date.now();
    await w.t.run(async (ctx) => {
      const selection = await ctx.db.query("fundraiserPayoutAccounts").first();
      await ctx.db.patch(selection!._id, { changedAt });
    });

    const result = await overview(w);

    // A query can't read the clock, so the pause is returned as a time for the
    // screen to compare; asking for a payout is refused for it (tested above).
    expect(result?.heldUntil).toBe(changedAt + PAYOUT_ACCOUNT_CHANGE_HOLD_MS);
    expect(result?.blockedReason).toBeNull();
  });

  it("lists the latest payouts newest first", async () => {
    const w = await setup(0);
    for (let i = 0; i < 25; i++) {
      await insertPayout(w.t, w, {
        amount: 300 + i,
        status: "PAID",
        requestedAt: Date.now() + i * 1000,
      });
    }

    const { payouts } = (await overview(w))!;

    expect(payouts).toHaveLength(20);
    expect(payouts[0].amount).toBe(324);
    expect(payouts[19].amount).toBe(305);
  });
});

describe("the staff queue", () => {
  it("shows the queue to admins and nobody else", async () => {
    const w = await setup();
    await request(w, 1000);

    const asked = { status: "REQUESTED" as const };
    expect(await w.asAdmin.query(api.payouts.listPayoutsForStaff, asked)).toHaveLength(1);
    expect(await w.asAdmin2.query(api.payouts.listPayoutsForStaff, asked)).toHaveLength(1);
    for (const other of [w.t, w.asModerator, w.asOwner, w.asStranger]) {
      expect(await other.query(api.payouts.listPayoutsForStaff, asked)).toEqual([]);
    }
  });

  it("puts waiting payouts oldest first and finished ones newest first", async () => {
    const w = await setup(0);
    const other = await addFundraiser(w.t, w.ids.owner, w.ids.payoutAccount);
    const at = (days: number) => Date.now() + days * DAY_MS;
    const late = await insertPayout(w.t, w, { amount: 400, status: "REQUESTED", requestedAt: at(2) });
    const early = await insertPayout(w.t, w, {
      fundraiserId: other,
      amount: 300,
      status: "REQUESTED",
      requestedAt: at(1),
    });
    const paidA = await insertPayout(w.t, w, { amount: 500, status: "PAID", requestedAt: at(1) });
    const paidB = await insertPayout(w.t, w, { amount: 600, status: "PAID", requestedAt: at(2) });

    const ids = async (status: "REQUESTED" | "PAID") =>
      (await w.asAdmin.query(api.payouts.listPayoutsForStaff, { status })).map(
        (row) => row._id,
      );

    expect(await ids("REQUESTED")).toEqual([early, late]);
    expect(await ids("PAID")).toEqual([paidB, paidA]);
  });

  it("summarizes each payout", async () => {
    const w = await setup();
    const payoutId = await request(w, 1000);

    const [row] = await w.asAdmin.query(api.payouts.listPayoutsForStaff, {
      status: "REQUESTED",
    });

    expect(row).toMatchObject({
      _id: payoutId,
      fundraiserTitle: "Water for Kajiado",
      ownerName: "auth_owner",
      isOrganization: false,
      amount: 1000,
      destination: "M-Pesa +254712345678",
      status: "REQUESTED",
      needsEnhancedApproval: false,
      approvedAt: null,
      paidAt: null,
    });
  });

  describe("getPayoutForStaff", () => {
    it("shows everything needed to decide and to send the money", async () => {
      const w = await setup(10_000);
      const first = await approved(w, 2000);
      await markPaid(w, first);
      const payoutId = await request(w, 3000);

      const detail = await w.asAdmin.query(api.payouts.getPayoutForStaff, { payoutId });

      expect(detail).toMatchObject({
        amount: 3000,
        ownerTier: 1,
        ownerLimit: 100_000,
        // Paid plus asked for.
        ownerCommitted: 5000,
        account: {
          method: "MPESA",
          holder: "OWN",
          accountName: "Verified Owner",
          mpesaNumber: "+254712345678",
          status: "VERIFIED",
        },
        accountChanged: false,
        blockers: [],
        balance: { available: 5000, pending: 0, reserved: 3000, paid: 2000 },
        requestedBy: w.ids.owner,
      });
    });

    it("shows a hold and a changed account to staff, who are allowed to know", async () => {
      const w = await setup(10_000);
      const payoutId = await request(w, 3000);
      await placeHold(w);
      await w.t.run(async (ctx) => {
        const other = await ctx.db.insert("payoutAccounts", {
          userId: w.ids.owner,
          method: "MPESA",
          holder: "OWN",
          accountName: "Verified Owner",
          mpesaNumber: "+254733333333",
          status: "VERIFIED",
          verifiedVia: "STAFF_REVIEW",
          createdAt: Date.now(),
        });
        const selection = await ctx.db.query("fundraiserPayoutAccounts").first();
        await ctx.db.patch(selection!._id, { payoutAccountId: other });
      });

      const detail = await w.asAdmin.query(api.payouts.getPayoutForStaff, { payoutId });

      expect(detail?.accountChanged).toBe(true);
      expect(detail?.blockers.map((b) => b.code)).toContain("ON_HOLD");
    });

    it("shows what staff recorded once it is decided", async () => {
      const w = await setup(10_000);
      const payoutId = await approved(w, 3000);
      await markPaid(w, payoutId, "SLK1A2B3C4", 28);

      const detail = await w.asAdmin.query(api.payouts.getPayoutForStaff, { payoutId });

      expect(detail).toMatchObject({
        status: "PAID",
        providerReference: "SLK1A2B3C4",
        transferFeeAmount: 28,
      });
    });

    it("is for admins only", async () => {
      const w = await setup(10_000);
      const payoutId = await request(w, 3000);

      for (const other of [w.t, w.asModerator, w.asOwner, w.asStranger]) {
        expect(
          await other.query(api.payouts.getPayoutForStaff, { payoutId }),
        ).toBeNull();
      }
    });
  });
});

describe("the admin dashboard's figure for money owed", () => {
  it("counts what fundraisers could withdraw, not what is set aside or still waiting", async () => {
    const w = await setup(1000);
    const second = await addFundraiser(w.t, w.ids.owner, w.ids.payoutAccount);
    await fund(w.t, second, 500, { provider: "PAYPAL" });
    await request(w, 300);

    const totals = await w.asAdmin.query(api.admin.getPlatformTotals, {});

    // Only the first fundraiser has anything withdrawable: 1,000 less the 300
    // set aside. The PayPal money is still inside its delay.
    expect(totals.pendingPayouts).toEqual({ count: 1, capped: false, netOwed: 700 });
  });

  it("falls as payouts are paid", async () => {
    const w = await setup(1000);
    const payoutId = await approved(w, 1000);
    await markPaid(w, payoutId);

    const totals = await w.asAdmin.query(api.admin.getPlatformTotals, {});

    expect(totals.pendingPayouts).toEqual({ count: 0, capped: false, netOwed: 0 });
  });
});
