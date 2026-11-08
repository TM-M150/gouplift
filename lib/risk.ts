// Single source of truth for rating a customer's money-laundering risk (AML
// policy 4.3), when enhanced due diligence is needed (7, 8) and how often a
// customer is reviewed (5.10). Imported by the Convex backend, to decide, and
// by the staff review screen, to preview the same decision, so the two can
// never drift apart.
//
// Individuals are rated by assessRisk, organizations by assessOrganizationRisk.
// Both give the same shape of answer, so everything downstream (EDD, the review
// cycle, payout checks, the review screens) treats them alike.

import { HOME_COUNTRY } from "./countries";
import { tierPayoutLimitKes, type RequestableKycTier } from "./kyc";

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

const RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** The highest of the given levels. Policy 4.3: the highest factor sets the rating. */
export function maxRisk(...levels: RiskLevel[]): RiskLevel {
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "LOW");
}

// ---- What the fundraiser declares (policy 5.7) ----------------------------

export const EXPECTED_TIMELINES = [
  "WITHIN_1_MONTH",
  "ONE_TO_3_MONTHS",
  "THREE_TO_6_MONTHS",
  "SIX_TO_12_MONTHS",
  "OVER_12_MONTHS",
] as const;
export type ExpectedTimeline = (typeof EXPECTED_TIMELINES)[number];

export const EXPECTED_TIMELINE_LABELS: Record<ExpectedTimeline, string> = {
  WITHIN_1_MONTH: "Within a month",
  ONE_TO_3_MONTHS: "1 to 3 months",
  THREE_TO_6_MONTHS: "3 to 6 months",
  SIX_TO_12_MONTHS: "6 to 12 months",
  OVER_12_MONTHS: "More than a year",
};

// ---- What the reviewer decides --------------------------------------------

export const PEP_OUTCOMES = ["NOT_PEP", "PEP"] as const;
export type PepOutcome = (typeof PEP_OUTCOMES)[number];

export const PEP_OUTCOME_LABELS: Record<PepOutcome, string> = {
  NOT_PEP: "Not a PEP, and no PEP family member or close associate found",
  PEP: "A PEP, or a PEP's family member or close associate",
};

/** Policy 4.3, behaviour row: what the reviewer saw. */
export const BEHAVIOUR_LABELS: Record<RiskLevel, string> = {
  LOW: "Low: consistent with the stated purpose",
  MEDIUM: "Medium: minor unexplained variance",
  HIGH: "High: red flags, adverse media or evasiveness",
};

// ---- Geography (policy 4.3) -----------------------------------------------

// Jurisdictions rated High: FATF "call for action" and "increased monitoring",
// plus any the MLRO adds. This changes every few months, and policy 4.1 makes
// the MLRO responsible for keeping it current, so it lives here and nowhere
// else.
//
// Last set from FATF's June 2026 statements, less the four jurisdictions the
// October 2026 plenary removed (Bulgaria, Côte d'Ivoire, DR Congo, Monaco). Any
// October additions are NOT included: check the current FATF lists.
//
// Kenya was on FATF's increased monitoring list in June 2026 but is rated Low
// here, because policy 4.3 says so. That needs a decision from the Board.
export const HIGH_RISK_JURISDICTIONS: ReadonlySet<string> = new Set([
  // Call for action
  "KP", "IR", "MM",
  // Increased monitoring
  "AO", "BO", "BA", "CM", "HT", "IQ", "KW", "LA", "LB", "NP", "PG", "SS", "SY",
  "VE", "VN", "VG", "YE",
]);

export function geographyRisk(countryCode: string | null): RiskLevel {
  if (!countryCode) return "HIGH"; // Nothing declared, nothing to rate on.
  if (countryCode === HOME_COUNTRY) return "LOW";
  return HIGH_RISK_JURISDICTIONS.has(countryCode) ? "HIGH" : "MEDIUM";
}

// ---- Expected payout value (policy 4.3) -----------------------------------

/**
 * Low within the Level 1 limit, Medium within Level 2's, High above it. A
 * fundraiser being verified to Level 2 is expecting to be paid more than
 * Level 1 allows, so it is at least Medium whatever they declared.
 */
export function expectedValueRisk(
  expectedAmountKes: number | null,
  tier: RequestableKycTier,
): RiskLevel {
  const floor: RiskLevel = tier >= 2 ? "MEDIUM" : "LOW";
  if (expectedAmountKes === null) return "HIGH";
  const declared: RiskLevel =
    expectedAmountKes <= tierPayoutLimitKes(1)
      ? "LOW"
      : expectedAmountKes <= tierPayoutLimitKes(2)
        ? "MEDIUM"
        : "HIGH";
  return maxRisk(declared, floor);
}

// ---- Putting it together --------------------------------------------------

export interface RiskFactors {
  customerType: RiskLevel;
  expectedValue: RiskLevel;
  geography: RiskLevel;
  behaviour: RiskLevel;
}

export const EDD_REASONS = [
  "HIGH_RISK",
  "PEP",
  "NON_RESIDENT",
  "HIGH_RISK_JURISDICTION",
  "MLRO_FLAGGED",
] as const;
export type EddReason = (typeof EDD_REASONS)[number];

export const EDD_REASON_LABELS: Record<EddReason, string> = {
  HIGH_RISK: "Rated High risk",
  PEP: "Politically exposed person (or family or close associate)",
  NON_RESIDENT: "Lives or is registered outside Kenya",
  HIGH_RISK_JURISDICTION: "Connected to a high-risk jurisdiction",
  MLRO_FLAGGED: "Flagged by the MLRO",
};

export interface RiskInputs {
  /** As declared at Level 1; null if nothing was declared. */
  expectedAmountKes: number | null;
  /** ISO code as declared at Level 1; null if nothing was declared. */
  residenceCountry: string | null;
  /** The reviewer's PEP screening result (policy 7.1). */
  pepOutcome: PepOutcome;
  /** The reviewer's view of the fundraiser's behaviour. */
  behaviour: RiskLevel;
  /** The tier being approved. */
  tier: RequestableKycTier;
  /** Set by the MLRO to require EDD whatever the rating (policy 8.1). */
  mlroFlagged?: boolean;
  /** Set by the MLRO to replace the computed rating, with a reason on record. */
  overrideRating?: RiskLevel | null;
}

export interface RiskAssessment {
  factors: RiskFactors;
  /** What the factors give, before any override. */
  computedRating: RiskLevel;
  rating: RiskLevel;
  isPep: boolean;
  nonResident: boolean;
  eddReasons: EddReason[];
  /** Policy 8: needs the MLRO's approval and an EDD record before payouts. */
  requiresEdd: boolean;
}

interface Finish {
  residenceCountry: string | null;
  pepOutcome: PepOutcome;
  mlroFlagged?: boolean;
  overrideRating?: RiskLevel | null;
}

// What follows from the four factors, the same for every kind of customer:
// the highest one is the rating (policy 4.3), a PEP is always High (7.2), and
// the reasons that call for enhanced due diligence (8.1, 5.8).
function finishAssessment(
  factors: RiskFactors,
  input: Finish,
): RiskAssessment {
  const isPep = input.pepOutcome === "PEP";
  const nonResident = input.residenceCountry !== HOME_COUNTRY;
  const computedRating = maxRisk(
    factors.customerType,
    factors.expectedValue,
    factors.geography,
    factors.behaviour,
  );

  // Policy 7.2: PEP relationships are always High, whatever else is said.
  const rating = isPep ? "HIGH" : (input.overrideRating ?? computedRating);

  const eddReasons: EddReason[] = [];
  if (rating === "HIGH") eddReasons.push("HIGH_RISK");
  if (isPep) eddReasons.push("PEP");
  if (nonResident) eddReasons.push("NON_RESIDENT");
  if (factors.geography === "HIGH") eddReasons.push("HIGH_RISK_JURISDICTION");
  if (input.mlroFlagged) eddReasons.push("MLRO_FLAGGED");

  return {
    factors,
    computedRating,
    rating,
    isPep,
    nonResident,
    eddReasons,
    requiresEdd: eddReasons.length > 0,
  };
}

export function assessRisk(input: RiskInputs): RiskAssessment {
  const isPep = input.pepOutcome === "PEP";
  return finishAssessment(
    {
      // Policy 4.3: a PEP is High. Other individuals are Low.
      customerType: isPep ? "HIGH" : "LOW",
      expectedValue: expectedValueRisk(input.expectedAmountKes, input.tier),
      geography: geographyRisk(input.residenceCountry),
      behaviour: input.behaviour,
    },
    input,
  );
}

// ---- Organizations (policy 4.3, 5.4, 6, 7) --------------------------------

export interface OrganizationRiskInputs {
  /** What the organization expects to raise, as declared; null if nothing was. */
  expectedAmountKes: number | null;
  /** The country it is registered in; null if nothing was declared. */
  residenceCountry: string | null;
  /** The reviewer's PEP screening over its officials and beneficial owners. */
  pepOutcome: PepOutcome;
  /** The reviewer's view of how it has dealt with us. */
  behaviour: RiskLevel;
  /** Layered, trust-held or nominee ownership: a "complex structure". */
  complexStructure: boolean;
  /** A sector the MLRO treats as high risk. */
  highRiskSector: boolean;
  /** Nobody was found to own or control it (policy 6.2). */
  noOwnerIdentified: boolean;
  mlroFlagged?: boolean;
  overrideRating?: RiskLevel | null;
}

/**
 * Policy 4.3, customer type: a registered NGO, CBO, faith body or other
 * organization is Medium. Complex structures, high-risk sectors and PEPs are
 * High. Policy 6.2: with no identified owner it is no lower than Medium, which
 * a registered body already is, so that floor is kept here explicitly in case
 * the base level for registered bodies is ever lowered.
 */
export function organizationCustomerTypeRisk(
  input: Pick<
    OrganizationRiskInputs,
    "pepOutcome" | "complexStructure" | "highRiskSector" | "noOwnerIdentified"
  >,
): RiskLevel {
  if (
    input.pepOutcome === "PEP" ||
    input.complexStructure ||
    input.highRiskSector
  ) {
    return "HIGH";
  }
  const base: RiskLevel = "MEDIUM";
  return input.noOwnerIdentified ? maxRisk(base, "MEDIUM") : base;
}

export function assessOrganizationRisk(
  input: OrganizationRiskInputs,
): RiskAssessment {
  return finishAssessment(
    {
      customerType: organizationCustomerTypeRisk(input),
      // Organizations have no verification tier, so no tier floor.
      expectedValue: expectedValueRisk(input.expectedAmountKes, 1),
      geography: geographyRisk(input.residenceCountry),
      behaviour: input.behaviour,
    },
    input,
  );
}

export const FACTOR_LABELS: Record<keyof RiskFactors, string> = {
  customerType: "Customer type",
  expectedValue: "Expected payout value",
  geography: "Geography",
  behaviour: "Behaviour",
};

// ---- Review cycle (policy 5.10) -------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** High risk is reviewed yearly, Medium every two years, Low every three. */
export const REVIEW_INTERVAL_DAYS: Record<RiskLevel, number> = {
  HIGH: 365,
  MEDIUM: 2 * 365,
  LOW: 3 * 365,
};

export function nextReviewDue(rating: RiskLevel, ratedAt: number): number {
  return ratedAt + REVIEW_INTERVAL_DAYS[rating] * DAY_MS;
}

// ---- Enhanced due diligence (policy 8) ------------------------------------

export interface EddState {
  eddReasons: readonly EddReason[];
  eddCompletedAt?: number | null;
}

/**
 * Enhanced due diligence is needed and hasn't been done. Payouts wait until
 * the MLRO has approved the customer and recorded the source of their funds.
 */
export function isEddOutstanding(state: EddState): boolean {
  return state.eddReasons.length > 0 && state.eddCompletedAt == null;
}

/** A reason that wasn't there before means earlier EDD no longer covers it. */
export function hasNewEddReason(
  before: readonly EddReason[],
  after: readonly EddReason[],
): boolean {
  return after.some((reason) => !before.includes(reason));
}

// What the MLRO has to record (policy 7.2, 8.2): where the funds come from for
// everyone, and for a PEP where their wealth comes from as well.
export const MIN_EDD_TEXT_LENGTH = 10;
export const MAX_EDD_TEXT_LENGTH = 1000;

export function eddRecordProblem(input: {
  sourceOfFunds: string;
  sourceOfWealth?: string | null;
  isPep: boolean;
}): string | null {
  if (input.sourceOfFunds.trim().length < MIN_EDD_TEXT_LENGTH) {
    return "Record where the funds come from (at least 10 characters).";
  }
  if (input.isPep && (input.sourceOfWealth?.trim().length ?? 0) < MIN_EDD_TEXT_LENGTH) {
    return "A PEP needs their source of wealth recorded as well (at least 10 characters).";
  }
  return null;
}
