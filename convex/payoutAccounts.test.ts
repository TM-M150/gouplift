/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_OPEN_PAYOUT_ACCOUNTS,
  PAYOUT_ACCOUNT_CHANGE_HOLD_MS,
} from "../lib/payout-accounts";
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
const ALICE_PHONE = "+254712345678";
const OTHER_PHONE = "+254722000111";
const ALL_CHECKS = [
  "ACCOUNT_NAME_MATCHES",
  "PROOF_GENUINE",
  "BENEFICIARY_JUSTIFIED",
] as const;
const OWN_CHECKS = ["ACCOUNT_NAME_MATCHES", "PROOF_GENUINE"] as const;

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
    const approve = (
      userId: Id<"users">,
      tier: 1 | 2,
      extra: Partial<Doc<"kycSubmissions">> = {},
    ) =>
      ctx.db.insert("kycSubmissions", {
        userId,
        requestedTier: tier,
        status: "APPROVED",
        submittedAt: now,
        ...extra,
      });

    const alice = await user("auth_alice", "USER"); // Level 1
    const carol = await user("auth_carol", "USER"); // Level 2, owns the organization
    const bob = await user("auth_bob", "USER"); // not verified
    const dave = await user("auth_dave", "USER"); // a member of the organization
    const mod = await user("auth_mod", "MODERATOR");
    const admin = await user("auth_admin", "ADMIN");

    await approve(alice, 1, {
      legalName: "Wanjiru Kamau",
      idType: "NATIONAL_ID",
      idNumber: "12345678",
      phoneNumber: ALICE_PHONE,
    });
    await approve(carol, 1, {
      legalName: "Carol Otieno",
      idType: "NATIONAL_ID",
      idNumber: "23456789",
      phoneNumber: "+254733111222",
    });
    await approve(carol, 2, { kraPin: "A123456789Z" });
    // A staff member who is verified to Level 2 and can add their own account.
    await approve(mod, 1, {
      legalName: "Mo Derator",
      idType: "NATIONAL_ID",
      idNumber: "34567890",
      phoneNumber: "+254744222333",
    });
    await approve(mod, 2, { kraPin: "A987654321Z" });

    const organization = (
      name: string,
      verificationStatus: Doc<"organizations">["verificationStatus"],
    ) =>
      ctx.db.insert("organizations", {
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        verificationStatus,
        createdBy: carol,
        createdAt: now,
        updatedAt: now,
      });
    const org = await organization("Kajiado Youth Trust", "VERIFIED");
    const unverifiedOrg = await organization("Pending Trust", "PENDING_REVIEW");
    for (const organizationId of [org, unverifiedOrg]) {
      await ctx.db.insert("organizationMembers", {
        organizationId,
        userId: carol,
        role: "OWNER",
        joinedAt: now,
      });
    }
    await ctx.db.insert("organizationMembers", {
      organizationId: org,
      userId: dave,
      role: "MEMBER",
      joinedAt: now,
    });

    const fundraiser = (
      creatorId: Id<"users">,
      extra: Partial<Doc<"fundraisers">> = {},
    ) =>
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
        ...extra,
      });

    return {
      alice,
      carol,
      bob,
      dave,
      mod,
      admin,
      org,
      unverifiedOrg,
      aliceFundraiser: await fundraiser(alice),
      carolFundraiser: await fundraiser(carol),
      orgFundraiser: await fundraiser(dave, {
        organizationId: org,
        beneficiaryType: "ORGANIZATION",
        title: "Clean water",
      }),
    };
  });

  const as = (subject: string) => t.withIdentity({ subject });
  return {
    t,
    ids,
    asAlice: as("auth_alice"),
    asCarol: as("auth_carol"),
    asBob: as("auth_bob"),
    asDave: as("auth_dave"),
    asMod: as("auth_mod"),
    asAdmin: as("auth_admin"),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Who = Setup["asAlice"];

/** A file that has been uploaded and registered, waiting to be used. */
async function registeredFile(
  t: T,
  userId: Id<"users">,
  opts: { type?: string; bytes?: number } = {},
) {
  const { type = PDF, bytes = 2048 } = opts;
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type }),
    );
    await ctx.db.insert("pendingUploads", { storageId, userId });
    return storageId;
  });
}

const proofFor = async (t: T, userId: Id<"users">) => ({
  storageId: await registeredFile(t, userId),
  fileName: "mpesa-statement.pdf",
});

const MPESA = {
  method: "MPESA" as const,
  holder: "OWN" as const,
  accountName: "Wanjiru Kamau",
  mpesaNumber: "0722 000 111",
};
const BANK = {
  method: "BANK" as const,
  holder: "OWN" as const,
  accountName: "Carol Otieno",
  bankName: "Equity Bank",
  bankAccountNumber: "0123 4567 8901 2",
};

// Level 1's own account: the number a reviewer already confirmed.
const addVerifiedPhone = (who: Who) =>
  who.mutation(api.payoutAccounts.addPayoutAccount, {
    method: "MPESA",
    holder: "OWN",
    accountName: "Anything",
    mpesaNumber: "0712 345 678",
  });

const addWithProof = async (
  s: Setup,
  who: Who,
  userId: Id<"users">,
  details: Partial<
    Parameters<typeof s.asAlice.mutation<typeof api.payoutAccounts.addPayoutAccount>>[1]
  > & { method: "MPESA" | "BANK"; holder: "OWN" | "THIRD_PARTY"; accountName: string },
) =>
  who.mutation(api.payoutAccounts.addPayoutAccount, {
    ...details,
    proof: await proofFor(s.t, userId),
  });

const accounts = (t: T) =>
  t.run((ctx) => ctx.db.query("payoutAccounts").collect());
const selections = (t: T) =>
  t.run((ctx) => ctx.db.query("fundraiserPayoutAccounts").collect());
const auditEntries = (t: T) =>
  t.run((ctx) => ctx.db.query("adminAuditLog").collect());
const pendingRows = (t: T) =>
  t.run((ctx) => ctx.db.query("pendingUploads").collect());

const eligible = (t: T, fundraiserId: Id<"fundraisers">) =>
  t.run(async (ctx) => {
    await assertPayoutEligible(ctx, fundraiserId);
    return "allowed";
  });

// A verified account on Alice's side, for tests that need one in place.
async function aliceWithVerifiedAccount(s: Setup) {
  const { payoutAccountId } = await addVerifiedPhone(s.asAlice);
  return payoutAccountId;
}

// A second account for Carol, added and approved by the moderator.
async function carolWithTwoAccounts(s: Setup) {
  const first = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
  const second = await addWithProof(s, s.asCarol, s.ids.carol, BANK);
  for (const { payoutAccountId } of [first, second]) {
    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...OWN_CHECKS],
    });
  }
  return { first: first.payoutAccountId, second: second.payoutAccountId };
}

describe("addPayoutAccount: who may add what", () => {
  it("is for signed-in users only", async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.payoutAccounts.addPayoutAccount, {
        ...MPESA,
      }),
    ).rejects.toThrow(/signed in/);
    expect(await accounts(t)).toHaveLength(0);
  });

  it("needs identity verification first", async () => {
    const s = await setup();
    await expect(
      s.asBob.mutation(api.payoutAccounts.addPayoutAccount, { ...MPESA }),
    ).rejects.toThrow(/Verify your identity/);
    expect(await accounts(s.t)).toHaveLength(0);
  });

  it("verifies at once the mobile number confirmed at Level 1, and logs why", async () => {
    const s = await setup();
    const result = await addVerifiedPhone(s.asAlice);
    expect(result.status).toBe("VERIFIED");

    expect(await accounts(s.t)).toMatchObject([
      {
        userId: s.ids.alice,
        method: "MPESA",
        holder: "OWN",
        // The name the reviewer verified, not whatever was typed.
        accountName: "Wanjiru Kamau",
        mpesaNumber: ALICE_PHONE,
        status: "VERIFIED",
        verifiedVia: "KYC_PHONE",
      },
    ]);
    expect(await auditEntries(s.t)).toMatchObject([
      {
        action: "PAYOUT_ACCOUNT_APPROVED",
        actorId: s.ids.alice,
        statusAfter: "VERIFIED",
        note: expect.stringMatching(/^Automatic/),
      },
    ]);
  });

  it("holds Level 1 to that number: any other account needs Level 2", async () => {
    const s = await setup();
    for (const details of [
      MPESA,
      BANK,
      { ...MPESA, mpesaNumber: ALICE_PHONE, holder: "THIRD_PARTY" as const,
        justification: "It is the hospital's till for the bill." },
    ]) {
      await expect(
        s.asAlice.mutation(api.payoutAccounts.addPayoutAccount, {
          ...details,
          proof: await proofFor(s.t, s.ids.alice),
        }),
      ).rejects.toThrow(/Reach Level 2/);
    }
    expect(await accounts(s.t)).toHaveLength(0);
  });

  it("lets Level 2 add another account, which then waits for review", async () => {
    const s = await setup();
    const result = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    expect(result.status).toBe("PENDING_REVIEW");

    const [account] = await accounts(s.t);
    expect(account).toMatchObject({
      userId: s.ids.carol,
      method: "MPESA",
      mpesaNumber: OTHER_PHONE,
      accountName: "Wanjiru Kamau",
      status: "PENDING_REVIEW",
      proofFileName: "mpesa-statement.pdf",
      proofContentType: PDF,
      proofSize: 2048,
    });
    expect(account.verifiedVia).toBeUndefined();
    // The proof is the account's now, so nothing is left waiting to be swept.
    expect(await pendingRows(s.t)).toHaveLength(0);
  });

  it("keeps the verified-number shortcut to an individual's own account", async () => {
    const s = await setup();
    // Dave isn't verified at all, and Alice's number on an organization's
    // account is still the organization's account to be reviewed.
    await expect(
      s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
        organizationId: s.ids.org,
        method: "MPESA",
        holder: "OWN",
        accountName: "Carol Otieno",
        mpesaNumber: "0733 111 222",
        proof: await proofFor(s.t, s.ids.carol),
      }),
    ).resolves.toMatchObject({ status: "PENDING_REVIEW" });
  });
});

describe("addPayoutAccount: the details", () => {
  it("saves a bank account normalized, with the proof", async () => {
    const s = await setup();
    await addWithProof(s, s.asCarol, s.ids.carol, BANK);
    expect(await accounts(s.t)).toMatchObject([
      {
        method: "BANK",
        bankName: "Equity Bank",
        bankAccountNumber: "0123456789012",
        status: "PENDING_REVIEW",
      },
    ]);
  });

  it("rejects details that don't look right, saving nothing", async () => {
    const s = await setup();
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...MPESA, mpesaNumber: "071234" }, /Kenyan M-Pesa number/],
      [{ ...MPESA, mpesaNumber: undefined }, /Kenyan M-Pesa number/],
      [{ ...BANK, bankAccountNumber: "12AB" }, /6 to 20 digits/],
      [{ ...BANK, bankName: "" }, /name of the bank/],
      [{ ...MPESA, accountName: "W" }, /name on the account/],
      [{ ...MPESA, holder: "THIRD_PARTY" }, /Explain why/],
      [
        { ...MPESA, holder: "THIRD_PARTY", justification: "The hospital." },
        /Explain why/,
      ],
    ];
    for (const [details, message] of bad) {
      await expect(
        s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
          ...(details as typeof MPESA),
          proof: await proofFor(s.t, s.ids.carol),
        }),
      ).rejects.toThrow(message);
    }
    expect(await accounts(s.t)).toHaveLength(0);
  });

  it("accepts someone else's account with a justification", async () => {
    const s = await setup();
    await addWithProof(s, s.asCarol, s.ids.carol, {
      ...BANK,
      accountName: "Kajiado County Hospital",
      holder: "THIRD_PARTY",
      justification: "The hospital's own account, for the invoice attached to the campaign.",
    });
    expect(await accounts(s.t)).toMatchObject([
      {
        holder: "THIRD_PARTY",
        accountName: "Kajiado County Hospital",
        justification:
          "The hospital's own account, for the invoice attached to the campaign.",
      },
    ]);
  });
});

describe("addPayoutAccount: the proof", () => {
  it("is needed for any account that isn't the verified number", async () => {
    const s = await setup();
    await expect(
      s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, { ...MPESA }),
    ).rejects.toThrow(/Upload proof/);
    expect(await accounts(s.t)).toHaveLength(0);
  });

  it("can't be a file someone else registered", async () => {
    const s = await setup();
    await expect(
      s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
        ...MPESA,
        proof: await proofFor(s.t, s.ids.bob),
      }),
    ).rejects.toThrow(/wasn't uploaded properly/);
    expect(await accounts(s.t)).toHaveLength(0);
    // Bob's upload is untouched.
    expect(await pendingRows(s.t)).toHaveLength(1);
  });

  it("is checked again in storage, whatever was registered", async () => {
    const s = await setup();
    const storageId = await registeredFile(s.t, s.ids.carol, {
      type: "text/plain",
    });
    await expect(
      s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
        ...MPESA,
        proof: { storageId, fileName: "notes.txt" },
      }),
    ).rejects.toThrow(/isn't a supported file/);
    expect(await accounts(s.t)).toHaveLength(0);
  });

  it("can't be registered again once an account has claimed it", async () => {
    const s = await setup();
    const proof = await proofFor(s.t, s.ids.carol);
    await s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
      ...MPESA,
      proof,
    });
    const again = await s.asCarol.mutation(
      api.documentUploads.registerDocumentUpload,
      { storageId: proof.storageId, fileName: "again.pdf" },
    );
    expect(again.ok).toBe(false);
  });
});

describe("addPayoutAccount: limits", () => {
  it("won't add the same account twice, however the number is written", async () => {
    const s = await setup();
    await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await expect(
      addWithProof(s, s.asCarol, s.ids.carol, {
        ...MPESA,
        mpesaNumber: "+254722000111",
      }),
    ).rejects.toThrow(/already added/);
    await addWithProof(s, s.asCarol, s.ids.carol, BANK);
    await expect(
      addWithProof(s, s.asCarol, s.ids.carol, {
        ...BANK,
        bankName: "equity bank",
        bankAccountNumber: "0123456789012",
      }),
    ).rejects.toThrow(/already added/);
    expect(await accounts(s.t)).toHaveLength(2);
  });

  it("keeps the number of open accounts down, not counting closed or rejected ones", async () => {
    const s = await setup();
    const numbers = ["0722000001", "0722000002", "0722000003", "0722000004", "0722000005"];
    expect(numbers).toHaveLength(MAX_OPEN_PAYOUT_ACCOUNTS);

    const added = [];
    for (const mpesaNumber of numbers) {
      added.push(
        await addWithProof(s, s.asCarol, s.ids.carol, { ...MPESA, mpesaNumber }),
      );
    }
    await expect(
      addWithProof(s, s.asCarol, s.ids.carol, { ...MPESA, mpesaNumber: "0722000006" }),
    ).rejects.toThrow(/up to 5 payout accounts/);

    // A closed account frees a place, and so does a rejected one.
    await s.asCarol.mutation(api.payoutAccounts.closePayoutAccount, {
      payoutAccountId: added[0].payoutAccountId,
    });
    await s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
      payoutAccountId: added[1].payoutAccountId,
      reason: "The statement doesn't show this number.",
    });
    await addWithProof(s, s.asCarol, s.ids.carol, { ...MPESA, mpesaNumber: "0722000006" });
    await addWithProof(s, s.asCarol, s.ids.carol, { ...MPESA, mpesaNumber: "0722000007" });
    await expect(
      addWithProof(s, s.asCarol, s.ids.carol, { ...MPESA, mpesaNumber: "0722000008" }),
    ).rejects.toThrow(/up to 5 payout accounts/);
  });
});

describe("addPayoutAccount: for an organization", () => {
  const orgBank = (organizationId: Id<"organizations">) => ({
    organizationId,
    ...BANK,
    accountName: "Kajiado Youth Trust",
  });

  it("lets the organization's owner add one, to be reviewed", async () => {
    const s = await setup();
    const result = await s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
      ...orgBank(s.ids.org),
      proof: await proofFor(s.t, s.ids.carol),
    });
    expect(result.status).toBe("PENDING_REVIEW");
    expect(await accounts(s.t)).toMatchObject([
      { userId: s.ids.carol, organizationId: s.ids.org, status: "PENDING_REVIEW" },
    ]);
  });

  it("refuses a member who isn't the owner, and strangers", async () => {
    const s = await setup();
    for (const who of [s.asDave, s.asAlice, s.asBob, s.t]) {
      await expect(
        who.mutation(api.payoutAccounts.addPayoutAccount, {
          ...orgBank(s.ids.org),
          proof: await proofFor(s.t, s.ids.dave),
        }),
      ).rejects.toThrow(/owner can do this|signed in/);
    }
    expect(await accounts(s.t)).toHaveLength(0);
  });

  it("needs the organization to be verified first", async () => {
    const s = await setup();
    await expect(
      s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
        ...orgBank(s.ids.unverifiedOrg),
        proof: await proofFor(s.t, s.ids.carol),
      }),
    ).rejects.toThrow(/organization has to be verified/);
  });
});

describe("getMyPayoutAccounts", () => {
  it("is empty for someone who isn't signed in", async () => {
    const { t } = await setup();
    expect(await t.query(api.payoutAccounts.getMyPayoutAccounts, {})).toBeNull();
  });

  it("gives the tier and the verified number, and an empty list to start", async () => {
    const { asAlice, asBob } = await setup();
    expect(await asAlice.query(api.payoutAccounts.getMyPayoutAccounts, {})).toEqual({
      tier: 1,
      verifiedPhone: ALICE_PHONE,
      maxOpenAccounts: MAX_OPEN_PAYOUT_ACCOUNTS,
      personal: [],
      organizations: [],
    });
    expect(
      await asBob.query(api.payoutAccounts.getMyPayoutAccounts, {}),
    ).toMatchObject({ tier: 0, verifiedPhone: null });
  });

  it("shows a bank account with all but its last four digits hidden", async () => {
    const s = await setup();
    await addWithProof(s, s.asCarol, s.ids.carol, BANK);

    const mine = await s.asCarol.query(api.payoutAccounts.getMyPayoutAccounts, {});
    expect(mine?.personal).toMatchObject([
      { bankName: "Equity Bank", bankAccountMasked: "••••••••9012", status: "PENDING_REVIEW" },
    ]);
    expect(JSON.stringify(mine)).not.toContain("0123456789012");
  });

  it("lists an organization's accounts to its owner only", async () => {
    const s = await setup();
    await s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
      organizationId: s.ids.org,
      ...BANK,
      accountName: "Kajiado Youth Trust",
      proof: await proofFor(s.t, s.ids.carol),
    });

    const owner = await s.asCarol.query(api.payoutAccounts.getMyPayoutAccounts, {});
    expect(owner?.personal).toEqual([]);
    expect(owner?.organizations.map((o) => [o.name, o.isVerified, o.accounts.length])).toEqual([
      ["Kajiado Youth Trust", true, 1],
      ["Pending Trust", false, 0],
    ]);

    const member = await s.asDave.query(api.payoutAccounts.getMyPayoutAccounts, {});
    expect(member?.organizations).toEqual([]);
  });

  it("tells a rejected owner why, and leaves closed accounts out", async () => {
    const s = await setup();
    const rejected = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    const closed = await addWithProof(s, s.asCarol, s.ids.carol, BANK);
    await s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
      payoutAccountId: rejected.payoutAccountId,
      reason: "The statement doesn't show this number.",
    });
    await s.asCarol.mutation(api.payoutAccounts.closePayoutAccount, {
      payoutAccountId: closed.payoutAccountId,
    });

    const mine = await s.asCarol.query(api.payoutAccounts.getMyPayoutAccounts, {});
    expect(mine?.personal).toMatchObject([
      { status: "REJECTED", rejectionReason: "The statement doesn't show this number." },
    ]);
  });
});

describe("closePayoutAccount", () => {
  it("lets the owner remove an account, and keeps the row", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);
    await s.asAlice.mutation(api.payoutAccounts.closePayoutAccount, {
      payoutAccountId,
    });
    expect(await accounts(s.t)).toMatchObject([
      { status: "CLOSED", closedAt: expect.any(Number) },
    ]);
    await expect(
      s.asAlice.mutation(api.payoutAccounts.closePayoutAccount, { payoutAccountId }),
    ).rejects.toThrow(/can't be removed/);
  });

  it("is for the owner only", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);
    for (const who of [s.asBob, s.asCarol, s.t]) {
      await expect(
        who.mutation(api.payoutAccounts.closePayoutAccount, { payoutAccountId }),
      ).rejects.toThrow(/not found|signed in/);
    }
    expect((await accounts(s.t))[0].status).toBe("VERIFIED");
  });

  it("is for an organization's owner, not its other members", async () => {
    const s = await setup();
    const { payoutAccountId } = await s.asCarol.mutation(
      api.payoutAccounts.addPayoutAccount,
      {
        organizationId: s.ids.org,
        ...BANK,
        accountName: "Kajiado Youth Trust",
        proof: await proofFor(s.t, s.ids.carol),
      },
    );
    await expect(
      s.asDave.mutation(api.payoutAccounts.closePayoutAccount, { payoutAccountId }),
    ).rejects.toThrow(/not found/);
    await s.asCarol.mutation(api.payoutAccounts.closePayoutAccount, {
      payoutAccountId,
    });
    expect((await accounts(s.t))[0].status).toBe("CLOSED");
  });

  it("stops a fundraiser being payable until another account is chosen", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);
    await s.asAlice.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.aliceFundraiser,
      payoutAccountId,
    });
    expect(await eligible(s.t, s.ids.aliceFundraiser)).toBe("allowed");

    await s.asAlice.mutation(api.payoutAccounts.closePayoutAccount, {
      payoutAccountId,
    });
    await expect(eligible(s.t, s.ids.aliceFundraiser)).rejects.toThrow(
      /payout account hasn't been verified/,
    );
  });
});

describe("setFundraiserPayoutAccount", () => {
  it("chooses the first account without any pause", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);

    await s.asAlice.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.aliceFundraiser,
      payoutAccountId,
    });

    const [selection] = await selections(s.t);
    expect(selection).toMatchObject({
      fundraiserId: s.ids.aliceFundraiser,
      payoutAccountId,
      selectedBy: s.ids.alice,
    });
    expect(selection.changedAt).toBeUndefined();
    expect(await auditEntries(s.t)).toHaveLength(1); // only the automatic verification
    expect(await eligible(s.t, s.ids.aliceFundraiser)).toBe("allowed");
  });

  it("lets an account that is still waiting for review be chosen, but not paid to", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.carolFundraiser,
      payoutAccountId,
    });
    await expect(eligible(s.t, s.ids.carolFundraiser)).rejects.toThrow(
      /payout account hasn't been verified/,
    );

    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...OWN_CHECKS],
    });
    expect(await eligible(s.t, s.ids.carolFundraiser)).toBe("allowed");
  });

  it("choosing the same account again changes nothing", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);
    const choose = () =>
      s.asAlice.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
        fundraiserId: s.ids.aliceFundraiser,
        payoutAccountId,
      });
    await choose();
    await choose();
    expect(await selections(s.t)).toHaveLength(1);
    expect((await selections(s.t))[0].changedAt).toBeUndefined();
  });

  it("is for the fundraiser's owner only", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);
    for (const who of [s.asBob, s.asCarol, s.t]) {
      await expect(
        who.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
          fundraiserId: s.ids.aliceFundraiser,
          payoutAccountId,
        }),
      ).rejects.toThrow(/can't change where|signed in/);
    }
    expect(await selections(s.t)).toHaveLength(0);
  });

  it("only accepts the owner's own accounts", async () => {
    const s = await setup();
    const alices = await aliceWithVerifiedAccount(s);
    const { payoutAccountId: carols } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);

    // Another person's account, on a fundraiser of the right owner.
    await expect(
      s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
        fundraiserId: s.ids.carolFundraiser,
        payoutAccountId: alices,
      }),
    ).rejects.toThrow(/your own payout accounts/);
    // An organization's fundraiser can't be paid to a personal account, nor a
    // personal one to an organization's.
    await expect(
      s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
        fundraiserId: s.ids.orgFundraiser,
        payoutAccountId: carols,
      }),
    ).rejects.toThrow(/your own payout accounts/);
    const { payoutAccountId: orgAccount } = await s.asCarol.mutation(
      api.payoutAccounts.addPayoutAccount,
      {
        organizationId: s.ids.org,
        ...BANK,
        accountName: "Kajiado Youth Trust",
        proof: await proofFor(s.t, s.ids.carol),
      },
    );
    await expect(
      s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
        fundraiserId: s.ids.carolFundraiser,
        payoutAccountId: orgAccount,
      }),
    ).rejects.toThrow(/your own payout accounts/);
    expect(await selections(s.t)).toHaveLength(0);
  });

  it("lets an organization's owner choose its account, not the creator of the campaign", async () => {
    const s = await setup();
    const { payoutAccountId } = await s.asCarol.mutation(
      api.payoutAccounts.addPayoutAccount,
      {
        organizationId: s.ids.org,
        ...BANK,
        accountName: "Kajiado Youth Trust",
        proof: await proofFor(s.t, s.ids.carol),
      },
    );
    // Dave created the campaign but doesn't own the organization.
    await expect(
      s.asDave.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
        fundraiserId: s.ids.orgFundraiser,
        payoutAccountId,
      }),
    ).rejects.toThrow(/can't change where/);

    await s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.orgFundraiser,
      payoutAccountId,
    });
    expect(await selections(s.t)).toMatchObject([
      { fundraiserId: s.ids.orgFundraiser, payoutAccountId },
    ]);
  });

  it("won't use a rejected or closed account", async () => {
    const s = await setup();
    const rejected = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    const closed = await addWithProof(s, s.asCarol, s.ids.carol, BANK);
    await s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
      payoutAccountId: rejected.payoutAccountId,
      reason: "The statement doesn't show this number.",
    });
    await s.asCarol.mutation(api.payoutAccounts.closePayoutAccount, {
      payoutAccountId: closed.payoutAccountId,
    });
    for (const { payoutAccountId } of [rejected, closed]) {
      await expect(
        s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
          fundraiserId: s.ids.carolFundraiser,
          payoutAccountId,
        }),
      ).rejects.toThrow(/can't be used/);
    }
  });
});

describe("changing the payout account", () => {
  const choose = (s: Setup, payoutAccountId: Id<"payoutAccounts">) =>
    s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.carolFundraiser,
      payoutAccountId,
    });

  it("pauses payouts for a while, even to another verified account, and logs the change", async () => {
    const s = await setup();
    const { first, second } = await carolWithTwoAccounts(s);

    await choose(s, first);
    expect(await eligible(s.t, s.ids.carolFundraiser)).toBe("allowed");

    await choose(s, second);
    const selection = (await selections(s.t))[0];
    expect(selection).toMatchObject({
      payoutAccountId: second,
      changedAt: expect.any(Number),
    });
    await expect(eligible(s.t, s.ids.carolFundraiser)).rejects.toThrow(
      /payout account was changed recently/,
    );

    const changes = (await auditEntries(s.t)).filter(
      (e) => e.action === "PAYOUT_ACCOUNT_CHANGED",
    );
    expect(changes).toMatchObject([
      {
        actorId: s.ids.carol,
        fundraiserId: s.ids.carolFundraiser,
        payoutAccountId: second,
        statusBefore: "VERIFIED",
        statusAfter: "VERIFIED",
        note: expect.stringContaining("M-Pesa +254722000111"),
      },
    ]);
    // The log carries the masked account, never the full number.
    expect(changes[0].note).toContain("••••9012");
    expect(changes[0].note).not.toContain("0123456789012");

    vi.setSystemTime(
      Date.now() + PAYOUT_ACCOUNT_CHANGE_HOLD_MS + 60_000,
    );
    expect(await eligible(s.t, s.ids.carolFundraiser)).toBe("allowed");
  });

  it("makes a changed-to account that isn't verified wait for review as well", async () => {
    const s = await setup();
    const { first } = await carolWithTwoAccounts(s);
    await choose(s, first);

    const { payoutAccountId: fresh } = await addWithProof(s, s.asCarol, s.ids.carol, {
      ...MPESA,
      mpesaNumber: "0755 000 999",
    });
    await choose(s, fresh);

    vi.setSystemTime(Date.now() + PAYOUT_ACCOUNT_CHANGE_HOLD_MS + 60_000);
    // The pause is over, but the new account still hasn't been verified.
    await expect(eligible(s.t, s.ids.carolFundraiser)).rejects.toThrow(
      /payout account hasn't been verified/,
    );
    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId: fresh,
      confirmedChecks: [...OWN_CHECKS],
    });
    expect(await eligible(s.t, s.ids.carolFundraiser)).toBe("allowed");
  });

  it("isn't a change when the account swapped out was never verified", async () => {
    const s = await setup();
    const { payoutAccountId: pending } = await addWithProof(s, s.asCarol, s.ids.carol, {
      ...MPESA,
      mpesaNumber: "0755 000 111",
    });
    const { second } = await carolWithTwoAccounts(s);
    await choose(s, pending);

    await choose(s, second);

    expect((await selections(s.t))[0].changedAt).toBeUndefined();
    expect(
      (await auditEntries(s.t)).filter((e) => e.action === "PAYOUT_ACCOUNT_CHANGED"),
    ).toHaveLength(0);
    expect(await eligible(s.t, s.ids.carolFundraiser)).toBe("allowed");
  });
});

describe("getMyPayoutDestinations", () => {
  it("is empty for someone who isn't signed in", async () => {
    const { t } = await setup();
    expect(await t.query(api.payoutAccounts.getMyPayoutDestinations, {})).toBeNull();
  });

  it("lists the owner's fundraisers with the state of their account", async () => {
    const s = await setup();
    expect(
      await s.asAlice.query(api.payoutAccounts.getMyPayoutDestinations, {}),
    ).toEqual([
      {
        fundraiserId: s.ids.aliceFundraiser,
        title: "Water for Kajiado",
        status: "ACTIVE",
        organizationId: null,
        organizationName: null,
        payoutAccountId: null,
        accountStatus: null,
        changedAt: null,
      },
    ]);

    const payoutAccountId = await aliceWithVerifiedAccount(s);
    await s.asAlice.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.aliceFundraiser,
      payoutAccountId,
    });
    expect(
      await s.asAlice.query(api.payoutAccounts.getMyPayoutDestinations, {}),
    ).toMatchObject([{ payoutAccountId, accountStatus: "VERIFIED" }]);
  });

  it("includes an organization's fundraisers for its owner, not the member who made them", async () => {
    const s = await setup();
    const owner = await s.asCarol.query(api.payoutAccounts.getMyPayoutDestinations, {});
    expect(owner?.map((row) => [row.title, row.organizationName])).toEqual(
      expect.arrayContaining([["Clean water", "Kajiado Youth Trust"]]),
    );
    const member = await s.asDave.query(api.payoutAccounts.getMyPayoutDestinations, {});
    expect(member).toEqual([]);
  });

  it("says nothing about a staff hold", async () => {
    const s = await setup();
    const payoutAccountId = await aliceWithVerifiedAccount(s);
    await s.asAlice.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.aliceFundraiser,
      payoutAccountId,
    });
    const reason = "Donor reported that the story is copied from another campaign.";
    await s.asMod.mutation(api.admin.placePayoutHold, {
      fundraiserId: s.ids.aliceFundraiser,
      reason,
    });

    const json = JSON.stringify(
      await s.asAlice.query(api.payoutAccounts.getMyPayoutDestinations, {}),
    );
    expect(json).not.toContain(reason);
    expect(json).not.toMatch(/hold/i);
  });
});

describe("who can review", () => {
  it("shows the queue and the details to staff only", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);

    for (const outsider of [s.t, s.asAlice, s.asCarol, s.asBob]) {
      expect(
        await outsider.query(api.payoutAccountReview.listPayoutAccountsForReview, {
          status: "PENDING_REVIEW",
        }),
      ).toEqual([]);
      expect(
        await outsider.query(api.payoutAccountReview.getPayoutAccountForReview, {
          payoutAccountId,
        }),
      ).toBeNull();
    }
    expect(
      await s.asMod.query(api.payoutAccountReview.listPayoutAccountsForReview, {
        status: "PENDING_REVIEW",
      }),
    ).toHaveLength(1);
  });

  it("only lets staff decide", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    for (const outsider of [s.t, s.asAlice, s.asCarol, s.asBob]) {
      await expect(
        outsider.mutation(api.payoutAccountReview.approvePayoutAccount, {
          payoutAccountId,
          confirmedChecks: [...OWN_CHECKS],
        }),
      ).rejects.toThrow(/signed in|permission/);
      await expect(
        outsider.mutation(api.payoutAccountReview.rejectPayoutAccount, {
          payoutAccountId,
          reason: "Not good enough for us.",
        }),
      ).rejects.toThrow(/signed in|permission/);
    }
    expect((await accounts(s.t))[0].status).toBe("PENDING_REVIEW");
  });
});

describe("listPayoutAccountsForReview", () => {
  it("lists waiting accounts oldest first, and decided ones newest first", async () => {
    const s = await setup();
    const a = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const b = await s.asCarol.mutation(api.payoutAccounts.addPayoutAccount, {
      organizationId: s.ids.org,
      ...BANK,
      accountName: "Kajiado Youth Trust",
      proof: await proofFor(s.t, s.ids.carol),
    });

    const waiting = await s.asMod.query(
      api.payoutAccountReview.listPayoutAccountsForReview,
      { status: "PENDING_REVIEW" },
    );
    expect(waiting.map((row) => row._id)).toEqual([
      a.payoutAccountId,
      b.payoutAccountId,
    ]);
    expect(waiting.map((row) => [row.ownerName, row.isOrganization])).toEqual([
      ["auth_carol", false],
      ["Kajiado Youth Trust", true],
    ]);

    await s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
      payoutAccountId: a.payoutAccountId,
      reason: "The statement doesn't show this number.",
    });
    expect(
      (
        await s.asMod.query(api.payoutAccountReview.listPayoutAccountsForReview, {
          status: "REJECTED",
        })
      ).map((row) => row._id),
    ).toEqual([a.payoutAccountId]);
  });

  it("includes accounts that were verified automatically", async () => {
    const s = await setup();
    await aliceWithVerifiedAccount(s);
    expect(
      await s.asMod.query(api.payoutAccountReview.listPayoutAccountsForReview, {
        status: "VERIFIED",
      }),
    ).toMatchObject([{ verifiedVia: "KYC_PHONE", ownerName: "auth_alice" }]);
  });
});

describe("getPayoutAccountForReview", () => {
  it("gives staff the full details, a signed link to the proof and the identity on file", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, BANK);

    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review).toMatchObject({
      status: "PENDING_REVIEW",
      method: "BANK",
      holder: "OWN",
      accountName: "Carol Otieno",
      bankName: "Equity Bank",
      bankAccountNumber: "0123456789012",
      owner: { name: "auth_carol", email: "auth_carol@example.test" },
      organization: null,
      identityOnFile: { legalName: "Carol Otieno", idNumber: "23456789" },
      ownerTier: 2,
      requiredChecks: [...OWN_CHECKS],
      canDecide: true,
      decisionBlocked: null,
      sharedAccounts: [],
    });
    expect(review?.proof).toMatchObject({
      fileName: "mpesa-statement.pdf",
      contentType: PDF,
      size: 2048,
      url: expect.any(String),
    });
  });

  it("asks for one more check when the account is someone else's", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, {
      ...BANK,
      holder: "THIRD_PARTY",
      accountName: "Kajiado County Hospital",
      justification: "The hospital's own account, for the invoice attached to the campaign.",
    });
    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review?.requiredChecks).toEqual([...ALL_CHECKS]);
    expect(review?.justification).toContain("invoice");
  });

  it("reads an invalid id as not found", async () => {
    const { asMod } = await setup();
    expect(
      await asMod.query(api.payoutAccountReview.getPayoutAccountForReview, {
        payoutAccountId: "not-an-id",
      }),
    ).toBeNull();
  });

  it("flags the same number or account behind a different owner, but not the owner's own", async () => {
    const s = await setup();
    // The mobile number Alice verified at Level 1, put forward again by Carol.
    await addVerifiedPhone(s.asAlice);
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, {
      ...MPESA,
      mpesaNumber: ALICE_PHONE,
    });
    // Carol's own earlier try with the same number doesn't count against her.
    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review?.sharedAccounts).toMatchObject([
      { status: "VERIFIED", ownerName: "auth_alice" },
    ]);

    const other = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId: (await accounts(s.t))[0]._id },
    );
    expect(other?.sharedAccounts).toMatchObject([{ status: "PENDING_REVIEW" }]);
  });

  it("matches a bank account within the same bank only", async () => {
    const s = await setup();
    await addWithProof(s, s.asCarol, s.ids.carol, BANK);
    const { payoutAccountId } = await s.asCarol.mutation(
      api.payoutAccounts.addPayoutAccount,
      {
        organizationId: s.ids.org,
        ...BANK,
        bankName: "KCB Bank",
        accountName: "Kajiado Youth Trust",
        proof: await proofFor(s.t, s.ids.carol),
      },
    );
    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review?.sharedAccounts).toEqual([]);
  });

  it("shows which fundraisers are set to be paid to it", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.carolFundraiser,
      payoutAccountId,
    });
    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review?.fundraisersUsing).toMatchObject([
      { fundraiserId: s.ids.carolFundraiser, title: "Water for Kajiado" },
    ]);
  });
});

describe("approvePayoutAccount", () => {
  it("verifies the account, records who confirmed what, and logs it", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);

    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...OWN_CHECKS],
    });

    expect((await accounts(s.t))[0]).toMatchObject({
      status: "VERIFIED",
      verifiedVia: "STAFF_REVIEW",
      reviewedBy: s.ids.mod,
      reviewedAt: expect.any(Number),
      confirmedChecks: [...OWN_CHECKS],
    });
    expect(await auditEntries(s.t)).toMatchObject([
      {
        action: "PAYOUT_ACCOUNT_APPROVED",
        actorId: s.ids.mod,
        payoutAccountId,
        statusBefore: "PENDING_REVIEW",
        statusAfter: "VERIFIED",
      },
    ]);
  });

  it("won't approve until every check the account needs is confirmed", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, {
      ...BANK,
      holder: "THIRD_PARTY",
      accountName: "Kajiado County Hospital",
      justification: "The hospital's own account, for the invoice attached to the campaign.",
    });
    for (const confirmedChecks of [
      [],
      ["ACCOUNT_NAME_MATCHES"],
      [...OWN_CHECKS], // someone else's account needs the justification too
    ] as Array<Array<(typeof ALL_CHECKS)[number]>>) {
      await expect(
        s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
          payoutAccountId,
          confirmedChecks,
        }),
      ).rejects.toThrow(/Confirm each check/);
    }
    expect((await accounts(s.t))[0].status).toBe("PENDING_REVIEW");
    expect(await auditEntries(s.t)).toHaveLength(0);

    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...ALL_CHECKS],
    });
    expect((await accounts(s.t))[0].confirmedChecks).toEqual([...ALL_CHECKS]);
  });

  it("stores only the checks that belong to the account", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...ALL_CHECKS],
    });
    expect((await accounts(s.t))[0].confirmedChecks).toEqual([...OWN_CHECKS]);
  });

  it("refuses a decision that has already been made", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...OWN_CHECKS],
    });
    await expect(
      s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
        payoutAccountId,
        confirmedChecks: [...OWN_CHECKS],
      }),
    ).rejects.toThrow(/no longer waiting/);
    await expect(
      s.asAdmin.mutation(api.payoutAccountReview.rejectPayoutAccount, {
        payoutAccountId,
        reason: "Changed my mind about this one.",
      }),
    ).rejects.toThrow(/no longer waiting/);
    expect(await auditEntries(s.t)).toHaveLength(1);
  });

  it("won't let staff approve their own account", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asMod, s.ids.mod, MPESA);

    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review).toMatchObject({
      canDecide: false,
      decisionBlocked: "You can't review your own payout account.",
    });
    await expect(
      s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
        payoutAccountId,
        confirmedChecks: [...OWN_CHECKS],
      }),
    ).rejects.toThrow(/your own payout account/);
    await expect(
      s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
        payoutAccountId,
        reason: "Rejecting my own account.",
      }),
    ).rejects.toThrow(/your own payout account/);

    await s.asAdmin.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...OWN_CHECKS],
    });
    expect((await accounts(s.t))[0].status).toBe("VERIFIED");
  });

  it("won't verify an organization's account once the organization isn't verified", async () => {
    const s = await setup();
    const { payoutAccountId } = await s.asCarol.mutation(
      api.payoutAccounts.addPayoutAccount,
      {
        organizationId: s.ids.org,
        ...BANK,
        accountName: "Kajiado Youth Trust",
        proof: await proofFor(s.t, s.ids.carol),
      },
    );
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.org, { verificationStatus: "REJECTED" }),
    );

    const review = await s.asMod.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review).toMatchObject({
      canDecide: false,
      decisionBlocked: "The organization isn't verified.",
    });
    await expect(
      s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
        payoutAccountId,
        confirmedChecks: [...OWN_CHECKS],
      }),
    ).rejects.toThrow(/organization isn't verified/);
  });

  it("won't verify a personal account for someone below Level 2", async () => {
    const s = await setup();
    const payoutAccountId = await s.t.run((ctx) =>
      ctx.db.insert("payoutAccounts", {
        userId: s.ids.alice,
        method: "BANK",
        holder: "OWN",
        accountName: "Wanjiru Kamau",
        bankName: "Equity Bank",
        bankAccountNumber: "0123456789012",
        status: "PENDING_REVIEW",
        createdAt: Date.now(),
      }),
    );
    await expect(
      s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
        payoutAccountId,
        confirmedChecks: [...OWN_CHECKS],
      }),
    ).rejects.toThrow(/Level 2/);
  });

  it("lets a fundraiser be paid out once their chosen account is verified", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await s.asCarol.mutation(api.payoutAccounts.setFundraiserPayoutAccount, {
      fundraiserId: s.ids.carolFundraiser,
      payoutAccountId,
    });
    await expect(eligible(s.t, s.ids.carolFundraiser)).rejects.toThrow(
      /payout account hasn't been verified/,
    );
    await s.asMod.mutation(api.payoutAccountReview.approvePayoutAccount, {
      payoutAccountId,
      confirmedChecks: [...OWN_CHECKS],
    });
    expect(await eligible(s.t, s.ids.carolFundraiser)).toBe("allowed");
  });
});

describe("rejectPayoutAccount", () => {
  it("records the reason, who rejected, and logs it", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    const reason = "The statement doesn't show this number.";

    await s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
      payoutAccountId,
      reason,
    });

    expect((await accounts(s.t))[0]).toMatchObject({
      status: "REJECTED",
      reviewedBy: s.ids.mod,
      rejectionReason: reason,
    });
    expect(await auditEntries(s.t)).toMatchObject([
      {
        action: "PAYOUT_ACCOUNT_REJECTED",
        actorId: s.ids.mod,
        payoutAccountId,
        statusBefore: "PENDING_REVIEW",
        statusAfter: "REJECTED",
        note: reason,
      },
    ]);
  });

  it("needs a real reason", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    for (const reason of ["", "   ", "too short"]) {
      await expect(
        s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
          payoutAccountId,
          reason,
        }),
      ).rejects.toThrow(/at least 10 characters/);
    }
    expect((await accounts(s.t))[0].status).toBe("PENDING_REVIEW");
  });

  it("shows up in the review history", async () => {
    const s = await setup();
    const { payoutAccountId } = await addWithProof(s, s.asCarol, s.ids.carol, MPESA);
    await s.asMod.mutation(api.payoutAccountReview.rejectPayoutAccount, {
      payoutAccountId,
      reason: "The statement doesn't show this number.",
    });
    const review = await s.asAdmin.query(
      api.payoutAccountReview.getPayoutAccountForReview,
      { payoutAccountId },
    );
    expect(review?.status).toBe("REJECTED");
    expect(review?.history).toMatchObject([
      { action: "PAYOUT_ACCOUNT_REJECTED", actorName: "auth_mod" },
    ]);
  });
});
