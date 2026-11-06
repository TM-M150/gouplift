/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { KycDocumentType } from "../lib/kyc";
import { getPayoutBlockers } from "./lib/payoutEligibility";
import { insertRiskProfile } from "./risk.fixtures";

// Risk rating, PEP screening and enhanced due diligence for individual
// fundraisers (AML policy 4.3, 7, 8): how an approval rates the applicant, who
// is allowed to approve whom, what the MLRO can change afterwards, and what the
// rating does to payouts.

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

const DAY = 24 * 60 * 60 * 1000;

const BASE = {
  legalName: "Wanjiru Kamau",
  idType: "NATIONAL_ID" as const,
  idNumber: "12345678",
  phoneNumber: "0712 345 678",
  campaignPurpose: "School fees for my daughter's final year.",
  residenceCountry: "KE",
  expectedAmountKes: 50_000,
  expectedTimeline: "ONE_TO_3_MONTHS" as const,
  pepDeclared: false,
  pepDetails: undefined as string | undefined,
  prohibitedActivitiesAcknowledged: true,
};

const TIER_1_CHECKS = [
  "IDENTITY_MATCHES",
  "PHONE_IN_OWN_NAME",
  "PEP_SCREENED",
  "PURPOSE_NOT_PROHIBITED",
] as const;
const TIER_2_CHECKS = [
  "EVIDENCE_SUPPORTS_CAMPAIGN",
  "KRA_PIN_VALID",
  "PAYOUT_ACCOUNT_OWNERSHIP",
] as const;
const CLEAN: {
  confirmedChecks: Array<(typeof TIER_1_CHECKS)[number]>;
  pepOutcome: "NOT_PEP";
  behaviour: "LOW";
} = {
  confirmedChecks: [...TIER_1_CHECKS],
  pepOutcome: "NOT_PEP",
  behaviour: "LOW",
};

const FUNDS = "Salary and savings, confirmed against bank statements.";
const WEALTH = "Farm income and a family business, confirmed with the KRA PIN.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
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
    return {
      alice: await user("auth_alice", "USER"),
      bob: await user("auth_bob", "USER"),
      mod: await user("auth_mod", "MODERATOR"),
      admin: await user("auth_admin", "ADMIN"), // the MLRO
    };
  });
  const as = (subject: string) => t.withIdentity({ subject });
  return {
    t,
    ids,
    asAlice: as("auth_alice"),
    asBob: as("auth_bob"),
    asMod: as("auth_mod"),
    asAdmin: as("auth_admin"),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type Who = Setup["asAlice"];

async function docs(t: T, userId: Id<"users">, types: KycDocumentType[]) {
  return await Promise.all(
    types.map(async (documentType) => ({
      documentType,
      storageId: await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(1024)], { type: "application/pdf" }),
        );
        await ctx.db.insert("pendingUploads", { storageId, userId });
        return storageId;
      }),
      fileName: `${documentType.toLowerCase()}.pdf`,
    })),
  );
}

async function submit(
  s: Setup,
  who: Who,
  userId: Id<"users">,
  overrides: Partial<typeof BASE> = {},
) {
  const { submissionId } = await who.mutation(api.kyc.submitKycTier1, {
    ...BASE,
    ...overrides,
    documents: await docs(s.t, userId, ["ID_FRONT", "ID_BACK"]),
  });
  return submissionId;
}

const profiles = (t: T) =>
  t.run((ctx) => ctx.db.query("customerRiskProfiles").collect());
const submissionRow = (t: T, id: Id<"kycSubmissions">) =>
  t.run((ctx) => ctx.db.get(id));
const audit = (t: T, action: Doc<"adminAuditLog">["action"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("adminAuditLog").collect()).filter(
      (e) => e.action === action,
    ),
  );

/** Approves a Level 1 the way the MLRO would, with the enhanced due diligence record. */
function approveAsMlro(
  s: Setup,
  submissionId: Id<"kycSubmissions">,
  extra: Partial<{
    pepOutcome: "NOT_PEP" | "PEP";
    behaviour: "LOW" | "MEDIUM" | "HIGH";
    edd: { sourceOfFunds: string; sourceOfWealth?: string; note?: string };
  }> = {},
) {
  return s.asAdmin.mutation(api.kycReview.approveKyc, {
    ...CLEAN,
    edd: { sourceOfFunds: FUNDS },
    ...extra,
    submissionId,
  });
}

/** A Level 1 approved before risk was rated, so with no profile and no declarations. */
function legacyApproved(s: Setup, userId: Id<"users">) {
  return s.t.run((ctx) =>
    ctx.db.insert("kycSubmissions", {
      userId,
      requestedTier: 1,
      status: "APPROVED",
      legalName: "Wanjiru Kamau",
      idType: "NATIONAL_ID",
      idNumber: "12345678",
      phoneNumber: "+254712345678",
      submittedAt: Date.now(),
    }),
  );
}

describe("approving Level 1 rates the applicant", () => {
  it("rates an ordinary Kenyan Low and keeps what the rating came from", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);

    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      ...CLEAN,
    });

    const [profile] = await profiles(s.t);
    expect(profile).toMatchObject({
      userId: s.ids.alice,
      kycSubmissionId: submissionId,
      residenceCountry: "KE",
      expectedAmountKes: 50_000,
      pepOutcome: "NOT_PEP",
      behaviour: "LOW",
      mlroFlagged: false,
      rating: "LOW",
      computedRating: "LOW",
      eddReasons: [],
      ratedBy: s.ids.mod,
      factors: {
        customerType: "LOW",
        expectedValue: "LOW",
        geography: "LOW",
        behaviour: "LOW",
      },
    });
    expect(profile.nextReviewDue).toBe(profile.ratedAt + 1095 * DAY);
    expect(profile.eddCompletedAt).toBeUndefined();
    expect(profile.sourceOfFunds).toBeUndefined();
  });

  it("makes the reviewer record the screening result and what they saw", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    const confirmedChecks = [...TIER_1_CHECKS];

    for (const missing of [
      {},
      { pepOutcome: "NOT_PEP" as const },
      { behaviour: "LOW" as const },
    ]) {
      await expect(
        s.asMod.mutation(api.kycReview.approveKyc, {
          submissionId,
          confirmedChecks,
          ...missing,
        }),
      ).rejects.toThrow(/PEP screening result/);
    }
    expect((await submissionRow(s.t, submissionId))?.status).toBe(
      "PENDING_REVIEW",
    );
    expect(await profiles(s.t)).toHaveLength(0);
  });

  it("won't approve without the PEP screening and prohibited-purpose checks", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        ...CLEAN,
        submissionId,
        confirmedChecks: ["IDENTITY_MATCHES", "PHONE_IN_OWN_NAME"],
      }),
    ).rejects.toThrow(/PEP lists[\s\S]*prohibited activity/);
  });

  it("rates on the reviewer's view of behaviour: Medium is theirs to give", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      ...CLEAN,
      behaviour: "MEDIUM",
    });
    const [profile] = await profiles(s.t);
    expect(profile).toMatchObject({ rating: "MEDIUM", eddReasons: [] });
    expect(profile.nextReviewDue).toBe(profile.ratedAt + 730 * DAY);
  });

  it("leaves High risk behaviour to the MLRO, and saves nothing for the moderator", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);

    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        ...CLEAN,
        behaviour: "HIGH",
      }),
    ).rejects.toThrow(/needs the MLRO's approval/);

    expect((await submissionRow(s.t, submissionId))?.status).toBe(
      "PENDING_REVIEW",
    );
    expect(await profiles(s.t)).toHaveLength(0);
    expect(await audit(s.t, "RISK_RATED")).toHaveLength(0);
  });

  it("ignores an enhanced due diligence record for someone who doesn't need one", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await approveAsMlro(s, submissionId);
    const [profile] = await profiles(s.t);
    expect(profile.eddReasons).toEqual([]);
    expect(profile.sourceOfFunds).toBeUndefined();
    expect(profile.eddCompletedAt).toBeUndefined();
  });

  it("logs the rating with its reasons", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
    });
    await approveAsMlro(s, submissionId);
    expect(await audit(s.t, "RISK_RATED")).toMatchObject([
      {
        actorId: s.ids.admin,
        kycSubmissionId: submissionId,
        statusAfter: "MEDIUM",
        note: "Medium risk. Enhanced due diligence: Lives outside Kenya.",
      },
    ]);
  });
});

describe("applicants who need enhanced due diligence", () => {
  const pep = {
    pepDeclared: true,
    pepDetails: "Member of the county assembly",
  };

  it("can only be approved by the MLRO, who records the source of funds and wealth", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, pep);

    // A moderator can't, whatever they record.
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        ...CLEAN,
        pepOutcome: "PEP",
        edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
      }),
    ).rejects.toThrow(/needs the MLRO's approval/);

    // The MLRO can't without the record.
    await expect(
      s.asAdmin.mutation(api.kycReview.approveKyc, {
        submissionId,
        ...CLEAN,
        pepOutcome: "PEP",
      }),
    ).rejects.toThrow(/where the funds come from/);
    await expect(
      approveAsMlro(s, submissionId, { pepOutcome: "PEP" }),
    ).rejects.toThrow(/source of wealth/);
    expect((await submissionRow(s.t, submissionId))?.status).toBe(
      "PENDING_REVIEW",
    );
    expect(await profiles(s.t)).toHaveLength(0);

    await approveAsMlro(s, submissionId, {
      pepOutcome: "PEP",
      edd: {
        sourceOfFunds: FUNDS,
        sourceOfWealth: WEALTH,
        note: "Seen payslips.",
      },
    });

    const [profile] = await profiles(s.t);
    expect(profile).toMatchObject({
      rating: "HIGH",
      pepOutcome: "PEP",
      eddReasons: ["HIGH_RISK", "PEP"],
      eddCompletedBy: s.ids.admin,
      eddCompletedAt: expect.any(Number),
      sourceOfFunds: FUNDS,
      sourceOfWealth: WEALTH,
      eddNote: "Seen payslips.",
    });
    expect(profile.nextReviewDue).toBe(profile.ratedAt + 365 * DAY);
    expect((await submissionRow(s.t, submissionId))?.status).toBe("APPROVED");
  });

  it("can't have a declared PEP cleared at review", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, pep);
    await expect(
      approveAsMlro(s, submissionId, {
        pepOutcome: "NOT_PEP",
        edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
      }),
    ).rejects.toThrow(/said they are a PEP/);
    expect(await profiles(s.t)).toHaveLength(0);
  });

  it("treats a PEP the reviewer found as one, even if the applicant didn't say", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        ...CLEAN,
        pepOutcome: "PEP",
      }),
    ).rejects.toThrow(/needs the MLRO's approval/);

    await approveAsMlro(s, submissionId, {
      pepOutcome: "PEP",
      edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
    });
    expect((await profiles(s.t))[0]).toMatchObject({
      pepOutcome: "PEP",
      rating: "HIGH",
    });
  });

  it("applies to someone who lives outside Kenya (policy 5.8)", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
    });
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, { submissionId, ...CLEAN }),
    ).rejects.toThrow(/Lives outside Kenya/);

    await approveAsMlro(s, submissionId);
    expect((await profiles(s.t))[0]).toMatchObject({
      rating: "MEDIUM",
      eddReasons: ["NON_RESIDENT"],
      sourceOfFunds: FUNDS,
    });
  });

  it("applies to a high-risk jurisdiction and to a very large expected amount", async () => {
    const s = await setup();
    const a = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "IR",
    });
    await approveAsMlro(s, a);
    expect((await profiles(s.t))[0].eddReasons).toEqual([
      "HIGH_RISK",
      "NON_RESIDENT",
      "HIGH_RISK_JURISDICTION",
    ]);

    const b = await submit(s, s.asBob, s.ids.bob, {
      legalName: "Someone Else",
      idNumber: "87654321",
      phoneNumber: "0722 111 222",
      expectedAmountKes: 5_000_000,
    });
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, { submissionId: b, ...CLEAN }),
    ).rejects.toThrow(/Rated High risk/);
  });

  it("can't be approved by the MLRO for themselves", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAdmin, s.ids.admin);
    await expect(approveAsMlro(s, submissionId)).rejects.toThrow(
      /can't review your own/,
    );
  });
});

describe("applications made before risk was rated", () => {
  async function pendingLegacy(s: Setup) {
    return await s.t.run((ctx) =>
      ctx.db.insert("kycSubmissions", {
        userId: s.ids.alice,
        requestedTier: 1,
        status: "PENDING_REVIEW",
        legalName: "Wanjiru Kamau",
        idType: "NATIONAL_ID",
        idNumber: "12345678",
        phoneNumber: "+254712345678",
        campaignPurpose: "School fees for my daughter's final year.",
        submittedAt: Date.now(),
      }),
    );
  }

  it("can be rejected but not approved, and says why", async () => {
    const s = await setup();
    const submissionId = await pendingLegacy(s);

    await expect(
      s.asAdmin.mutation(api.kycReview.approveKyc, { submissionId, ...CLEAN }),
    ).rejects.toThrow(/doesn't say where the applicant lives/);

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review).toMatchObject({
      declarations: null,
      canDecide: true,
      approveBlocked: expect.stringContaining("apply again"),
    });

    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId,
      reason: "Please apply again with the new questions answered.",
    });
    expect((await submissionRow(s.t, submissionId))?.status).toBe("REJECTED");
  });
});

describe("escalateKyc", () => {
  const WHY = "Applicant lives in the UK, needs the MLRO's sign-off.";

  it("passes an application to the MLRO and logs the reason", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
    });

    await s.asMod.mutation(api.kycReview.escalateKyc, {
      submissionId,
      note: WHY,
    });

    expect((await submissionRow(s.t, submissionId))?.escalatedAt).toEqual(
      expect.any(Number),
    );
    expect(await audit(s.t, "KYC_ESCALATED")).toMatchObject([
      { actorId: s.ids.mod, kycSubmissionId: submissionId, note: WHY },
    ]);

    // Still waiting, and the MLRO can pick it up.
    await approveAsMlro(s, submissionId);
    expect((await submissionRow(s.t, submissionId))?.status).toBe("APPROVED");
  });

  it("needs a reason, and can only be done once, while it is waiting", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);

    await expect(
      s.asMod.mutation(api.kycReview.escalateKyc, {
        submissionId,
        note: "  too ",
      }),
    ).rejects.toThrow(/Tell the MLRO why/);

    await s.asMod.mutation(api.kycReview.escalateKyc, {
      submissionId,
      note: WHY,
    });
    await expect(
      s.asMod.mutation(api.kycReview.escalateKyc, { submissionId, note: WHY }),
    ).rejects.toThrow(/already been passed/);

    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId,
      reason: "The photo of your ID is too blurry to read.",
    });
    await expect(
      s.asMod.mutation(api.kycReview.escalateKyc, { submissionId, note: WHY }),
    ).rejects.toThrow(/no longer waiting/);
  });

  it("is for staff, and not for their own application", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await expect(
      s.asBob.mutation(api.kycReview.escalateKyc, { submissionId, note: WHY }),
    ).rejects.toThrow(/permission/);
    await expect(
      s.t.mutation(api.kycReview.escalateKyc, { submissionId, note: WHY }),
    ).rejects.toThrow(/signed in/);

    const own = await submit(s, s.asMod, s.ids.mod, {
      legalName: "Mo Derator",
      idNumber: "34567890",
      phoneNumber: "0744 222 333",
    });
    await expect(
      s.asMod.mutation(api.kycReview.escalateKyc, {
        submissionId: own,
        note: WHY,
      }),
    ).rejects.toThrow(/own verification/);
  });

  it("is never visible to the applicant", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
    });
    await s.asMod.mutation(api.kycReview.escalateKyc, {
      submissionId,
      note: WHY,
    });

    const mine = await s.asAlice.query(api.kyc.getMyKyc, {});
    expect(mine?.pending).toMatchObject({ requestedTier: 1 });
    expect(JSON.stringify(mine)).not.toMatch(/escalat|mlro|risk|pep/i);
    expect(
      await s.asAlice.query(api.kycReview.getKycForReview, { submissionId }),
    ).toBeNull();
  });
});

describe("what staff see", () => {
  it("flags applications that will need the MLRO in the queue", async () => {
    const s = await setup();
    await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
    });
    await submit(s, s.asBob, s.ids.bob, {
      legalName: "Someone Else",
      idNumber: "87654321",
      phoneNumber: "0722 111 222",
    });

    const rows = await s.asMod.query(api.kycReview.listKycForReview, {
      status: "PENDING_REVIEW",
    });
    const byName = Object.fromEntries(rows.map((r) => [r.applicantName, r]));
    expect(byName["Wanjiru Kamau"]).toMatchObject({
      needsMlro: true,
      escalated: false,
    });
    expect(byName["Someone Else"]).toMatchObject({
      needsMlro: false,
      escalated: false,
    });
  });

  it("shows the declarations, who the MLRO is, and the profile once there is one", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
      pepDeclared: true,
      pepDetails: "Cousin of a senator",
    });

    const before = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(before).toMatchObject({
      viewerIsMlro: false,
      canManageRisk: false,
      canRate: false,
      riskProfile: null,
      escalatedAt: null,
      approveBlocked: null,
      declarations: {
        residenceCountry: "GB",
        expectedAmountKes: 50_000,
        expectedTimeline: "ONE_TO_3_MONTHS",
        pepDeclared: true,
        pepDetails: "Cousin of a senator",
        prohibitedActivitiesAcknowledged: true,
      },
    });

    await approveAsMlro(s, submissionId, {
      pepOutcome: "PEP",
      edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
    });

    const after = await s.asAdmin.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(after).toMatchObject({
      viewerIsMlro: true,
      canManageRisk: true,
      canRate: false, // it already has a profile
      riskProfile: {
        rating: "HIGH",
        pepOutcome: "PEP",
        eddOutstanding: false,
        ratedByName: "auth_admin",
        eddCompletedByName: "auth_admin",
        sourceOfFunds: FUNDS,
        sourceOfWealth: WEALTH,
      },
    });
  });

  it("shows nothing about risk to anyone who isn't staff", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      ...CLEAN,
    });
    expect(
      await s.asBob.query(api.kycReview.getKycForReview, { submissionId }),
    ).toBeNull();
    expect(
      await s.t.query(api.kycReview.getKycForReview, { submissionId }),
    ).toBeNull();
  });
});

describe("rateCustomer (someone approved before risk was rated)", () => {
  const rating = {
    residenceCountry: "KE",
    expectedAmountKes: 80_000,
    pepOutcome: "NOT_PEP",
    behaviour: "LOW",
  } as const;

  it("lets the MLRO rate them, and offers it only to the MLRO", async () => {
    const s = await setup();
    const submissionId = await legacyApproved(s, s.ids.alice);

    expect(
      await s.asMod.query(api.kycReview.getKycForReview, { submissionId }),
    ).toMatchObject({ canRate: false });
    expect(
      await s.asAdmin.query(api.kycReview.getKycForReview, { submissionId }),
    ).toMatchObject({ canRate: true, riskProfile: null });

    await s.asAdmin.mutation(api.customerRisk.rateCustomer, {
      submissionId,
      ...rating,
    });
    expect((await profiles(s.t))[0]).toMatchObject({
      userId: s.ids.alice,
      kycSubmissionId: submissionId,
      rating: "LOW",
      ratedBy: s.ids.admin,
    });
    expect(await audit(s.t, "RISK_RATED")).toHaveLength(1);
    expect(
      await s.asAdmin.query(api.kycReview.getKycForReview, { submissionId }),
    ).toMatchObject({ canRate: false });
  });

  it("is the MLRO's alone", async () => {
    const s = await setup();
    const submissionId = await legacyApproved(s, s.ids.alice);
    await expect(
      s.asMod.mutation(api.customerRisk.rateCustomer, {
        submissionId,
        ...rating,
      }),
    ).rejects.toThrow(/Only the MLRO/);
    await expect(
      s.asAlice.mutation(api.customerRisk.rateCustomer, {
        submissionId,
        ...rating,
      }),
    ).rejects.toThrow(/Only the MLRO/);
    await expect(
      s.t.mutation(api.customerRisk.rateCustomer, { submissionId, ...rating }),
    ).rejects.toThrow(/Only the MLRO/);
    expect(await profiles(s.t)).toHaveLength(0);
  });

  it("needs enhanced due diligence recorded when the rating calls for it", async () => {
    const s = await setup();
    const submissionId = await legacyApproved(s, s.ids.alice);
    const nonResident = { ...rating, residenceCountry: "GB" };

    await expect(
      s.asAdmin.mutation(api.customerRisk.rateCustomer, {
        submissionId,
        ...nonResident,
      }),
    ).rejects.toThrow(/where the funds come from/);
    expect(await profiles(s.t)).toHaveLength(0);

    await s.asAdmin.mutation(api.customerRisk.rateCustomer, {
      submissionId,
      ...nonResident,
      edd: { sourceOfFunds: FUNDS },
    });
    expect((await profiles(s.t))[0]).toMatchObject({
      rating: "MEDIUM",
      eddReasons: ["NON_RESIDENT"],
      sourceOfFunds: FUNDS,
    });
  });

  it("only rates an approved Level 1, once, and checks what it is given", async () => {
    const s = await setup();
    const pending = await submit(s, s.asAlice, s.ids.alice);
    await expect(
      s.asAdmin.mutation(api.customerRisk.rateCustomer, {
        submissionId: pending,
        ...rating,
      }),
    ).rejects.toThrow(/approved Level 1/);

    const submissionId = await legacyApproved(s, s.ids.bob);
    for (const [bad, message] of [
      [{ residenceCountry: "ZZ" }, /country they live in/],
      [{ expectedAmountKes: 0 }, /whole shillings/],
      [{ expectedAmountKes: 12.5 }, /whole shillings/],
      [{ expectedAmountKes: 5_000_000_000 }, /whole shillings/],
    ] as const) {
      await expect(
        s.asAdmin.mutation(api.customerRisk.rateCustomer, {
          submissionId,
          ...rating,
          ...bad,
        }),
      ).rejects.toThrow(message);
    }

    await s.asAdmin.mutation(api.customerRisk.rateCustomer, {
      submissionId,
      ...rating,
    });
    await expect(
      s.asAdmin.mutation(api.customerRisk.rateCustomer, {
        submissionId,
        ...rating,
      }),
    ).rejects.toThrow(/already been rated/);
  });
});

describe("what the MLRO can change afterwards", () => {
  async function rated(
    s: Setup,
    overrides: Partial<typeof BASE> = {},
    screening: Parameters<typeof approveAsMlro>[2] = {},
  ) {
    const submissionId = await submit(s, s.asAlice, s.ids.alice, overrides);
    await approveAsMlro(s, submissionId, screening);
    return submissionId;
  }
  const only = async (s: Setup) => (await profiles(s.t))[0];

  describe("overrideRiskRating", () => {
    it("sets a different rating, keeps what was computed, and says why", async () => {
      const s = await setup();
      const submissionId = await rated(s);

      await s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
        submissionId,
        rating: "HIGH",
        reason: "Adverse media about the organizer of the school.",
      });

      const profile = await only(s);
      expect(profile).toMatchObject({
        rating: "HIGH",
        computedRating: "LOW",
        overrideRating: "HIGH",
        overrideReason: "Adverse media about the organizer of the school.",
        eddReasons: ["HIGH_RISK"],
      });
      expect(profile.nextReviewDue).toBe(profile.ratedAt + 365 * DAY);
      expect(await audit(s.t, "RISK_OVERRIDDEN")).toMatchObject([
        {
          actorId: s.ids.admin,
          statusBefore: "LOW",
          statusAfter: "HIGH",
          note: expect.stringContaining("Adverse media"),
        },
      ]);
    });

    it("reopens enhanced due diligence when it adds a reason the record didn't cover", async () => {
      const s = await setup();
      const submissionId = await rated(s, { residenceCountry: "GB" });
      expect((await only(s)).eddCompletedAt).toEqual(expect.any(Number));

      await s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
        submissionId,
        rating: "HIGH",
        reason: "Wants to receive funds from several countries.",
      });
      const profile = await only(s);
      expect(profile.eddReasons).toEqual(["HIGH_RISK", "NON_RESIDENT"]);
      expect(profile.eddCompletedAt).toBeUndefined();
      expect(profile.eddCompletedBy).toBeUndefined();
    });

    it("keeps a record that still covers every reason", async () => {
      const s = await setup();
      const submissionId = await rated(s, { residenceCountry: "GB" });

      await s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
        submissionId,
        rating: "LOW",
        reason: "Long-standing customer with a clean history.",
      });
      const profile = await only(s);
      expect(profile).toMatchObject({
        rating: "LOW",
        eddReasons: ["NON_RESIDENT"],
        eddCompletedAt: expect.any(Number),
      });
    });

    it("can't lower a PEP, or set the rating it already has, or go without a reason", async () => {
      const s = await setup();
      const submissionId = await rated(
        s,
        { pepDeclared: true, pepDetails: "Member of the county assembly" },
        {
          pepOutcome: "PEP",
          edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
        },
      );
      const reason = "Reviewed the whole file again.";
      await expect(
        s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
          submissionId,
          rating: "MEDIUM",
          reason,
        }),
      ).rejects.toThrow(/PEP is always High/);
      await expect(
        s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
          submissionId,
          rating: "HIGH",
          reason,
        }),
      ).rejects.toThrow(/already rated High/);
      await expect(
        s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
          submissionId,
          rating: "HIGH",
          reason: "short",
        }),
      ).rejects.toThrow(/Say why you are changing the rating/);
      expect(await audit(s.t, "RISK_OVERRIDDEN")).toHaveLength(0);
    });

    it("is the MLRO's alone", async () => {
      const s = await setup();
      const submissionId = await rated(s);
      for (const who of [s.asMod, s.asAlice, s.asBob, s.t]) {
        await expect(
          who.mutation(api.customerRisk.overrideRiskRating, {
            submissionId,
            rating: "HIGH",
            reason: "I would like it to be High.",
          }),
        ).rejects.toThrow(/Only the MLRO/);
      }
      expect((await only(s)).rating).toBe("LOW");
    });
  });

  describe("flagForEdd and recordEdd", () => {
    it("stops payouts until the MLRO has recorded where the funds come from", async () => {
      const s = await setup();
      const submissionId = await rated(s);
      expect((await only(s)).eddReasons).toEqual([]);

      await s.asAdmin.mutation(api.customerRisk.flagForEdd, {
        submissionId,
        reason: "Donations are coming from many unrelated accounts.",
      });
      expect(await only(s)).toMatchObject({
        rating: "LOW",
        mlroFlagged: true,
        eddReasons: ["MLRO_FLAGGED"],
      });
      expect(await audit(s.t, "EDD_FLAGGED")).toHaveLength(1);
      expect(
        await s.asAdmin.query(api.kycReview.getKycForReview, { submissionId }),
      ).toMatchObject({ riskProfile: { eddOutstanding: true } });

      await s.asAdmin.mutation(api.customerRisk.recordEdd, {
        submissionId,
        edd: { sourceOfFunds: FUNDS, note: "Called the organizer." },
      });
      expect(await only(s)).toMatchObject({
        eddCompletedBy: s.ids.admin,
        eddCompletedAt: expect.any(Number),
        sourceOfFunds: FUNDS,
        eddNote: "Called the organizer.",
      });
      expect(await audit(s.t, "EDD_RECORDED")).toHaveLength(1);
      expect(
        await s.asAdmin.query(api.kycReview.getKycForReview, { submissionId }),
      ).toMatchObject({ riskProfile: { eddOutstanding: false } });
    });

    it("can only flag once, with a reason", async () => {
      const s = await setup();
      const submissionId = await rated(s);
      await expect(
        s.asAdmin.mutation(api.customerRisk.flagForEdd, {
          submissionId,
          reason: "no",
        }),
      ).rejects.toThrow(/why they need enhanced due diligence/);
      await s.asAdmin.mutation(api.customerRisk.flagForEdd, {
        submissionId,
        reason: "Donations are coming from many unrelated accounts.",
      });
      await expect(
        s.asAdmin.mutation(api.customerRisk.flagForEdd, {
          submissionId,
          reason: "Donations are coming from many unrelated accounts.",
        }),
      ).rejects.toThrow(/already flagged/);
    });

    it("only records when there is something to record, and a PEP's needs their wealth", async () => {
      const s = await setup();
      const submissionId = await rated(s);
      await expect(
        s.asAdmin.mutation(api.customerRisk.recordEdd, {
          submissionId,
          edd: { sourceOfFunds: FUNDS },
        }),
      ).rejects.toThrow(/no enhanced due diligence waiting/);

      // A PEP found later, via the override-free route: flag, then record.
      const pepId = await submit(s, s.asBob, s.ids.bob, {
        legalName: "Someone Else",
        idNumber: "87654321",
        phoneNumber: "0722 111 222",
        pepDeclared: true,
        pepDetails: "Member of the county assembly",
      });
      await approveAsMlro(s, pepId, {
        pepOutcome: "PEP",
        edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
      });
      await s.asAdmin.mutation(api.customerRisk.flagForEdd, {
        submissionId: pepId,
        reason: "New reports about the family's business.",
      });
      await expect(
        s.asAdmin.mutation(api.customerRisk.recordEdd, {
          submissionId: pepId,
          edd: { sourceOfFunds: FUNDS },
        }),
      ).rejects.toThrow(/source of wealth/);
      await s.asAdmin.mutation(api.customerRisk.recordEdd, {
        submissionId: pepId,
        edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
      });
    });

    it("is the MLRO's alone", async () => {
      const s = await setup();
      const submissionId = await rated(s);
      await expect(
        s.asMod.mutation(api.customerRisk.flagForEdd, {
          submissionId,
          reason: "Looks wrong to me, honestly.",
        }),
      ).rejects.toThrow(/Only the MLRO/);
      await s.asAdmin.mutation(api.customerRisk.flagForEdd, {
        submissionId,
        reason: "Donations are coming from many unrelated accounts.",
      });
      await expect(
        s.asMod.mutation(api.customerRisk.recordEdd, {
          submissionId,
          edd: { sourceOfFunds: FUNDS },
        }),
      ).rejects.toThrow(/Only the MLRO/);
    });
  });

  it("is never allowed on the MLRO's own record", async () => {
    const s = await setup();
    const submissionId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("kycSubmissions", {
        userId: s.ids.admin,
        requestedTier: 1,
        status: "APPROVED",
        submittedAt: Date.now(),
      });
      await insertRiskProfile(ctx, {
        userId: s.ids.admin,
        kycSubmissionId: id,
        ratedBy: s.ids.mod,
      });
      return id;
    });
    await expect(
      s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
        submissionId,
        rating: "LOW",
        reason: "Lowering my own rating, why not.",
      }),
    ).rejects.toThrow(/your own record/);
    await expect(
      s.asAdmin.mutation(api.customerRisk.flagForEdd, {
        submissionId,
        reason: "Flagging myself, for the record.",
      }),
    ).rejects.toThrow(/your own record/);
    expect(
      await s.asAdmin.query(api.kycReview.getKycForReview, { submissionId }),
    ).toMatchObject({ canManageRisk: false });
  });

  it("can't touch someone who hasn't been rated", async () => {
    const s = await setup();
    const submissionId = await legacyApproved(s, s.ids.alice);
    await expect(
      s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
        submissionId,
        rating: "HIGH",
        reason: "I would like it to be High.",
      }),
    ).rejects.toThrow(/hasn't been rated/);
  });
});

describe("approving Level 2 re-rates", () => {
  async function toLevel2(s: Setup, submissionId: Id<"kycSubmissions">) {
    const tier2 = await s.asAlice.mutation(api.kyc.submitKycTier2, {
      kraPin: "a123456789z",
      documents: await docs(s.t, s.ids.alice, [
        "CAMPAIGN_EVIDENCE",
        "KRA_PIN_CERTIFICATE",
        "PAYOUT_ACCOUNT_PROOF",
      ]),
    });
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId: tier2.submissionId,
      confirmedChecks: [...TIER_2_CHECKS],
    });
    return submissionId;
  }

  it("raises Low to Medium, because a Level 2 fundraiser expects to be paid more", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      ...CLEAN,
    });
    expect((await profiles(s.t))[0].rating).toBe("LOW");

    await toLevel2(s, submissionId);

    const profile = (await profiles(s.t))[0];
    expect(profile).toMatchObject({
      rating: "MEDIUM",
      ratedBy: s.ids.mod,
      factors: { expectedValue: "MEDIUM" },
      eddReasons: [],
    });
    expect(profile.nextReviewDue).toBe(profile.ratedAt + 730 * DAY);
    expect(await audit(s.t, "RISK_RATED")).toMatchObject([
      { statusAfter: "LOW" },
      { statusBefore: "LOW", statusAfter: "MEDIUM" },
    ]);
  });

  it("leaves a rating that doesn't change alone, and an override in place", async () => {
    const s = await setup();
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      ...CLEAN,
      behaviour: "MEDIUM",
    });
    const before = (await profiles(s.t))[0];
    await toLevel2(s, submissionId);
    expect((await profiles(s.t))[0]).toEqual(before);
    expect(await audit(s.t, "RISK_RATED")).toHaveLength(1);

    // An override survives the re-rating at Level 2.
    await s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
      submissionId,
      rating: "HIGH",
      reason: "Adverse media about the organizer of the school.",
    });
    expect((await profiles(s.t))[0].rating).toBe("HIGH");
  });

  it("still approves someone who was never rated, who stays blocked from payouts", async () => {
    const s = await setup();
    await legacyApproved(s, s.ids.alice);
    const tier2 = await s.asAlice.mutation(api.kyc.submitKycTier2, {
      kraPin: "a123456789z",
      documents: await docs(s.t, s.ids.alice, [
        "CAMPAIGN_EVIDENCE",
        "KRA_PIN_CERTIFICATE",
        "PAYOUT_ACCOUNT_PROOF",
      ]),
    });
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId: tier2.submissionId,
      confirmedChecks: [...TIER_2_CHECKS],
    });
    expect(await profiles(s.t)).toHaveLength(0);
  });
});

describe("payouts", () => {
  const riskBlockers = (s: Setup, fundraiserId: Id<"fundraisers">) =>
    s.t.run(async (ctx) => {
      const fundraiser = await ctx.db.get(fundraiserId);
      const blockers = await getPayoutBlockers(ctx, fundraiser!, Date.now());
      // The payout account isn't what is being tested here.
      return blockers
        .map((b) => b.code)
        .filter((code) => code === "RISK_NOT_RATED" || code === "EDD_REQUIRED");
    });
  const fundraiserFor = (s: Setup, creatorId: Id<"users">) =>
    s.t.run((ctx) =>
      ctx.db.insert("fundraisers", {
        creatorId,
        beneficiaryType: "SELF",
        title: "Water for Kajiado",
        story: "A story that is long enough to be a story.",
        type: "OTHER",
        goalAmount: 100000,
        currency: "KES",
        amountRaised: 0,
        donorCount: 0,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

  it("waits for a risk rating, then for enhanced due diligence when it is needed", async () => {
    const s = await setup();
    const fundraiserId = await fundraiserFor(s, s.ids.alice);

    // Verified long ago, never rated.
    const submissionId = await legacyApproved(s, s.ids.alice);
    expect(await riskBlockers(s, fundraiserId)).toEqual(["RISK_NOT_RATED"]);

    await s.asAdmin.mutation(api.customerRisk.rateCustomer, {
      submissionId,
      residenceCountry: "KE",
      expectedAmountKes: 80_000,
      pepOutcome: "NOT_PEP",
      behaviour: "LOW",
    });
    expect(await riskBlockers(s, fundraiserId)).toEqual([]);

    await s.asAdmin.mutation(api.customerRisk.flagForEdd, {
      submissionId,
      reason: "Donations are coming from many unrelated accounts.",
    });
    expect(await riskBlockers(s, fundraiserId)).toEqual(["EDD_REQUIRED"]);

    await s.asAdmin.mutation(api.customerRisk.recordEdd, {
      submissionId,
      edd: { sourceOfFunds: FUNDS },
    });
    expect(await riskBlockers(s, fundraiserId)).toEqual([]);
  });

  it("is open to someone approved through the normal path, who needed no enhanced checks", async () => {
    const s = await setup();
    const fundraiserId = await fundraiserFor(s, s.ids.alice);
    const submissionId = await submit(s, s.asAlice, s.ids.alice);
    expect(await riskBlockers(s, fundraiserId)).toEqual([]); // not verified yet: other blocker

    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      ...CLEAN,
    });
    expect(await riskBlockers(s, fundraiserId)).toEqual([]);
  });

  it("is open to a non-resident only once the MLRO approved them with enhanced due diligence", async () => {
    const s = await setup();
    const fundraiserId = await fundraiserFor(s, s.ids.alice);
    const submissionId = await submit(s, s.asAlice, s.ids.alice, {
      residenceCountry: "GB",
    });
    await approveAsMlro(s, submissionId);
    expect(await riskBlockers(s, fundraiserId)).toEqual([]);

    await s.asAdmin.mutation(api.customerRisk.overrideRiskRating, {
      submissionId,
      rating: "HIGH",
      reason: "Wants to receive funds from several countries.",
    });
    expect(await riskBlockers(s, fundraiserId)).toEqual(["EDD_REQUIRED"]);
  });
});
