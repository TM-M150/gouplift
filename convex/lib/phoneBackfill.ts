import { normalizeKenyanMobile } from "../../lib/phone";

// Tidying the phone numbers of accounts made before numbers had to be Kenyan
// and were kept as +254XXXXXXXXX. They were stored exactly as typed, and
// signing in by phone compares the typed number with the stored one exactly, so
// "0712 345 678" never found an account saved as "+254712345678" or the other
// way round.
//
// Nothing here guesses. A number that is a Kenyan mobile is rewritten in the
// stored form. A number that isn't one is left alone and reported, and so is
// one that would end up the same as another account's: two accounts can't hold
// the same number, and which of them is right is for a person to decide.

export interface StoredPhone {
  /** The sign-in account's id (better-auth's), which is how it is updated. */
  authUserId: string;
  phoneNumber: string;
}

export interface PhonePlan {
  /** Accounts with a number. */
  checked: number;
  /** Already in the stored form. */
  alreadyTidy: number;
  toUpdate: Array<{ authUserId: string; to: string }>;
  /** Not a Kenyan mobile number: left as it is. */
  notKenyan: string[];
  /** Would end up the same as another account's number: left as it is. */
  clashes: string[];
}

export function planPhoneBackfill(rows: readonly StoredPhone[]): PhonePlan {
  const plan: PhonePlan = {
    checked: 0,
    alreadyTidy: 0,
    toUpdate: [],
    notKenyan: [],
    clashes: [],
  };

  const tidyHolders = new Set<string>();
  const wanting = new Map<string, string[]>();

  for (const row of rows) {
    if (row.phoneNumber.trim() === "") continue;
    plan.checked += 1;

    const tidy = normalizeKenyanMobile(row.phoneNumber);
    if (tidy === null) {
      plan.notKenyan.push(row.authUserId);
    } else if (tidy === row.phoneNumber) {
      plan.alreadyTidy += 1;
      tidyHolders.add(tidy);
    } else {
      wanting.set(tidy, [...(wanting.get(tidy) ?? []), row.authUserId]);
    }
  }

  for (const [to, authUserIds] of wanting) {
    if (tidyHolders.has(to) || authUserIds.length > 1) {
      plan.clashes.push(...authUserIds);
    } else {
      plan.toUpdate.push({ authUserId: authUserIds[0], to });
    }
  }
  return plan;
}

export interface BackfillSummary {
  /** False for a dry run, which changes nothing. */
  applied: boolean;
  checked: number;
  alreadyTidy: number;
  /** Numbers that need rewriting. */
  toUpdate: number;
  /** Numbers rewritten (always 0 for a dry run). */
  updated: number;
  /** Ids only: phone numbers are kept out of logs and results. */
  notKenyan: string[];
  clashes: string[];
  failed: string[];
}

export interface BackfillDeps {
  /** Every account that has a number. */
  listPhones(): Promise<StoredPhone[]>;
  setPhone(authUserId: string, phoneNumber: string): Promise<void>;
}

/**
 * Plans the clean-up and, when asked, does it. One account failing doesn't stop
 * the rest, and running it again picks up what is left.
 */
export async function runPhoneBackfill(
  deps: BackfillDeps,
  options: { apply: boolean },
): Promise<BackfillSummary> {
  const plan = planPhoneBackfill(await deps.listPhones());
  const failed: string[] = [];
  let updated = 0;

  if (options.apply) {
    for (const { authUserId, to } of plan.toUpdate) {
      try {
        await deps.setPhone(authUserId, to);
        updated += 1;
      } catch {
        failed.push(authUserId);
      }
    }
  }

  return {
    applied: options.apply,
    checked: plan.checked,
    alreadyTidy: plan.alreadyTidy,
    toUpdate: plan.toUpdate.length,
    updated,
    notKenyan: plan.notKenyan,
    clashes: plan.clashes,
    failed,
  };
}
