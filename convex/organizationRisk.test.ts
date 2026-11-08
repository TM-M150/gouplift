/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ORGANIZATION_REVIEW_CHECKS } from "../lib/organization-verification";
import { DAY_MS } from "../lib/time";
import { getPayoutBlockers } from "./lib/payoutEligibility";
import { toMemberOrganization } from "./organizations";
import {
  ORG_DECLARATIONS,
  OWNER_MAJORITY,
  OWNER_MINORITY,
  insertOrgRiskProfile,
} from "./org.fixtures";

// Beneficial owners, risk rating, PEP screening and enhanced due diligence for
// organizations (AML policy 4.3, 6, 7, 8): how verifying an organization rates
// it, who may verify which, what the MLRO can change afterwards, and what the
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

const FUNDS = "Member contributions and a county grant, per the audited accounts.";
const WEALTH = "Family business income, confirmed with the KRA PIN certificate.";

// The documents "Other registered body" must supply, all approved.
const REQUIRED_DOCS = [
  "REGISTRATION_CERTIFICATE",
  "PAYOUT_ACCOUNT_PROOF",
  "AUTHORISATION_RESOLUTION",
  "OFFICIAL_IDS",
] as const;

const { beneficialOwners: _owners, ...DECLARED } = ORG_DECLARATIONS;
void _owners;

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
      alice: await user("auth_alice", "USER"), // creates the organizations
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

let counter = 0;

// An organization waiting for review, with every required document approved.
// Pass `declared: false` for one that applied before these were asked.
async function makeOrg(
  s: Setup,
  options: {
    createdBy?: Id<"users">;
    status?: Doc<"organizations">["verificationStatus"];
    declared?: boolean;
    declaration?: Partial<typeof DECLARED> & { pepDetails?: string };
    owners?: Array<typeof OWNER_MAJORITY>;
  } = {},
) {
  const createdBy = options.createdBy ?? s.ids.alice;
  const now = Date.now();
  counter += 1;
  return await s.t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: `Nakuru Youth Trust ${counter}`,
      slug: `nakuru-youth-trust-${counter}`,
      organizationType: "OTHER",
      verificationStatus: options.status ?? "PENDING_REVIEW",
      createdBy,
      createdAt: now,
      updatedAt: now,
      ...(options.declared === false
        ? {}
        : {
            registeredCountry: DECLARED.registeredCountry,
            expectedAmountKes: DECLARED.expectedAmountKes,
            expectedTimeline: DECLARED.expectedTimeline,
            pepDeclared: DECLARED.pepDeclared,
            prohibitedActivitiesAcknowledged: true,
            ...options.declaration,
          }),
    });
    await ctx.db.insert("organizationMembers", {
      organizationId,
      userId: createdBy,
      role: "OWNER",
      joinedAt: now,
    });
    for (const documentType of REQUIRED_DOCS) {
      const storageId = await ctx.storage.store(
        new Blob([new Uint8Array(1024)], { type: "application/pdf" }),
      );
      await ctx.db.insert("organizationDocuments", {
        organizationId,
        documentType,
        storageId,
        fileName: `${documentType.toLowerCase()}.pdf`,
        contentType: "application/pdf",
        size: 1024,
        uploadedBy: createdBy,
        reviewStatus: "APPROVED",
        createdAt: now,
      });
    }
    for (const owner of options.owners ?? [OWNER_MAJORITY, OWNER_MINORITY]) {
      await ctx.db.insert("organizationBeneficialOwners", {
        organizationId,
        ...owner,
        addedBy: createdBy,
        createdAt: now,
      });
    }
    return organizationId;
  });
}

const CLEAN = {
  confirmedChecks: [...ORGANIZATION_REVIEW_CHECKS],
  pepOutcome: "NOT_PEP" as const,
  behaviour: "LOW" as const,
  complexStructure: false,
  highRiskSector: false,
};

function verify(
  who: Who,
  organizationId: Id<"organizations">,
  overrides: Partial<Parameters<Who["mutation"]>[1]> & Record<string, unknown> = {},
) {
  return who.mutation(api.admin.verifyOrganization, {
    organizationId,
    ...CLEAN,
    ...overrides,
  } as never);
}

const profileOf = (t: T, organizationId: Id<"organizations">) =>
  t.run((ctx) =>
    ctx.db
      .query("organizationRiskProfiles")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .first(),
  );
const orgOf = (t: T, id: Id<"organizations">) => t.run((ctx) => ctx.db.get(id));
const logOf = (t: T, organizationId: Id<"organizations">) =>
  t.run((ctx) =>
    ctx.db
      .query("adminAuditLog")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .collect(),
  );

describe("verifying an organization", () => {
  it("verifies an ordinary organization and rates it Medium", async () => {
    const s = await setup();
    const org = await makeOrg(s);

    await verify(s.asMod, org);

    expect((await orgOf(s.t, org))?.verificationStatus).toBe("VERIFIED");
    expect((await orgOf(s.t, org))?.confirmedChecks).toEqual([
      ...ORGANIZATION_REVIEW_CHECKS,
    ]);
    const profile = await profileOf(s.t, org);
    expect(profile).toMatchObject({
      rating: "MEDIUM",
      pepOutcome: "NOT_PEP",
      noOwnerIdentified: false,
      eddReasons: [],
      mlroFlagged: false,
      ratedBy: s.ids.mod,
    });
    expect(profile?.eddCompletedAt).toBeUndefined();
    // Medium: reviewed every two years (policy 5.10).
    expect(profile!.nextReviewDue - profile!.ratedAt).toBe(2 * 365 * DAY_MS);

    const actions = (await logOf(s.t, org)).map((e) => e.action).sort();
    expect(actions).toEqual(["ORGANIZATION_VERIFIED", "RISK_RATED"]);
  });

  it("needs every review check confirmed", async () => {
    const s = await setup();
    const org = await makeOrg(s);

    await expect(
      verify(s.asMod, org, { confirmedChecks: ["BENEFICIAL_OWNERS_VERIFIED"] }),
    ).rejects.toThrow(/Confirm each check/);
    await expect(verify(s.asMod, org, { confirmedChecks: [] })).rejects.toThrow(
      /Confirm each check/,
    );
    expect((await orgOf(s.t, org))?.verificationStatus).toBe("PENDING_REVIEW");
    expect(await profileOf(s.t, org)).toBeNull();
  });

  it("refuses a reviewer who created the organization", async () => {
    const s = await setup();
    const org = await makeOrg(s, { createdBy: s.ids.mod });
    await expect(verify(s.asMod, org)).rejects.toThrow(/organization you created/);
    // Not even the MLRO's own.
    const adminOrg = await makeOrg(s, { createdBy: s.ids.admin });
    await expect(verify(s.asAdmin, adminOrg)).rejects.toThrow(
      /organization you created/,
    );
  });

  it("refuses anyone who isn't staff", async () => {
    const s = await setup();
    const org = await makeOrg(s);
    await expect(verify(s.asBob, org)).rejects.toThrow();
    await expect(verify(s.asAlice, org)).rejects.toThrow();
  });

  it("refuses an application made before the declarations were asked", async () => {
    const s = await setup();
    const org = await makeOrg(s, { declared: false });
    await expect(verify(s.asMod, org)).rejects.toThrow(/apply again/);
    await expect(verify(s.asAdmin, org)).rejects.toThrow(/apply again/);
  });

  it("won't verify until the owners are listed (policy 6)", async () => {
    const s = await setup();
    const org = await makeOrg(s, { owners: [] });

    await expect(verify(s.asMod, org)).rejects.toThrow(/senior managing official/);

    await s.asMod.mutation(api.beneficialOwners.addBeneficialOwner, {
      organizationId: org,
      owner: OWNER_MAJORITY,
    });
    await verify(s.asMod, org);
    expect((await profileOf(s.t, org))?.noOwnerIdentified).toBe(false);
  });

  it("accepts a senior managing official where nobody owns it, and says so (policy 6.2)", async () => {
    const s = await setup();
    const org = await makeOrg(s, {
      owners: [
        {
          ...OWNER_MAJORITY,
          basis: "SENIOR_MANAGING_OFFICIAL" as never,
          ownershipPercent: undefined as never,
        },
      ],
    });

    await verify(s.asMod, org);

    expect(await profileOf(s.t, org)).toMatchObject({
      rating: "MEDIUM",
      noOwnerIdentified: true,
    });
  });

  it("rejects a register that mixes an official with owners", async () => {
    const s = await setup();
    const org = await makeOrg(s, {
      owners: [
        OWNER_MAJORITY,
        {
          ...OWNER_MINORITY,
          basis: "SENIOR_MANAGING_OFFICIAL" as never,
          ownershipPercent: undefined as never,
        },
      ],
    });
    await expect(verify(s.asMod, org)).rejects.toThrow(/only recorded when nobody/);
  });

  it("ignores an EDD record where the rating doesn't call for one", async () => {
    const s = await setup();
    const org = await makeOrg(s);
    await verify(s.asAdmin, org, { edd: { sourceOfFunds: FUNDS } });
    const profile = await profileOf(s.t, org);
    expect(profile?.eddCompletedAt).toBeUndefined();
    expect(profile?.sourceOfFunds).toBeUndefined();
  });

  describe("needing the MLRO", () => {
    it("lets only the MLRO verify an organization registered abroad (policy 5.8)", async () => {
      const s = await setup();
      const org = await makeOrg(s, { declaration: { registeredCountry: "GB" } });

      await expect(verify(s.asMod, org)).rejects.toThrow(/needs the MLRO's approval/);
      await expect(verify(s.asAdmin, org)).rejects.toThrow(/where the funds come from/);

      await verify(s.asAdmin, org, { edd: { sourceOfFunds: FUNDS } });

      const profile = await profileOf(s.t, org);
      expect(profile).toMatchObject({
        rating: "MEDIUM",
        eddReasons: ["NON_RESIDENT"],
        sourceOfFunds: FUNDS,
        eddCompletedBy: s.ids.admin,
      });
      expect(profile?.eddCompletedAt).toEqual(expect.any(Number));
    });

    it("lets only the MLRO verify one expecting more than the Level 2 limit", async () => {
      const s = await setup();
      const org = await makeOrg(s, { declaration: { expectedAmountKes: 5_000_000 } });
      await expect(verify(s.asMod, org)).rejects.toThrow(/needs the MLRO's approval/);
      await verify(s.asAdmin, org, { edd: { sourceOfFunds: FUNDS } });
      expect((await profileOf(s.t, org))?.rating).toBe("HIGH");
    });

    it.each([
      ["a complex structure", { complexStructure: true }],
      ["a high-risk sector", { highRiskSector: true }],
      ["red flags in how it behaved", { behaviour: "HIGH" as const }],
    ])("lets only the MLRO verify one with %s", async (_name, change) => {
      const s = await setup();
      const org = await makeOrg(s);
      await expect(verify(s.asMod, org, change)).rejects.toThrow(
        /needs the MLRO's approval/,
      );
      await verify(s.asAdmin, org, { ...change, edd: { sourceOfFunds: FUNDS } });
      expect((await profileOf(s.t, org))?.rating).toBe("HIGH");
    });

    it("treats an owner who declared a PEP as one, and needs their source of wealth (policy 7)", async () => {
      const s = await setup();
      const org = await makeOrg(s, {
        declaration: { pepDeclared: true, pepDetails: "The treasurer is a county MCA" },
        owners: [{ ...OWNER_MAJORITY, pepDeclared: true }, OWNER_MINORITY],
      });

      // They can't be cleared by saying they aren't.
      await expect(verify(s.asAdmin, org)).rejects.toThrow(/senior public position/);
      // Only the MLRO deals with a PEP.
      await expect(verify(s.asMod, org, { pepOutcome: "PEP" })).rejects.toThrow(
        /needs the MLRO's approval/,
      );
      // Funds alone aren't enough for a PEP.
      await expect(
        verify(s.asAdmin, org, { pepOutcome: "PEP", edd: { sourceOfFunds: FUNDS } }),
      ).rejects.toThrow(/source of wealth/);

      await verify(s.asAdmin, org, {
        pepOutcome: "PEP",
        edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
      });

      const profile = await profileOf(s.t, org);
      expect(profile).toMatchObject({
        rating: "HIGH",
        pepOutcome: "PEP",
        sourceOfWealth: WEALTH,
      });
      expect(profile?.eddReasons).toContain("PEP");
    });

    it("lets the reviewer find a PEP the organization didn't declare", async () => {
      const s = await setup();
      const org = await makeOrg(s);
      await expect(verify(s.asMod, org, { pepOutcome: "PEP" })).rejects.toThrow(
        /needs the MLRO's approval/,
      );
      await verify(s.asAdmin, org, {
        pepOutcome: "PEP",
        edd: { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH },
      });
      expect((await profileOf(s.t, org))?.rating).toBe("HIGH");
    });

    it("leaves nothing behind when the MLRO's approval is refused", async () => {
      const s = await setup();
      const org = await makeOrg(s, { declaration: { registeredCountry: "GB" } });
      await expect(verify(s.asMod, org)).rejects.toThrow();
      expect((await orgOf(s.t, org))?.verificationStatus).toBe("PENDING_REVIEW");
      expect(await profileOf(s.t, org)).toBeNull();
      expect(await logOf(s.t, org)).toEqual([]);
    });
  });
});

describe("passing an organization to the MLRO", () => {
  it("marks it, logs it, and shows it in the queue", async () => {
    const s = await setup();
    const org = await makeOrg(s);

    await s.asMod.mutation(api.admin.escalateOrganization, {
      organizationId: org,
      note: "Two of the officials share a surname with a sitting MP.",
    });

    expect((await orgOf(s.t, org))?.escalatedAt).toEqual(expect.any(Number));
    const entry = (await logOf(s.t, org)).find(
      (e) => e.action === "ORGANIZATION_ESCALATED",
    );
    expect(entry).toMatchObject({
      actorId: s.ids.mod,
      note: "Two of the officials share a surname with a sitting MP.",
    });

    const queue = await s.asAdmin.query(api.admin.listOrganizationsForReview, {
      status: "PENDING_REVIEW",
    });
    expect(queue.find((row) => row._id === org)?.escalated).toBe(true);
  });

  it("flags in the queue one that will need the MLRO from what it declared", async () => {
    const s = await setup();
    const abroad = await makeOrg(s, { declaration: { registeredCountry: "GB" } });
    const ordinary = await makeOrg(s);

    const queue = await s.asMod.query(api.admin.listOrganizationsForReview, {
      status: "PENDING_REVIEW",
    });
    expect(queue.find((r) => r._id === abroad)?.needsMlro).toBe(true);
    expect(queue.find((r) => r._id === ordinary)?.needsMlro).toBe(false);
  });

  it("flags one with an owner who declared a PEP", async () => {
    const s = await setup();
    const org = await makeOrg(s, {
      declaration: { pepDeclared: true, pepDetails: "The treasurer is a county MCA" },
      owners: [{ ...OWNER_MAJORITY, pepDeclared: true }, OWNER_MINORITY],
    });
    const queue = await s.asMod.query(api.admin.listOrganizationsForReview, {
      status: "PENDING_REVIEW",
    });
    expect(queue.find((r) => r._id === org)?.needsMlro).toBe(true);
  });

  it("refuses a short note, a second time, and one's own organization", async () => {
    const s = await setup();
    const org = await makeOrg(s);
    await expect(
      s.asMod.mutation(api.admin.escalateOrganization, {
        organizationId: org,
        note: "ok",
      }),
    ).rejects.toThrow(/at least 10 characters/);

    await s.asMod.mutation(api.admin.escalateOrganization, {
      organizationId: org,
      note: "Please look at the registry extract.",
    });
    await expect(
      s.asMod.mutation(api.admin.escalateOrganization, {
        organizationId: org,
        note: "Passing it on again.",
      }),
    ).rejects.toThrow(/already been passed/);

    const own = await makeOrg(s, { createdBy: s.ids.mod });
    await expect(
      s.asMod.mutation(api.admin.escalateOrganization, {
        organizationId: own,
        note: "Passing on my own organization.",
      }),
    ).rejects.toThrow(/organization you created/);
  });

  it("only works while it is waiting, and only for staff", async () => {
    const s = await setup();
    const verified = await makeOrg(s, { status: "VERIFIED" });
    await expect(
      s.asMod.mutation(api.admin.escalateOrganization, {
        organizationId: verified,
        note: "It is already verified.",
      }),
    ).rejects.toThrow(/no longer waiting/);

    const org = await makeOrg(s);
    await expect(
      s.asBob.mutation(api.admin.escalateOrganization, {
        organizationId: org,
        note: "I'm not staff but I try.",
      }),
    ).rejects.toThrow();
  });

  it("stays out of what the organization's own members are sent (policy 12.3)", async () => {
    const s = await setup();
    const org = await makeOrg(s, { declaration: { pepDeclared: false } });
    await s.asMod.mutation(api.admin.escalateOrganization, {
      organizationId: org,
      note: "Please look at the registry extract.",
    });
    expect((await orgOf(s.t, org))?.escalatedAt).toBeDefined();

    const slug = (await orgOf(s.t, org))!.slug;
    const seen = await s.asAlice.query(api.organizations.getOrganizationBySlug, {
      slug,
    });
    expect(seen?.name).toBeDefined();
    for (const field of [
      "escalatedAt",
      "confirmedChecks",
      "registeredCountry",
      "expectedAmountKes",
      "expectedTimeline",
      "pepDeclared",
      "pepDetails",
      "prohibitedActivitiesAcknowledged",
    ]) {
      expect(seen).not.toHaveProperty(field);
    }

    const mine = await s.asAlice.query(api.organizations.getMyOrganizations, {});
    expect(mine.find((o) => o._id === org)).not.toHaveProperty("escalatedAt");
    expect(JSON.stringify(toMemberOrganization((await orgOf(s.t, org))!))).not.toContain(
      "escalatedAt",
    );
  });
});

describe("what staff see when they review an organization", () => {
  it("gives staff the owners, with ID numbers, and the declarations", async () => {
    const s = await setup();
    const org = await makeOrg(s);

    const view = await s.asMod.query(api.admin.getOrganizationForReview, {
      organizationId: org,
    });

    expect(view?.declarations).toMatchObject({
      registeredCountry: "KE",
      expectedAmountKes: 500_000,
      pepDeclared: false,
    });
    expect(view?.owners.map((o) => o.idNumber)).toEqual(["23456789", "34567890"]);
    expect(view?.ownersProblem).toBeNull();
    expect(view?.viewerIsMlro).toBe(false);
    expect(view?.canVerify).toBe(true);
    expect(view?.verifyBlocked).toBeNull();
    expect(view?.riskProfile).toBeNull();
  });

  it("gives nobody else anything", async () => {
    const s = await setup();
    const org = await makeOrg(s);
    expect(
      await s.asBob.query(api.admin.getOrganizationForReview, { organizationId: org }),
    ).toBeNull();
    expect(
      await s.asAlice.query(api.admin.getOrganizationForReview, { organizationId: org }),
    ).toBeNull();
    expect(
      await s.asBob.query(api.admin.listOrganizationsForReview, {
        status: "PENDING_REVIEW",
      }),
    ).toEqual([]);
  });

  it("says why it can't be verified when nothing on the page can fix it", async () => {
    const s = await setup();
    const legacy = await makeOrg(s, { declared: false });
    const own = await makeOrg(s, { createdBy: s.ids.mod });

    const legacyView = await s.asMod.query(api.admin.getOrganizationForReview, {
      organizationId: legacy,
    });
    expect(legacyView?.canVerify).toBe(false);
    expect(legacyView?.verifyBlocked).toMatch(/apply again/);

    const ownView = await s.asMod.query(api.admin.getOrganizationForReview, {
      organizationId: own,
    });
    expect(ownView?.verifyBlocked).toMatch(/organization you created/);
  });

  it("reports a register that can't be accepted yet", async () => {
    const s = await setup();
    const org = await makeOrg(s, { owners: [] });
    const view = await s.asMod.query(api.admin.getOrganizationForReview, {
      organizationId: org,
    });
    expect(view?.ownersProblem).toMatch(/senior managing official/);
  });

  it("shows the rating once there is one, and who can change it", async () => {
    const s = await setup();
    const org = await makeOrg(s);
    await verify(s.asMod, org);

    const asMlro = await s.asAdmin.query(api.admin.getOrganizationForReview, {
      organizationId: org,
    });
    expect(asMlro?.riskProfile).toMatchObject({
      rating: "MEDIUM",
      ratedByName: "auth_mod",
      eddOutstanding: false,
    });
    expect(asMlro?.canManageRisk).toBe(true);
    expect(asMlro?.canRate).toBe(false);

    const asMod = await s.asMod.query(api.admin.getOrganizationForReview, {
      organizationId: org,
    });
    expect(asMod?.canManageRisk).toBe(false);
  });
});

describe("keeping the register of owners", () => {
  it("lets staff add and remove people while it waits, and logs it without the ID number", async () => {
    const s = await setup();
    const org = await makeOrg(s, { owners: [] });

    await s.asMod.mutation(api.beneficialOwners.addBeneficialOwner, {
      organizationId: org,
      owner: OWNER_MAJORITY,
    });
    const rows = await s.t.run((ctx) =>
      ctx.db
        .query("organizationBeneficialOwners")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", org))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idNumber: "23456789", addedBy: s.ids.mod });

    await s.asMod.mutation(api.beneficialOwners.removeBeneficialOwner, {
      ownerId: rows[0]._id,
    });
    expect(
      await s.t.run((ctx) => ctx.db.get(rows[0]._id)),
    ).toBeNull();

    const log = await logOf(s.t, org);
    expect(log.map((e) => e.action)).toEqual([
      "BENEFICIAL_OWNER_ADDED",
      "BENEFICIAL_OWNER_REMOVED",
    ]);
    expect(JSON.stringify(log)).not.toContain("23456789");
  });

  it("refuses the same person twice, shares above 100%, and a bad ID", async () => {
    const s = await setup();
    const org = await makeOrg(s, { owners: [OWNER_MAJORITY] });
    const add = (owner: Record<string, unknown>) =>
      s.asMod.mutation(api.beneficialOwners.addBeneficialOwner, {
        organizationId: org,
        owner: owner as never,
      });

    await expect(add({ ...OWNER_MAJORITY, fullName: "W Kamau", ownershipPercent: 10 })).rejects.toThrow(
      /already listed/,
    );
    await expect(add({ ...OWNER_MINORITY, ownershipPercent: 50 })).rejects.toThrow(
      /more than 100%/,
    );
    await expect(add({ ...OWNER_MINORITY, idNumber: "12" })).rejects.toThrow(
      /National ID number/,
    );
    await expect(add({ ...OWNER_MINORITY, residenceCountry: "ZZ" })).rejects.toThrow(
      /country/,
    );
    // Without that, a second owner is fine.
    await add(OWNER_MINORITY);
  });

  it("is for staff, and not for the organization's own creator", async () => {
    const s = await setup();
    const org = await makeOrg(s, { owners: [] });
    await expect(
      s.asAlice.mutation(api.beneficialOwners.addBeneficialOwner, {
        organizationId: org,
        owner: OWNER_MAJORITY,
      }),
    ).rejects.toThrow();

    const own = await makeOrg(s, { createdBy: s.ids.mod, owners: [] });
    await expect(
      s.asMod.mutation(api.beneficialOwners.addBeneficialOwner, {
        organizationId: own,
        owner: OWNER_MAJORITY,
      }),
    ).rejects.toThrow(/organization you created/);
  });

  it("is frozen once it has been decided, except for the MLRO filling it in before a rating", async () => {
    const s = await setup();
    const verified = await makeOrg(s, { status: "VERIFIED", owners: [] });
    await expect(
      s.asMod.mutation(api.beneficialOwners.addBeneficialOwner, {
        organizationId: verified,
        owner: OWNER_MAJORITY,
      }),
    ).rejects.toThrow(/can't be changed any more/);

    // The MLRO can, so it can be rated.
    await s.asAdmin.mutation(api.beneficialOwners.addBeneficialOwner, {
      organizationId: verified,
      owner: OWNER_MAJORITY,
    });

    // But not once it has been rated.
    await s.t.run((ctx) =>
      insertOrgRiskProfile(ctx, { organizationId: verified, ratedBy: s.ids.admin }),
    );
    await expect(
      s.asAdmin.mutation(api.beneficialOwners.addBeneficialOwner, {
        organizationId: verified,
        owner: OWNER_MINORITY,
      }),
    ).rejects.toThrow(/can't be changed any more/);

    const rejected = await makeOrg(s, { status: "REJECTED", owners: [] });
    await expect(
      s.asAdmin.mutation(api.beneficialOwners.addBeneficialOwner, {
        organizationId: rejected,
        owner: OWNER_MAJORITY,
      }),
    ).rejects.toThrow(/can't be changed any more/);
  });
});

describe("rating an organization verified before risk was rated", () => {
  const RATE = {
    registeredCountry: "KE",
    expectedAmountKes: 800_000,
    ...CLEAN,
  };
  const rate = (who: Who, organizationId: Id<"organizations">, o: Record<string, unknown> = {}) =>
    who.mutation(api.organizationRisk.rateOrganization, {
      organizationId,
      registeredCountry: RATE.registeredCountry,
      expectedAmountKes: RATE.expectedAmountKes,
      pepOutcome: RATE.pepOutcome,
      behaviour: RATE.behaviour,
      complexStructure: false,
      highRiskSector: false,
      ...o,
    } as never);

  it("is the MLRO's alone", async () => {
    const s = await setup();
    const org = await makeOrg(s, { status: "VERIFIED", declared: false });
    await expect(rate(s.asMod, org)).rejects.toThrow(/Only the MLRO/);
    await expect(rate(s.asAlice, org)).rejects.toThrow();
  });

  it("rates it from what the MLRO enters, and clears payouts", async () => {
    const s = await setup();
    const org = await makeOrg(s, { status: "VERIFIED", declared: false });
    expect(
      (await s.asAdmin.query(api.admin.getOrganizationForReview, { organizationId: org }))
        ?.canRate,
    ).toBe(true);

    await rate(s.asAdmin, org);

    expect(await profileOf(s.t, org)).toMatchObject({
      rating: "MEDIUM",
      expectedAmountKes: 800_000,
      residenceCountry: "KE",
      ratedBy: s.ids.admin,
    });
    expect(
      (await logOf(s.t, org)).some((e) => e.action === "RISK_RATED"),
    ).toBe(true);
    expect(
      (await s.asAdmin.query(api.admin.getOrganizationForReview, { organizationId: org }))
        ?.canRate,
    ).toBe(false);
  });

  it("needs the register to be acceptable and an EDD record where the rating calls for one", async () => {
    const s = await setup();
    const noOwners = await makeOrg(s, { status: "VERIFIED", declared: false, owners: [] });
    await expect(rate(s.asAdmin, noOwners)).rejects.toThrow(/senior managing official/);

    const org = await makeOrg(s, { status: "VERIFIED", declared: false });
    await expect(rate(s.asAdmin, org, { registeredCountry: "GB" })).rejects.toThrow(
      /where the funds come from/,
    );
    await rate(s.asAdmin, org, {
      registeredCountry: "GB",
      edd: { sourceOfFunds: FUNDS },
    });
    expect((await profileOf(s.t, org))?.eddReasons).toEqual(["NON_RESIDENT"]);
  });

  it("checks what it is given", async () => {
    const s = await setup();
    const org = await makeOrg(s, { status: "VERIFIED", declared: false });
    await expect(rate(s.asAdmin, org, { registeredCountry: "ZZ" })).rejects.toThrow(/country/);
    await expect(rate(s.asAdmin, org, { expectedAmountKes: 0 })).rejects.toThrow(/whole shillings/);
    await expect(rate(s.asAdmin, org, { expectedAmountKes: 1.5 })).rejects.toThrow(/whole shillings/);
  });

  it("only rates a verified organization, once, and not the MLRO's own", async () => {
    const s = await setup();
    const pending = await makeOrg(s, { declared: false });
    await expect(rate(s.asAdmin, pending)).rejects.toThrow(/Only a verified organization/);

    const org = await makeOrg(s, { status: "VERIFIED", declared: false });
    await rate(s.asAdmin, org);
    await expect(rate(s.asAdmin, org)).rejects.toThrow(/already been rated/);

    const own = await makeOrg(s, { status: "VERIFIED", declared: false, createdBy: s.ids.admin });
    await expect(rate(s.asAdmin, own)).rejects.toThrow(/organization you created/);
  });
});

describe("the MLRO's changes to an organization's rating", () => {
  async function rated(
    s: Setup,
    change: Parameters<typeof insertOrgRiskProfile>[1] extends infer I ? Partial<I> : never = {},
  ) {
    const org = await makeOrg(s, { status: "VERIFIED" });
    const profileId = await s.t.run((ctx) =>
      insertOrgRiskProfile(ctx, { organizationId: org, ratedBy: s.ids.mod, ...change } as never),
    );
    return { org, profileId };
  }

  describe("overriding the rating", () => {
    it("sets it with a reason, logs it, and moves the review date", async () => {
      const s = await setup();
      const { org } = await rated(s);

      await s.asAdmin.mutation(api.organizationRisk.overrideOrganizationRisk, {
        organizationId: org,
        rating: "HIGH",
        reason: "Adverse media about its founder.",
      });

      const profile = await profileOf(s.t, org);
      expect(profile).toMatchObject({
        rating: "HIGH",
        computedRating: "MEDIUM",
        overrideRating: "HIGH",
        overrideReason: "Adverse media about its founder.",
        ratedBy: s.ids.admin,
        eddReasons: ["HIGH_RISK"],
      });
      // High: reviewed yearly. And the EDD it now needs is not yet done.
      expect(profile!.nextReviewDue - profile!.ratedAt).toBe(365 * DAY_MS);
      expect(profile?.eddCompletedAt).toBeUndefined();

      const entry = (await logOf(s.t, org)).find((e) => e.action === "RISK_OVERRIDDEN");
      expect(entry).toMatchObject({ statusBefore: "MEDIUM", statusAfter: "HIGH" });
    });

    it("needs a reason, a real change, and the MLRO", async () => {
      const s = await setup();
      const { org } = await rated(s);
      const override = (who: Who, rating: "LOW" | "MEDIUM" | "HIGH", reason: string) =>
        who.mutation(api.organizationRisk.overrideOrganizationRisk, {
          organizationId: org,
          rating,
          reason,
        });
      await expect(override(s.asAdmin, "HIGH", "too short")).rejects.toThrow(/at least 10 characters/);
      await expect(override(s.asAdmin, "MEDIUM", "It is already Medium.")).rejects.toThrow(
        /already rated/,
      );
      await expect(override(s.asMod, "HIGH", "I am not the MLRO.")).rejects.toThrow(
        /Only the MLRO/,
      );
    });

    it("never takes a PEP below High (policy 7.2)", async () => {
      const s = await setup();
      const { org } = await rated(s, { pepOutcome: "PEP" });
      await expect(
        s.asAdmin.mutation(api.organizationRisk.overrideOrganizationRisk, {
          organizationId: org,
          rating: "LOW",
          reason: "Declared harmless by the chair.",
        }),
      ).rejects.toThrow(/always High risk/);
    });

    it("doesn't ask for the EDD again when lowering a rating that was High", async () => {
      const s = await setup();
      const { org } = await rated(s, { expectedAmountKes: 5_000_000 });
      expect((await profileOf(s.t, org))?.rating).toBe("HIGH");
      await s.asAdmin.mutation(api.organizationRisk.overrideOrganizationRisk, {
        organizationId: org,
        rating: "MEDIUM",
        reason: "Staged disbursements agreed with the board.",
      });
      const profile = await profileOf(s.t, org);
      expect(profile?.rating).toBe("MEDIUM");
      expect(profile?.eddReasons).toEqual([]);
    });
  });

  describe("flagging for enhanced due diligence", () => {
    it("requires it again, and payouts stop until it is recorded", async () => {
      const s = await setup();
      const { org } = await rated(s);
      const blockers = () =>
        s.t.run(async (ctx) => {
          const fundraiserId = await ctx.db.insert("fundraisers", {
            creatorId: s.ids.alice,
            organizationId: org,
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
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          const fundraiser = await ctx.db.get(fundraiserId);
          return (await getPayoutBlockers(ctx, fundraiser!, Date.now())).map((b) => b.code);
        });
      // Nothing about risk stands in its way. (It has no payout account here.)
      expect(await blockers()).not.toContain("EDD_REQUIRED");
      expect(await blockers()).not.toContain("RISK_NOT_RATED");

      await s.asAdmin.mutation(api.organizationRisk.flagOrganizationForEdd, {
        organizationId: org,
        reason: "A donor says the chair is not who they claim.",
      });

      const profile = await profileOf(s.t, org);
      expect(profile).toMatchObject({ mlroFlagged: true, eddReasons: ["MLRO_FLAGGED"] });
      expect(await blockers()).toContain("EDD_REQUIRED");

      await s.asAdmin.mutation(api.organizationRisk.recordOrganizationEdd, {
        organizationId: org,
        edd: { sourceOfFunds: FUNDS },
      });
      expect(await blockers()).not.toContain("EDD_REQUIRED");
    });

    it("needs a reason, isn't repeated, and is the MLRO's", async () => {
      const s = await setup();
      const { org } = await rated(s);
      const flag = (who: Who, reason: string) =>
        who.mutation(api.organizationRisk.flagOrganizationForEdd, {
          organizationId: org,
          reason,
        });
      await expect(flag(s.asAdmin, "no")).rejects.toThrow(/at least 10 characters/);
      await expect(flag(s.asMod, "Looks wrong to me.")).rejects.toThrow(/Only the MLRO/);
      await flag(s.asAdmin, "A donor says the chair is not who they claim.");
      await expect(flag(s.asAdmin, "Flagging it a second time.")).rejects.toThrow(
        /already flagged/,
      );
    });

    it("reopens EDD that was done for another reason", async () => {
      const s = await setup();
      const { org } = await rated(s, { residenceCountry: "GB" });
      expect((await profileOf(s.t, org))?.eddCompletedAt).toBeDefined();

      await s.asAdmin.mutation(api.organizationRisk.flagOrganizationForEdd, {
        organizationId: org,
        reason: "A donor says the chair is not who they claim.",
      });

      const profile = await profileOf(s.t, org);
      expect(profile?.eddReasons).toEqual(["NON_RESIDENT", "MLRO_FLAGGED"]);
      expect(profile?.eddCompletedAt).toBeUndefined();
    });
  });

  describe("recording enhanced due diligence", () => {
    it("records where the funds come from, and for a PEP where the wealth comes from", async () => {
      const s = await setup();
      const { org, profileId } = await rated(s, { pepOutcome: "PEP" });
      await s.t.run((ctx) =>
        ctx.db.patch(profileId, { eddCompletedAt: undefined, eddCompletedBy: undefined }),
      );
      const record = (who: Who, edd: Record<string, string>) =>
        who.mutation(api.organizationRisk.recordOrganizationEdd, {
          organizationId: org,
          edd: edd as never,
        });

      await expect(record(s.asAdmin, { sourceOfFunds: "short" })).rejects.toThrow(
        /where the funds come from/,
      );
      await expect(record(s.asAdmin, { sourceOfFunds: FUNDS })).rejects.toThrow(
        /source of wealth/,
      );
      await expect(record(s.asMod, { sourceOfFunds: FUNDS, sourceOfWealth: WEALTH })).rejects.toThrow(
        /Only the MLRO/,
      );

      await record(s.asAdmin, {
        sourceOfFunds: FUNDS,
        sourceOfWealth: WEALTH,
        note: "Checked against the registry.",
      });

      expect(await profileOf(s.t, org)).toMatchObject({
        sourceOfFunds: FUNDS,
        sourceOfWealth: WEALTH,
        eddNote: "Checked against the registry.",
        eddCompletedBy: s.ids.admin,
      });
      expect(
        (await logOf(s.t, org)).some((e) => e.action === "EDD_RECORDED"),
      ).toBe(true);
    });

    it("has nothing to record when none is waiting", async () => {
      const s = await setup();
      const { org } = await rated(s);
      await expect(
        s.asAdmin.mutation(api.organizationRisk.recordOrganizationEdd, {
          organizationId: org,
          edd: { sourceOfFunds: FUNDS },
        }),
      ).rejects.toThrow(/no enhanced due diligence waiting/);
    });
  });

  it("can't be done by the MLRO to an organization they created", async () => {
    const s = await setup();
    const org = await makeOrg(s, { status: "VERIFIED", createdBy: s.ids.admin });
    await s.t.run((ctx) =>
      insertOrgRiskProfile(ctx, { organizationId: org, ratedBy: s.ids.mod }),
    );
    await expect(
      s.asAdmin.mutation(api.organizationRisk.overrideOrganizationRisk, {
        organizationId: org,
        rating: "HIGH",
        reason: "Changing my own organization's rating.",
      }),
    ).rejects.toThrow(/organization you created/);
    await expect(
      s.asAdmin.mutation(api.organizationRisk.flagOrganizationForEdd, {
        organizationId: org,
        reason: "Flagging my own organization.",
      }),
    ).rejects.toThrow(/organization you created/);
  });

  it("can't be done to an organization that hasn't been rated", async () => {
    const s = await setup();
    const org = await makeOrg(s, { status: "VERIFIED" });
    await expect(
      s.asAdmin.mutation(api.organizationRisk.overrideOrganizationRisk, {
        organizationId: org,
        rating: "HIGH",
        reason: "There is no rating to change.",
      }),
    ).rejects.toThrow(/hasn't been rated/);
  });
});
