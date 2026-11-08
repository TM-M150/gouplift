// Single source of truth for verifying an individual fundraiser (AML policy
// 5.1 to 5.3). Imported by the Convex backend, to enforce it, and by the
// verification form and the staff review screen, to render it, so the three
// can never drift apart. Organizations have their own rules in
// organization-verification.ts.

export type KycTier = 0 | 1 | 2 | 3;
/** The tiers a fundraiser can apply for. Tier 3 is reviewed case by case (policy 8). */
export type RequestableKycTier = 1 | 2;
export const REQUESTABLE_KYC_TIERS = [1, 2] as const;

// Cumulative payout limits in KES. Policy 5.3 marks these "proposed", pending
// the Sole Director's approval: change them here and nowhere else.
const TIER_PAYOUT_LIMIT_KES: Record<RequestableKycTier, number> = {
  1: 100_000,
  2: 1_000_000,
};

/**
 * The most a fundraiser at this tier can be paid in total. Tier 0 can be paid
 * nothing. Tier 3 has no fixed cap: each payout above Tier 2 needs the MLRO's
 * approval.
 */
export function tierPayoutLimitKes(tier: KycTier): number {
  if (tier === 0) return 0;
  if (tier === 3) return Number.POSITIVE_INFINITY;
  return TIER_PAYOUT_LIMIT_KES[tier];
}

// ---- Identity -------------------------------------------------------------

export const KYC_ID_TYPES = ["NATIONAL_ID", "PASSPORT"] as const;
export type KycIdType = (typeof KYC_ID_TYPES)[number];

export const KYC_ID_TYPE_LABELS: Record<KycIdType, string> = {
  NATIONAL_ID: "National ID",
  PASSPORT: "Passport",
};

/** Upper-case with spaces and dashes removed, so the same ID always compares equal. */
export function normalizeIdNumber(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

// Format checks only, to catch typos. The reviewer is the one who checks the
// number against the ID itself.
export function isPlausibleIdNumber(
  idType: KycIdType,
  normalized: string,
): boolean {
  return idType === "NATIONAL_ID"
    ? /^\d{6,10}$/.test(normalized)
    : /^[A-Z0-9]{6,12}$/.test(normalized);
}

/** A Kenyan mobile number as +254XXXXXXXXX, or null if it isn't one. */
export function normalizeKenyanMobile(value: string): string | null {
  const match = value.replace(/[\s()-]/g, "").match(/^(?:\+?254|0)([17]\d{8})$/);
  return match ? `+254${match[1]}` : null;
}

/** An ID number with all but the last three characters hidden, for showing back to its owner. */
export function maskIdNumber(normalized: string): string {
  return normalized.length <= 4
    ? "••••"
    : `${"•".repeat(normalized.length - 3)}${normalized.slice(-3)}`;
}

/** Upper-cased KRA PIN. Personal PINs start with A, entity PINs with P. */
export function normalizeKraPin(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}
export function isValidKraPin(normalized: string): boolean {
  return /^[AP]\d{9}[A-Z]$/.test(normalized);
}

// ---- Documents ------------------------------------------------------------

export const KYC_DOCUMENT_TYPES = [
  "ID_FRONT",
  "ID_BACK",
  "CAMPAIGN_EVIDENCE",
  "KRA_PIN_CERTIFICATE",
  "PAYOUT_ACCOUNT_PROOF",
] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export interface KycDocumentSlot {
  documentType: KycDocumentType;
  label: string;
  description: string;
  maxFiles: number;
  required: boolean;
}

/**
 * The ordered upload slots for a tier. Tier 1 depends on the ID type (a
 * passport has no back); Tier 2 builds on an approved Tier 1.
 */
export function getKycDocumentSlots(
  tier: RequestableKycTier,
  idType?: KycIdType,
): KycDocumentSlot[] {
  if (tier === 1) {
    const isPassport = idType === "PASSPORT";
    const slots: KycDocumentSlot[] = [
      {
        documentType: "ID_FRONT",
        label: isPassport ? "Passport photo page" : "National ID (front)",
        description: isPassport
          ? "The page with your photo and details. All four corners visible, nothing covered."
          : "A clear photo of the front of your ID. All four corners visible, nothing covered.",
        maxFiles: 1,
        required: true,
      },
    ];
    if (!isPassport) {
      slots.push({
        documentType: "ID_BACK",
        label: "National ID (back)",
        description: "A clear photo of the back of your ID.",
        maxFiles: 1,
        required: true,
      });
    }
    return slots;
  }

  return [
    {
      documentType: "CAMPAIGN_EVIDENCE",
      label: "Evidence for your campaign",
      description:
        "For example a hospital invoice, funeral notice, school fee structure, or a letter from your community or institution.",
      maxFiles: 3,
      required: true,
    },
    {
      documentType: "KRA_PIN_CERTIFICATE",
      label: "KRA PIN certificate",
      description: "Your personal KRA PIN certificate.",
      maxFiles: 1,
      required: true,
    },
    {
      documentType: "PAYOUT_ACCOUNT_PROOF",
      label: "Proof of your payout account",
      description:
        "A bank letter or statement header, or an M-Pesa statement or confirmation, showing the account is in your name (or the verified beneficiary's).",
      maxFiles: 1,
      required: true,
    },
  ];
}

// ---- Review ---------------------------------------------------------------

export const KYC_REVIEW_CHECKS = [
  "IDENTITY_MATCHES",
  "PHONE_IN_OWN_NAME",
  "PEP_SCREENED",
  "PURPOSE_NOT_PROHIBITED",
  "EVIDENCE_SUPPORTS_CAMPAIGN",
  "KRA_PIN_VALID",
  "PAYOUT_ACCOUNT_OWNERSHIP",
] as const;
export type KycReviewCheck = (typeof KYC_REVIEW_CHECKS)[number];

export const KYC_REVIEW_CHECK_LABELS: Record<KycReviewCheck, string> = {
  IDENTITY_MATCHES:
    "The ID looks genuine and is legible, and its name and number match what was entered",
  PHONE_IN_OWN_NAME:
    "The mobile number is registered in the fundraiser's own name",
  EVIDENCE_SUPPORTS_CAMPAIGN:
    "The evidence supports the campaign's story, purpose and amount",
  PEP_SCREENED:
    "Screened against PEP lists and adverse media, including family members and close associates",
  PURPOSE_NOT_PROHIBITED:
    "The stated purpose is not a prohibited activity (violence, terrorism, hate, trafficking, illegal weapons or drugs, illegal gambling, pyramid or Ponzi schemes, or any other unlawful purpose)",
  KRA_PIN_VALID: "The KRA PIN is valid and belongs to the fundraiser",
  PAYOUT_ACCOUNT_OWNERSHIP:
    "The payout account is in the fundraiser's name, or a verified beneficiary's",
};

/** What a reviewer has to confirm, and record, before approving each tier. */
export const REQUIRED_KYC_REVIEW_CHECKS: Record<
  RequestableKycTier,
  readonly KycReviewCheck[]
> = {
  1: [
    "IDENTITY_MATCHES",
    "PHONE_IN_OWN_NAME",
    "PEP_SCREENED",
    "PURPOSE_NOT_PROHIBITED",
  ],
  2: [
    "EVIDENCE_SUPPORTS_CAMPAIGN",
    "KRA_PIN_VALID",
    "PAYOUT_ACCOUNT_OWNERSHIP",
  ],
};

export type KycSubmissionStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";
