/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { KycDocumentType, KycIdType } from "../lib/kyc";
import { getKycTier } from "./lib/kycTier";
import { assertPayoutEligible } from "./lib/payoutEligibility";

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

const PDF = "application/pdf";
const DAY = 24 * 60 * 60 * 1000;

const TIER_1: {
  legalName: string;
  idType: KycIdType;
  idNumber: string;
  phoneNumber: string;
  campaignPurpose: string;
} = {
  legalName: "Wanjiru Kamau",
  idType: "NATIONAL_ID",
  idNumber: "12345678",
  phoneNumber: "0712 345 678",
  campaignPurpose: "School fees for my daughter's final year.",
};
const TIER_2 = { kraPin: "a123456789z" };

const ALL_CHECKS = [
  "IDENTITY_MATCHES",
  "PHONE_IN_OWN_NAME",
  "EVIDENCE_SUPPORTS_CAMPAIGN",
  "KRA_PIN_VALID",
  "PAYOUT_ACCOUNT_OWNERSHIP",
] as const;
const TIER_1_CHECKS = ["IDENTITY_MATCHES", "PHONE_IN_OWN_NAME"] as const;
const TIER_2_CHECKS = [
  "EVIDENCE_SUPPORTS_CAMPAIGN",
  "KRA_PIN_VALID",
  "PAYOUT_ACCOUNT_OWNERSHIP",
] as const;

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
    const user = (authUserId: string, role: "USER" | "MODERATOR" | "ADMIN") =>
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
      admin: await user("auth_admin", "ADMIN"),
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

/** A file that has been uploaded and registered, waiting to be submitted. */
async function registeredFile(
  t: T,
  userId: Id<"users">,
  opts: { type?: string; bytes?: number } = {},
) {
  const { type = PDF, bytes = 1024 } = opts;
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type }),
    );
    await ctx.db.insert("pendingUploads", { storageId, userId });
    return storageId;
  });
}

async function docs(t: T, userId: Id<"users">, types: KycDocumentType[]) {
  return await Promise.all(
    types.map(async (documentType) => ({
      documentType,
      storageId: await registeredFile(t, userId),
      fileName: `${documentType.toLowerCase()}.pdf`,
    })),
  );
}

const TIER_1_DOCS: KycDocumentType[] = ["ID_FRONT", "ID_BACK"];
const TIER_2_DOCS: KycDocumentType[] = [
  "CAMPAIGN_EVIDENCE",
  "KRA_PIN_CERTIFICATE",
  "PAYOUT_ACCOUNT_PROOF",
];

type Who = Setup["asAlice"];

async function submitTier1(
  s: Setup,
  who: Who,
  userId: Id<"users">,
  overrides: Partial<typeof TIER_1> = {},
) {
  const details = { ...TIER_1, ...overrides };
  return await who.mutation(api.kyc.submitKycTier1, {
    ...details,
    documents: await docs(
      s.t,
      userId,
      details.idType === "PASSPORT" ? ["ID_FRONT"] : TIER_1_DOCS,
    ),
  });
}

async function submitTier2(s: Setup, who: Who, userId: Id<"users">) {
  return await who.mutation(api.kyc.submitKycTier2, {
    ...TIER_2,
    documents: await docs(s.t, userId, TIER_2_DOCS),
  });
}

const submissions = (t: T) =>
  t.run((ctx) => ctx.db.query("kycSubmissions").collect());
const kycDocuments = (t: T) =>
  t.run((ctx) => ctx.db.query("kycDocuments").collect());
const pendingRows = (t: T) =>
  t.run((ctx) => ctx.db.query("pendingUploads").collect());
const auditEntries = (t: T) =>
  t.run((ctx) => ctx.db.query("adminAuditLog").collect());
const tierOf = (t: T, userId: Id<"users">) =>
  t.run((ctx) => getKycTier(ctx, userId));

async function approveTier1For(s: Setup, who: Who, userId: Id<"users">) {
  const { submissionId } = await submitTier1(s, who, userId);
  await s.asMod.mutation(api.kycReview.approveKyc, {
    submissionId,
    confirmedChecks: [...TIER_1_CHECKS],
  });
  return submissionId;
}

describe("getMyKyc", () => {
  it("is empty for someone who isn't signed in", async () => {
    const { t } = await setup();
    expect(await t.query(api.kyc.getMyKyc, {})).toBeNull();
  });

  it("starts a new fundraiser at tier 0, able to apply for tier 1", async () => {
    const { asAlice } = await setup();
    expect(await asAlice.query(api.kyc.getMyKyc, {})).toEqual({
      tier: 0,
      payoutLimitKes: 0,
      nextTier: 1,
      identity: null,
      pending: null,
      rejection: null,
    });
  });

  it("follows the tier they have been approved to", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);

    const afterOne = await s.asAlice.query(api.kyc.getMyKyc, {});
    expect(afterOne).toMatchObject({
      tier: 1,
      payoutLimitKes: 100_000,
      nextTier: 2,
    });

    const { submissionId } = await submitTier2(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_2_CHECKS],
    });
    expect(await s.asAlice.query(api.kyc.getMyKyc, {})).toMatchObject({
      tier: 2,
      payoutLimitKes: 1_000_000,
      nextTier: null,
    });
  });

  it("shows their own ID back with all but the last three characters hidden", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice, {
      idNumber: "29384756",
    });
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_1_CHECKS],
    });

    const mine = await s.asAlice.query(api.kyc.getMyKyc, {});
    expect(mine?.identity).toEqual({
      legalName: "Wanjiru Kamau",
      idType: "NATIONAL_ID",
      idNumberMasked: "•••••756",
      phoneNumber: "+254712345678",
    });
    expect(JSON.stringify(mine)).not.toContain("29384756");
  });

  it("reports a submission that is waiting for review", async () => {
    const s = await setup();
    await submitTier1(s, s.asAlice, s.ids.alice);
    expect(await s.asAlice.query(api.kyc.getMyKyc, {})).toMatchObject({
      tier: 0,
      pending: { requestedTier: 1, submittedAt: expect.any(Number) },
      rejection: null,
    });
  });

  it("gives a rejected applicant the reason, and nobody else's", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId,
      reason: "The photo of your ID is too blurry to read.",
    });

    expect(await s.asAlice.query(api.kyc.getMyKyc, {})).toMatchObject({
      tier: 0,
      pending: null,
      rejection: {
        requestedTier: 1,
        reason: "The photo of your ID is too blurry to read.",
      },
    });
    expect((await s.asBob.query(api.kyc.getMyKyc, {}))?.rejection).toBeNull();
  });
});

describe("submitKycTier1", () => {
  it("is for signed-in users only", async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.kyc.submitKycTier1, {
        ...TIER_1,
        documents: await docs(s.t, s.ids.alice, TIER_1_DOCS),
      }),
    ).rejects.toThrow(/signed in/);
    expect(await submissions(s.t)).toHaveLength(0);
  });

  it("saves the details normalized, keeps the documents, and claims the uploads", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice, {
      idNumber: "1234 5678",
    });

    expect(await submissions(s.t)).toMatchObject([
      {
        _id: submissionId,
        userId: s.ids.alice,
        requestedTier: 1,
        status: "PENDING_REVIEW",
        legalName: "Wanjiru Kamau",
        idType: "NATIONAL_ID",
        idNumber: "12345678",
        phoneNumber: "+254712345678",
        campaignPurpose: "School fees for my daughter's final year.",
        submittedAt: expect.any(Number),
      },
    ]);

    const files = await kycDocuments(s.t);
    expect(files.map((f) => f.documentType).sort()).toEqual([
      "ID_BACK",
      "ID_FRONT",
    ]);
    // The type and size come from storage, not from the browser.
    expect(files[0]).toMatchObject({
      submissionId,
      userId: s.ids.alice,
      contentType: PDF,
      size: 1024,
    });

    // The files are the submission's now, so nothing is left waiting.
    expect(await pendingRows(s.t)).toHaveLength(0);
  });

  it("only needs the photo page for a passport", async () => {
    const s = await setup();
    await submitTier1(s, s.asAlice, s.ids.alice, {
      idType: "PASSPORT",
      idNumber: "AK1234567",
    });
    expect((await kycDocuments(s.t)).map((f) => f.documentType)).toEqual([
      "ID_FRONT",
    ]);
  });

  it("refuses a back-of-ID photo for a passport", async () => {
    const s = await setup();
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, {
        ...TIER_1,
        idType: "PASSPORT",
        idNumber: "AK1234567",
        documents: await docs(s.t, s.ids.alice, TIER_1_DOCS),
      }),
    ).rejects.toThrow(/isn't needed/);
  });

  it("rejects details that don't look right, saving nothing", async () => {
    const s = await setup();
    const bad: Array<[Partial<typeof TIER_1>, RegExp]> = [
      [{ phoneNumber: "+44 7700 900123" }, /Kenyan mobile number/],
      [{ phoneNumber: "071234" }, /Kenyan mobile number/],
      [{ idNumber: "12" }, /6 to 10 digits/],
      [{ idNumber: "ABC12345" }, /6 to 10 digits/],
      [{ legalName: "W" }, /full name/],
      [{ campaignPurpose: "fees" }, /what the money is for/],
    ];
    for (const [overrides, message] of bad) {
      await expect(
        submitTier1(s, s.asAlice, s.ids.alice, overrides),
      ).rejects.toThrow(message);
    }
    expect(await submissions(s.t)).toHaveLength(0);
    expect(await kycDocuments(s.t)).toHaveLength(0);
  });

  it("needs every document the ID type asks for", async () => {
    const s = await setup();
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, {
        ...TIER_1,
        documents: await docs(s.t, s.ids.alice, ["ID_FRONT"]),
      }),
    ).rejects.toThrow(/Missing required documents: National ID \(back\)/);
    expect(await submissions(s.t)).toHaveLength(0);
  });

  it("refuses documents from another tier's list", async () => {
    const s = await setup();
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, {
        ...TIER_1,
        documents: await docs(s.t, s.ids.alice, [
          ...TIER_1_DOCS,
          "KRA_PIN_CERTIFICATE",
        ]),
      }),
    ).rejects.toThrow(/isn't needed/);
  });

  it("refuses the same file attached twice", async () => {
    const s = await setup();
    const [front] = await docs(s.t, s.ids.alice, ["ID_FRONT"]);
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, {
        ...TIER_1,
        documents: [front, { ...front, documentType: "ID_BACK" }],
      }),
    ).rejects.toThrow(/more than once/);
  });

  it("refuses a file that someone else registered", async () => {
    const s = await setup();
    const documents = await docs(s.t, s.ids.bob, TIER_1_DOCS);
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, { ...TIER_1, documents }),
    ).rejects.toThrow(/wasn't uploaded properly/);
    expect(await submissions(s.t)).toHaveLength(0);
    // Bob's uploads are untouched.
    expect(await pendingRows(s.t)).toHaveLength(2);
  });

  it("refuses a file that was never registered", async () => {
    const s = await setup();
    const documents = await docs(s.t, s.ids.alice, TIER_1_DOCS);
    const stray = await s.t.run((ctx) =>
      ctx.storage.store(new Blob([new Uint8Array(10)], { type: PDF })),
    );
    documents[0] = { ...documents[0], storageId: stray };
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, { ...TIER_1, documents }),
    ).rejects.toThrow(/wasn't uploaded properly/);
  });

  it("checks the file in storage again, whatever was registered", async () => {
    const s = await setup();
    const documents = await docs(s.t, s.ids.alice, TIER_1_DOCS);
    documents[0] = {
      ...documents[0],
      storageId: await registeredFile(s.t, s.ids.alice, {
        type: "text/plain",
      }),
    };
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier1, { ...TIER_1, documents }),
    ).rejects.toThrow(/isn't a supported file/);
    expect(await submissions(s.t)).toHaveLength(0);
  });

  it("allows one application at a time", async () => {
    const s = await setup();
    await submitTier1(s, s.asAlice, s.ids.alice);
    await expect(submitTier1(s, s.asAlice, s.ids.alice)).rejects.toThrow(
      /already being reviewed/,
    );
    expect(await submissions(s.t)).toHaveLength(1);
  });

  it("lets someone try again after a rejection, and keeps both records", async () => {
    const s = await setup();
    const first = await submitTier1(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId: first.submissionId,
      reason: "The photo of your ID is too blurry to read.",
    });

    await submitTier1(s, s.asAlice, s.ids.alice);
    expect((await submissions(s.t)).map((x) => x.status)).toEqual([
      "REJECTED",
      "PENDING_REVIEW",
    ]);
  });

  it("refuses someone who is already verified", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    await expect(submitTier1(s, s.asAlice, s.ids.alice)).rejects.toThrow(
      /already verified/,
    );
  });

  it("keeps one person's application out of another's tier", async () => {
    const s = await setup();
    await submitTier1(s, s.asAlice, s.ids.alice);
    expect(await tierOf(s.t, s.ids.alice)).toBe(0);
    expect(await tierOf(s.t, s.ids.bob)).toBe(0);
  });
});

describe("submitKycTier2", () => {
  it("needs an approved tier 1 first", async () => {
    const s = await setup();
    await expect(submitTier2(s, s.asAlice, s.ids.alice)).rejects.toThrow(
      /Verify your identity \(Tier 1\) first/,
    );

    // A tier 1 that is only waiting for review doesn't count.
    await submitTier1(s, s.asAlice, s.ids.alice);
    await expect(submitTier2(s, s.asAlice, s.ids.alice)).rejects.toThrow(
      /Tier 1\) first/,
    );
  });

  it("saves the KRA PIN normalized, with its three documents", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);

    const { submissionId } = await submitTier2(s, s.asAlice, s.ids.alice);

    const tierTwo = (await submissions(s.t)).find((x) => x._id === submissionId);
    expect(tierTwo).toMatchObject({
      requestedTier: 2,
      status: "PENDING_REVIEW",
      kraPin: "A123456789Z",
    });
    expect(
      (await kycDocuments(s.t))
        .filter((f) => f.submissionId === submissionId)
        .map((f) => f.documentType)
        .sort(),
    ).toEqual(["CAMPAIGN_EVIDENCE", "KRA_PIN_CERTIFICATE", "PAYOUT_ACCOUNT_PROOF"]);
  });

  it("accepts up to three pieces of campaign evidence, and no more", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    const base: KycDocumentType[] = [
      "KRA_PIN_CERTIFICATE",
      "PAYOUT_ACCOUNT_PROOF",
    ];

    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier2, {
        ...TIER_2,
        documents: await docs(s.t, s.ids.alice, [
          ...base,
          "CAMPAIGN_EVIDENCE",
          "CAMPAIGN_EVIDENCE",
          "CAMPAIGN_EVIDENCE",
          "CAMPAIGN_EVIDENCE",
        ]),
      }),
    ).rejects.toThrow(/at most 3 files/);

    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier2, {
        ...TIER_2,
        documents: await docs(s.t, s.ids.alice, [
          ...base,
          "CAMPAIGN_EVIDENCE",
          "CAMPAIGN_EVIDENCE",
          "CAMPAIGN_EVIDENCE",
        ]),
      }),
    ).resolves.toHaveProperty("submissionId");
  });

  it("rejects a KRA PIN that doesn't look like one", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier2, {
        kraPin: "12345",
        documents: await docs(s.t, s.ids.alice, TIER_2_DOCS),
      }),
    ).rejects.toThrow(/KRA PIN/);
  });

  it("needs all three documents", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    await expect(
      s.asAlice.mutation(api.kyc.submitKycTier2, {
        ...TIER_2,
        documents: await docs(s.t, s.ids.alice, ["KRA_PIN_CERTIFICATE"]),
      }),
    ).rejects.toThrow(/Missing required documents/);
  });

  it("refuses someone who is already at tier 2", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    const { submissionId } = await submitTier2(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_2_CHECKS],
    });
    await expect(submitTier2(s, s.asAlice, s.ids.alice)).rejects.toThrow(
      /already reached/,
    );
  });
});

describe("KYC files and the upload clean-up", () => {
  it("can't be registered again once a submission has claimed them", async () => {
    const s = await setup();
    const [front, back] = await docs(s.t, s.ids.alice, TIER_1_DOCS);
    await s.asAlice.mutation(api.kyc.submitKycTier1, {
      ...TIER_1,
      documents: [front, back],
    });

    const again = await s.asAlice.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId: front.storageId, fileName: "front.pdf" },
    );
    expect(again.ok).toBe(false);
  });

  it("never deletes a file that belongs to a submission", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    const [file] = await kycDocuments(s.t);
    // Even if a stale pending row pointed at it, the sweep must leave it.
    await s.t.run((ctx) =>
      ctx.db.insert("pendingUploads", {
        storageId: file.storageId,
        userId: s.ids.alice,
      }),
    );

    vi.setSystemTime(new Date(Date.now() + 3 * DAY));
    await s.t.mutation(internal.documentUploads.sweepStaleDocumentUploads, {});

    expect(
      await s.t.run(async (ctx) => ({
        stored: (await ctx.db.system.get("_storage", file.storageId)) !== null,
        submission: (await ctx.db.get(submissionId)) !== null,
      })),
    ).toEqual({ stored: true, submission: true });
  });
});

describe("who can review", () => {
  it("shows the queue and the details to staff only", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);

    for (const outsider of [s.t, s.asAlice, s.asBob]) {
      expect(
        await outsider.query(api.kycReview.listKycForReview, {
          status: "PENDING_REVIEW",
        }),
      ).toEqual([]);
      expect(
        await outsider.query(api.kycReview.getKycForReview, {
          submissionId,
        }),
      ).toBeNull();
    }
    expect(
      await s.asMod.query(api.kycReview.listKycForReview, {
        status: "PENDING_REVIEW",
      }),
    ).toHaveLength(1);
  });

  it("only lets staff decide", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);

    for (const outsider of [s.t, s.asAlice, s.asBob]) {
      await expect(
        outsider.mutation(api.kycReview.approveKyc, {
          submissionId,
          confirmedChecks: [...TIER_1_CHECKS],
        }),
      ).rejects.toThrow(/signed in|permission/);
      await expect(
        outsider.mutation(api.kycReview.rejectKyc, {
          submissionId,
          reason: "Not good enough for us.",
        }),
      ).rejects.toThrow(/signed in|permission/);
    }
    expect((await submissions(s.t))[0].status).toBe("PENDING_REVIEW");
  });
});

describe("listKycForReview", () => {
  it("lists waiting applications oldest first, and decided ones newest first", async () => {
    const s = await setup();
    const a = await submitTier1(s, s.asAlice, s.ids.alice);
    vi.setSystemTime(new Date(Date.now() + DAY));
    const b = await submitTier1(s, s.asBob, s.ids.bob, {
      idNumber: "87654321",
      phoneNumber: "0722 000 111",
    });

    const waiting = await s.asMod.query(api.kycReview.listKycForReview, {
      status: "PENDING_REVIEW",
    });
    expect(waiting.map((x) => x._id)).toEqual([a.submissionId, b.submissionId]);
    expect(waiting[0]).toMatchObject({
      requestedTier: 1,
      applicantName: "Wanjiru Kamau",
      documentCount: 2,
    });

    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId: a.submissionId,
      reason: "The photo of your ID is too blurry to read.",
    });
    expect(
      (
        await s.asMod.query(api.kycReview.listKycForReview, {
          status: "REJECTED",
        })
      ).map((x) => x._id),
    ).toEqual([a.submissionId]);
    expect(
      await s.asMod.query(api.kycReview.listKycForReview, {
        status: "APPROVED",
      }),
    ).toEqual([]);
  });
});

describe("getKycForReview", () => {
  it("gives staff the full details, signed file URLs and the checks to confirm", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review).toMatchObject({
      status: "PENDING_REVIEW",
      requestedTier: 1,
      applicant: { name: "auth_alice", email: "auth_alice@example.test" },
      details: {
        legalName: "Wanjiru Kamau",
        idType: "NATIONAL_ID",
        idNumber: "12345678",
        phoneNumber: "+254712345678",
      },
      requiredChecks: ["IDENTITY_MATCHES", "PHONE_IN_OWN_NAME"],
      canDecide: true,
      decisionBlocked: null,
      sharedIdentifiers: [],
    });
    expect(review?.documents).toHaveLength(2);
    expect(review?.documents.every((d) => typeof d.url === "string")).toBe(true);
  });

  it("reads an invalid id as not found", async () => {
    const { asMod } = await setup();
    expect(
      await asMod.query(api.kycReview.getKycForReview, {
        submissionId: "not-an-id",
      }),
    ).toBeNull();
  });

  it("shows a tier 2 reviewer the identity the application builds on", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    const { submissionId } = await submitTier2(s, s.asAlice, s.ids.alice);

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review).toMatchObject({
      requestedTier: 2,
      details: { kraPin: "A123456789Z" },
      identityOnFile: { legalName: "Wanjiru Kamau", idNumber: "12345678" },
      requiredChecks: [...TIER_2_CHECKS],
    });
  });

  it("flags the same ID or phone number on another account", async () => {
    const s = await setup();
    await submitTier1(s, s.asAlice, s.ids.alice);
    const { submissionId } = await submitTier1(s, s.asBob, s.ids.bob, {
      legalName: "Someone Else",
      phoneNumber: "0712345678",
    });

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review?.sharedIdentifiers.map((m) => m.matchedOn).sort()).toEqual([
      "ID_NUMBER",
      "PHONE_NUMBER",
    ]);
    expect(review?.sharedIdentifiers[0]).toMatchObject({
      userName: "auth_alice",
      status: "PENDING_REVIEW",
      requestedTier: 1,
    });
  });

  it("doesn't count a person's own earlier application as shared", async () => {
    const s = await setup();
    const first = await submitTier1(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId: first.submissionId,
      reason: "The photo of your ID is too blurry to read.",
    });
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review?.sharedIdentifiers).toEqual([]);
  });
});

describe("approveKyc", () => {
  it("approves tier 1, records who confirmed what, and logs it", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);

    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_1_CHECKS],
    });

    expect((await submissions(s.t))[0]).toMatchObject({
      status: "APPROVED",
      reviewedBy: s.ids.mod,
      reviewedAt: expect.any(Number),
      confirmedChecks: [...TIER_1_CHECKS],
    });
    expect(await auditEntries(s.t)).toMatchObject([
      {
        action: "KYC_APPROVED",
        actorId: s.ids.mod,
        kycSubmissionId: submissionId,
        statusBefore: "PENDING_REVIEW",
        statusAfter: "APPROVED",
        note: "Tier 1",
      },
    ]);
    expect(await tierOf(s.t, s.ids.alice)).toBe(1);
  });

  it("won't approve until every check the tier needs is confirmed", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);

    for (const confirmedChecks of [
      [],
      ["IDENTITY_MATCHES"],
      // Checks that belong to another tier don't stand in for this one's.
      ["IDENTITY_MATCHES", "KRA_PIN_VALID"],
    ] as Array<Array<(typeof ALL_CHECKS)[number]>>) {
      await expect(
        s.asMod.mutation(api.kycReview.approveKyc, {
          submissionId,
          confirmedChecks,
        }),
      ).rejects.toThrow(/Confirm each check/);
    }
    expect((await submissions(s.t))[0].status).toBe("PENDING_REVIEW");
    expect(await auditEntries(s.t)).toHaveLength(0);
  });

  it("stores only the checks that belong to the tier", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...ALL_CHECKS],
    });
    expect((await submissions(s.t))[0].confirmedChecks).toEqual([
      ...TIER_1_CHECKS,
    ]);
  });

  it("approves tier 2 on top of tier 1", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    const { submissionId } = await submitTier2(s, s.asAlice, s.ids.alice);

    await s.asAdmin.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_2_CHECKS],
    });
    expect(await tierOf(s.t, s.ids.alice)).toBe(2);
    expect((await auditEntries(s.t)).map((e) => e.note)).toEqual([
      "Tier 1",
      "Tier 2",
    ]);
  });

  it("won't approve tier 2 without an approved tier 1", async () => {
    const s = await setup();
    const submissionId = await s.t.run((ctx) =>
      ctx.db.insert("kycSubmissions", {
        userId: s.ids.alice,
        requestedTier: 2,
        status: "PENDING_REVIEW",
        kraPin: "A123456789Z",
        submittedAt: Date.now(),
      }),
    );
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        confirmedChecks: [...TIER_2_CHECKS],
      }),
    ).rejects.toThrow(/Tier 1\) has to be approved first/);
    expect(await tierOf(s.t, s.ids.alice)).toBe(0);
  });

  it("refuses a decision that has already been made", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_1_CHECKS],
    });

    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        confirmedChecks: [...TIER_1_CHECKS],
      }),
    ).rejects.toThrow(/no longer waiting/);
    await expect(
      s.asMod.mutation(api.kycReview.rejectKyc, {
        submissionId,
        reason: "Changed my mind about this one.",
      }),
    ).rejects.toThrow(/no longer waiting/);
    expect(await auditEntries(s.t)).toHaveLength(1);
  });

  it("won't let staff approve their own verification", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asMod, s.ids.mod);

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review).toMatchObject({
      canDecide: false,
      decisionBlocked: "You can't review your own verification.",
    });
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        confirmedChecks: [...TIER_1_CHECKS],
      }),
    ).rejects.toThrow(/your own verification/);
    await expect(
      s.asMod.mutation(api.kycReview.rejectKyc, {
        submissionId,
        reason: "Rejecting my own application.",
      }),
    ).rejects.toThrow(/your own verification/);

    // Another member of staff can.
    await s.asAdmin.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_1_CHECKS],
    });
    expect(await tierOf(s.t, s.ids.mod)).toBe(1);
  });

  it("won't verify an ID that is already verified on another account", async () => {
    const s = await setup();
    await approveTier1For(s, s.asAlice, s.ids.alice);
    const { submissionId } = await submitTier1(s, s.asBob, s.ids.bob, {
      phoneNumber: "0722 000 111",
    });

    const review = await s.asMod.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review).toMatchObject({
      canDecide: false,
      decisionBlocked: expect.stringMatching(/already verified on another account/),
    });
    await expect(
      s.asMod.mutation(api.kycReview.approveKyc, {
        submissionId,
        confirmedChecks: [...TIER_1_CHECKS],
      }),
    ).rejects.toThrow(/already verified on another account/);
    expect(await tierOf(s.t, s.ids.bob)).toBe(0);

    // It can still be rejected.
    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId,
      reason: "We couldn't verify these details.",
    });
  });

  it("lets payouts through only once the owner is approved", async () => {
    const s = await setup();
    const fundraiserId = await s.t.run((ctx) =>
      ctx.db.insert("fundraisers", {
        creatorId: s.ids.alice,
        beneficiaryType: "SELF",
        title: "School fees",
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
    const check = () =>
      s.t.run(async (ctx) => {
        await assertPayoutEligible(ctx, fundraiserId);
        return "allowed";
      });

    await expect(check()).rejects.toThrow(/owner hasn't been verified/);

    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    await expect(check()).rejects.toThrow(/owner hasn't been verified/);

    await s.asMod.mutation(api.kycReview.approveKyc, {
      submissionId,
      confirmedChecks: [...TIER_1_CHECKS],
    });
    expect(await check()).toBe("allowed");
  });
});

describe("rejectKyc", () => {
  it("records the reason, who rejected, and logs it", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    const reason = "The photo of your ID is too blurry to read.";

    await s.asMod.mutation(api.kycReview.rejectKyc, { submissionId, reason });

    expect((await submissions(s.t))[0]).toMatchObject({
      status: "REJECTED",
      reviewedBy: s.ids.mod,
      reviewedAt: expect.any(Number),
      rejectionReason: reason,
    });
    expect(await auditEntries(s.t)).toMatchObject([
      {
        action: "KYC_REJECTED",
        actorId: s.ids.mod,
        kycSubmissionId: submissionId,
        statusBefore: "PENDING_REVIEW",
        statusAfter: "REJECTED",
        note: reason,
      },
    ]);
    expect(await tierOf(s.t, s.ids.alice)).toBe(0);
  });

  it("needs a real reason", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    for (const reason of ["", "   ", "too short"]) {
      await expect(
        s.asMod.mutation(api.kycReview.rejectKyc, { submissionId, reason }),
      ).rejects.toThrow(/at least 10 characters/);
    }
    expect((await submissions(s.t))[0].status).toBe("PENDING_REVIEW");
  });

  it("shows up in the review history", async () => {
    const s = await setup();
    const { submissionId } = await submitTier1(s, s.asAlice, s.ids.alice);
    await s.asMod.mutation(api.kycReview.rejectKyc, {
      submissionId,
      reason: "The photo of your ID is too blurry to read.",
    });

    const review = await s.asAdmin.query(api.kycReview.getKycForReview, {
      submissionId,
    });
    expect(review?.status).toBe("REJECTED");
    expect(review?.history).toMatchObject([
      { action: "KYC_REJECTED", actorName: "auth_mod" },
    ]);
  });
});
