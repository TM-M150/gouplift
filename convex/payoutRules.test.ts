import { describe, expect, it } from "vitest";
import {
  PAYPAL_SETTLEMENT_DELAY_MS,
  addMoney,
  availableBalance,
  balanceShortfall,
  needsEnhancedApproval,
  payoutAmountProblem,
  roundMoney,
  settlesAt,
  tierRemainingKes,
  withdrawableKes,
} from "../lib/payouts";
import { toOwnerPayoutView, ownerSafePayoutMessage, GENERIC_PAYOUT_BLOCKED_MESSAGE } from "./lib/payouts";
import type { PayoutBlockerCode } from "./lib/payoutEligibility";
import type { Doc } from "./_generated/dataModel";

describe("money arithmetic", () => {
  it("adds in whole cents", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(roundMoney(1244.7500000001)).toBe(1244.75);
  });
});

describe("balanceShortfall", () => {
  it("is zero for a balance that isn't short, or none at all", () => {
    expect(balanceShortfall(null)).toBe(0);
    expect(balanceShortfall({ settledNet: 1000, reserved: 300, paid: 200 })).toBe(0);
    expect(balanceShortfall({ settledNet: 500, reserved: 300, paid: 200 })).toBe(0);
  });

  it("is how far below zero a refund after payout left it", () => {
    expect(balanceShortfall({ settledNet: 0, reserved: 0, paid: 950 })).toBe(950);
    expect(balanceShortfall({ settledNet: 100.1, reserved: 0.2, paid: 950 })).toBe(850.1);
  });

  it("and available is zero at the same time", () => {
    const balance = { settledNet: 0, reserved: 0, paid: 950 };
    expect(availableBalance(balance)).toBe(0);
  });
});

describe("availableBalance", () => {
  it("is settled money less what is set aside and paid", () => {
    expect(availableBalance({ settledNet: 1000, reserved: 300, paid: 200 })).toBe(500);
  });

  it("is zero without a balance, and never negative", () => {
    expect(availableBalance(null)).toBe(0);
    // A refund of money that was already paid out.
    expect(availableBalance({ settledNet: 0, reserved: 0, paid: 1000 })).toBe(0);
  });

  it("is withdrawn in whole shillings, rounding down", () => {
    expect(withdrawableKes(2500.99)).toBe(2500);
    expect(withdrawableKes(0.5)).toBe(0);
  });
});

describe("settlesAt", () => {
  const completed = 1_000_000;

  it("settles mobile money at once, and anything before provider was recorded", () => {
    expect(settlesAt("SASAPAY", completed)).toBe(completed);
    expect(settlesAt(undefined, completed)).toBe(completed);
  });

  it("holds PayPal for the delay", () => {
    expect(settlesAt("PAYPAL", completed)).toBe(completed + PAYPAL_SETTLEMENT_DELAY_MS);
    expect(PAYPAL_SETTLEMENT_DELAY_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

describe("the limit for a verification level", () => {
  it("leaves what has not yet been used", () => {
    expect(tierRemainingKes(1, 0)).toBe(100_000);
    expect(tierRemainingKes(1, 60_000)).toBe(40_000);
    expect(tierRemainingKes(2, 250_000)).toBe(750_000);
  });

  it("is zero at the limit, and when over it", () => {
    expect(tierRemainingKes(1, 100_000)).toBe(0);
    expect(tierRemainingKes(1, 130_000)).toBe(0);
  });

  it("has nothing to give an unverified owner, and no cap at Level 3", () => {
    expect(tierRemainingKes(0, 0)).toBe(0);
    expect(tierRemainingKes(3, 5_000_000)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("needsEnhancedApproval", () => {
  it("is only for Level 3, past the Level 2 limit", () => {
    expect(needsEnhancedApproval(3, 1_000_000)).toBe(false);
    expect(needsEnhancedApproval(3, 1_000_001)).toBe(true);
    // Lower levels are stopped by their cap instead.
    expect(needsEnhancedApproval(2, 1_000_001)).toBe(false);
    expect(needsEnhancedApproval(1, 5_000_000)).toBe(false);
  });
});

describe("payoutAmountProblem", () => {
  it("accepts a whole amount from the minimum up to what is withdrawable", () => {
    expect(payoutAmountProblem(250, 1000)).toBeNull();
    expect(payoutAmountProblem(1000, 1000)).toBeNull();
  });

  it("refuses anything else, in plain words", () => {
    expect(payoutAmountProblem(249, 1000)).toBe("The smallest payout is KES 250.");
    expect(payoutAmountProblem(300.5, 1000)).toMatch(/whole number/);
    expect(payoutAmountProblem(0, 1000)).toMatch(/whole number/);
    expect(payoutAmountProblem(-1, 1000)).toMatch(/whole number/);
    expect(payoutAmountProblem(Number.NaN, 1000)).toMatch(/whole number/);
    expect(payoutAmountProblem(1001, 1000)).toBe(
      "You can withdraw up to KES 1,000 right now.",
    );
    expect(payoutAmountProblem(300, 100)).toMatch(/isn't enough available/);
  });
});

describe("what an owner is told about a block", () => {
  const blockers = (...codes: PayoutBlockerCode[]) =>
    codes.map((code) => ({ code, message: "Staff wording." }));

  it("says nothing when nothing blocks", () => {
    expect(ownerSafePayoutMessage([])).toBeNull();
  });

  it("is actionable for things the owner can fix", () => {
    expect(ownerSafePayoutMessage(blockers("OWNER_NOT_VERIFIED"))).toMatch(/Verify your identity/);
    expect(ownerSafePayoutMessage(blockers("PAYOUT_ACCOUNT_MISSING"))).toMatch(/Choose where/);
  });

  it("is the same vague message for a hold, a missing risk rating or due diligence", () => {
    for (const code of ["ON_HOLD", "RISK_NOT_RATED", "EDD_REQUIRED"] as const) {
      expect(ownerSafePayoutMessage(blockers(code))).toBe(GENERIC_PAYOUT_BLOCKED_MESSAGE);
    }
  });

  it("never passes staff wording through", () => {
    const all: PayoutBlockerCode[] = [
      "ON_HOLD",
      "FUNDRAISER_STATUS",
      "OWNER_NOT_VERIFIED",
      "RISK_NOT_RATED",
      "EDD_REQUIRED",
      "ORGANIZATION_NOT_VERIFIED",
      "PAYOUT_ACCOUNT_MISSING",
      "PAYOUT_ACCOUNT_NOT_VERIFIED",
      "PAYOUT_ACCOUNT_MISMATCH",
      "PAYOUT_ACCOUNT_RECENTLY_CHANGED",
    ];
    for (const code of all) {
      expect(ownerSafePayoutMessage(blockers(code))).not.toContain("Staff wording");
    }
  });
});

describe("toOwnerPayoutView", () => {
  const base = {
    _id: "p1",
    amount: 1000,
    status: "REQUESTED",
    destination: "M-Pesa +254712345678",
    requestedAt: 5,
    // What staff wrote for themselves.
    approvedBy: "admin",
    approvalNote: "Source of funds checked.",
    failureReason: "Number not registered.",
    providerReference: "REF123",
    transferFeeAmount: 20,
    paidAt: 9,
    rejectionReason: "Because.",
  } as unknown as Doc<"payouts">;

  it("shows only what the owner may see", () => {
    const view = toOwnerPayoutView(base);

    expect(view).toEqual({
      _id: "p1",
      amount: 1000,
      status: "REQUESTED",
      destination: "M-Pesa +254712345678",
      requestedAt: 5,
      paidAt: null,
      providerReference: null,
      transferFeeAmount: null,
      received: null,
      rejectionReason: null,
    });
  });

  it("adds the reference and what arrived once paid", () => {
    const view = toOwnerPayoutView({ ...base, status: "PAID" });

    expect(view).toMatchObject({
      paidAt: 9,
      providerReference: "REF123",
      transferFeeAmount: 20,
      received: 980,
    });
  });

  it("gives the reason only for a rejection, never the failure reason", () => {
    expect(toOwnerPayoutView({ ...base, status: "REJECTED" }).rejectionReason).toBe("Because.");
    expect(JSON.stringify(toOwnerPayoutView({ ...base, status: "FAILED" }))).not.toContain(
      "Number not registered",
    );
  });
});
