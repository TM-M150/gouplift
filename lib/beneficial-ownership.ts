// Single source of truth for recording who owns or controls an organization
// (AML policy 5.4, 6). Imported by the Convex backend, to enforce it, and by
// the organization form and the staff review screen, to render it.

/** Policy 6.1: everyone who ultimately owns or controls this share or more. */
export const BENEFICIAL_OWNER_THRESHOLD_PERCENT = 10;

/** Only a sanity limit, so a typo can't fill the register. */
export const MAX_BENEFICIAL_OWNERS = 20;

export const BENEFICIAL_OWNER_BASES = [
  "OWNERSHIP",
  "CONTROL",
  "SENIOR_MANAGING_OFFICIAL",
] as const;
export type BeneficialOwnerBasis = (typeof BENEFICIAL_OWNER_BASES)[number];

export const BENEFICIAL_OWNER_BASIS_LABELS: Record<BeneficialOwnerBasis, string> =
  {
    OWNERSHIP: `Owns ${BENEFICIAL_OWNER_THRESHOLD_PERCENT}% or more, directly or indirectly`,
    CONTROL:
      "Controls it in another way (for example through a trust, a nominee, a veto, or by appointing the board)",
    SENIOR_MANAGING_OFFICIAL:
      "Senior managing official. Nobody owns or controls it (policy 6.2)",
  };

export interface OwnerLike {
  basis: BeneficialOwnerBasis;
  ownershipPercent?: number | null;
}

/**
 * Whether the register can be accepted as it stands, or what is wrong with it.
 * Policy 6: every person who owns or controls the organization is listed, and
 * only where nobody does is the senior managing official recorded instead.
 */
export function ownershipProblem(
  owners: readonly OwnerLike[],
): string | null {
  if (owners.length === 0) {
    return "List every person who owns or controls the organization. If nobody does, name its senior managing official.";
  }
  if (owners.length > MAX_BENEFICIAL_OWNERS) {
    return `List at most ${MAX_BENEFICIAL_OWNERS} people.`;
  }

  const officials = owners.filter((o) => o.basis === "SENIOR_MANAGING_OFFICIAL");
  if (officials.length > 1) {
    return "Name one senior managing official.";
  }
  if (officials.length === 1 && owners.length > 1) {
    return "A senior managing official is only recorded when nobody owns or controls the organization.";
  }

  let total = 0;
  for (const owner of owners) {
    const percent = owner.ownershipPercent;
    if (owner.basis === "OWNERSHIP") {
      if (
        percent === undefined ||
        percent === null ||
        percent < BENEFICIAL_OWNER_THRESHOLD_PERCENT ||
        percent > 100
      ) {
        return `Someone who owns it holds ${BENEFICIAL_OWNER_THRESHOLD_PERCENT}% to 100%.`;
      }
      total += percent;
    } else if (owner.basis === "SENIOR_MANAGING_OFFICIAL") {
      if (percent !== undefined && percent !== null) {
        return "A senior managing official has no ownership share.";
      }
    } else if (
      percent !== undefined &&
      percent !== null &&
      (percent <= 0 || percent > 100)
    ) {
      return "An ownership share is between 0% and 100%.";
    }
  }
  // A small tolerance for shares typed with decimals.
  if (total > 100 + 1e-9) {
    return "The ownership shares add up to more than 100%.";
  }
  return null;
}

/**
 * True when no natural person was found to own or control the organization.
 * Policy 6.2: it is then rated no lower than Medium and the senior managing
 * official stands in.
 */
export function hasNoIdentifiedOwner(owners: readonly OwnerLike[]): boolean {
  return !owners.some(
    (o) => o.basis === "OWNERSHIP" || o.basis === "CONTROL",
  );
}
