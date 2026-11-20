// What the profile's Impact tab adds up, shared by the Convex query that reads
// the data and the tab that shows it.
//
// - Given: the shillings a person gave to other people's fundraisers. A gift
//   to their own fundraiser is not counted here, because it is already part of
//   what that fundraiser raised.
// - Raised: what the fundraisers they started have raised, and how many
//   donations they received.
// - Impact: the two added together.
//
// Everything is in Kenyan shillings. A donation made in dollars is already
// stored as its shilling value (donations.grossAmount), and a fundraiser's
// total grows by the same figure, so what someone gave and what a fundraiser
// raised are measured the same way.

/** The most recent completed donations read for one person. */
export const MAX_IMPACT_DONATIONS = 500;
/** The most fundraisers read for one person. */
export const MAX_IMPACT_FUNDRAISERS = 200;

export interface ImpactDonation {
  fundraiserId: string;
  grossAmount: number;
}

export interface ImpactFundraiser {
  _id: string;
  currency: "KES" | "USD";
  amountRaised: number;
  /** Completed donations made to it. */
  donorCount: number;
}

export interface Impact {
  givenKes: number;
  raisedKes: number;
  /** Given plus raised. */
  totalKes: number;
  /** Other people's fundraisers they have given to. */
  fundraisersSupported: number;
  /** Completed donations made to their own fundraisers. */
  donationsReceived: number;
}

const round2 = (amount: number) => Math.round(amount * 100) / 100;

/**
 * Adds up a person's completed donations and the fundraisers they started.
 * Callers pass completed donations only.
 */
export function tallyImpact(
  donations: readonly ImpactDonation[],
  ownFundraisers: readonly ImpactFundraiser[],
): Impact {
  const own = new Set(ownFundraisers.map((fundraiser) => fundraiser._id));

  let given = 0;
  const supported = new Set<string>();
  for (const donation of donations) {
    if (own.has(donation.fundraiserId)) continue;
    given += donation.grossAmount;
    supported.add(donation.fundraiserId);
  }

  let raised = 0;
  let received = 0;
  for (const fundraiser of ownFundraisers) {
    // Shilling totals never take in a fundraiser kept in another currency,
    // the same rule as the totals on the homepage.
    if (fundraiser.currency === "KES") raised += fundraiser.amountRaised;
    received += fundraiser.donorCount;
  }

  return {
    givenKes: round2(given),
    raisedKes: round2(raised),
    totalKes: round2(given + raised),
    fundraisersSupported: supported.size,
    donationsReceived: received,
  };
}
