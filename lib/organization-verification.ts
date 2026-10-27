// Single source of truth for what an organization must upload to be verified.
// Imported by both the Convex backend (to enforce it) and the create-org form
// (to render the right upload slots), so the two can never drift apart.

export const ORGANIZATION_TYPES = [
  "REGISTERED_COMPANY",
  "PBO",
  "SOCIETY",
  "TRUST",
  "CBO_SELF_HELP",
  "OTHER",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const DOCUMENT_TYPES = [
  "REGISTRATION_CERTIFICATE",
  "GOVERNING_DOCUMENT",
  "CR12",
  "KRA_PIN",
  "PAYOUT_ACCOUNT_PROOF",
  "AUTHORISATION_RESOLUTION",
  "OFFICIAL_IDS",
  "TAX_EXEMPTION",
  "ANNUAL_ACCOUNTS",
  "REGULATOR_LETTER",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const ACCEPTED_FILE_INPUT = ".pdf,.jpg,.jpeg,.png,.webp";

interface DocumentInfo {
  label: string;
  description: string;
  /** How many files this slot accepts (e.g. front + back of several IDs). */
  maxFiles: number;
}

const DOCUMENT_INFO: Record<DocumentType, DocumentInfo> = {
  REGISTRATION_CERTIFICATE: {
    label: "Registration certificate",
    description: "The certificate issued when your organization was registered.",
    maxFiles: 1,
  },
  GOVERNING_DOCUMENT: {
    label: "Constitution or governing document",
    description:
      "Your constitution, trust deed, or memorandum and articles of association.",
    maxFiles: 1,
  },
  CR12: {
    label: "CR12 (company search)",
    description:
      "A recent CR12 listing your directors, ideally issued in the last 3 months.",
    maxFiles: 1,
  },
  KRA_PIN: {
    label: "KRA PIN certificate",
    description: "The organization's KRA PIN certificate, not a personal one.",
    maxFiles: 1,
  },
  PAYOUT_ACCOUNT_PROOF: {
    label: "Proof of payout account",
    description:
      "A bank letter, statement header, or cheque leaf (or an M-Pesa Paybill/Till confirmation) showing the exact registered organization name.",
    maxFiles: 1,
  },
  AUTHORISATION_RESOLUTION: {
    label: "Authorising resolution or minutes",
    description:
      "A signed (and stamped) resolution naming you as authorised to register on GoUplift and receive funds, and listing the officials.",
    maxFiles: 1,
  },
  OFFICIAL_IDS: {
    label: "IDs of you and another official",
    description:
      "National ID or passport (front and back) for you and at least one other official or bank signatory.",
    maxFiles: 4,
  },
  TAX_EXEMPTION: {
    label: "KRA tax-exemption certificate",
    description: "If your organization has been granted tax-exempt status.",
    maxFiles: 1,
  },
  ANNUAL_ACCOUNTS: {
    label: "Latest audited accounts or annual report",
    description:
      "Your most recent audited accounts or annual report. It builds donor trust.",
    maxFiles: 1,
  },
  REGULATOR_LETTER: {
    label: "Regulator good-standing letter",
    description:
      "A letter from your regulator (e.g. Ministry of Education) confirming you are in good standing.",
    maxFiles: 1,
  },
};

interface TypeRequirements {
  label: string;
  /** Who registers this kind of organization — shown as a hint in the form. */
  hint: string;
  required: readonly DocumentType[];
  optional: readonly DocumentType[];
  /** Per-type wording for a document (the registration certificate differs). */
  overrides?: Partial<Record<DocumentType, Partial<DocumentInfo>>>;
}

// Documents every organization must supply, whatever its type.
const ALWAYS_REQUIRED = [
  "PAYOUT_ACCOUNT_PROOF",
  "AUTHORISATION_RESOLUTION",
  "OFFICIAL_IDS",
] as const satisfies readonly DocumentType[];

export const ORGANIZATION_REQUIREMENTS: Record<
  OrganizationType,
  TypeRequirements
> = {
  REGISTERED_COMPANY: {
    label: "Registered company",
    hint: "Registered with the Business Registration Service (incl. companies limited by guarantee).",
    required: [
      "REGISTRATION_CERTIFICATE",
      "CR12",
      "KRA_PIN",
      ...ALWAYS_REQUIRED,
    ],
    optional: ["GOVERNING_DOCUMENT", "ANNUAL_ACCOUNTS"],
    overrides: {
      REGISTRATION_CERTIFICATE: {
        label: "Certificate of Incorporation",
        description: "Issued by the Business Registration Service.",
      },
      GOVERNING_DOCUMENT: {
        label: "Memorandum & Articles of Association",
        description: "Your company's memorandum and articles.",
      },
    },
  },
  PBO: {
    label: "NGO / Public Benefit Organization",
    hint: "Registered with the PBO Regulatory Authority (formerly the NGO Coordination Board).",
    required: [
      "REGISTRATION_CERTIFICATE",
      "GOVERNING_DOCUMENT",
      "KRA_PIN",
      ...ALWAYS_REQUIRED,
    ],
    optional: ["TAX_EXEMPTION", "ANNUAL_ACCOUNTS"],
    overrides: {
      REGISTRATION_CERTIFICATE: {
        label: "PBO / NGO registration certificate",
        description:
          "From the PBO Regulatory Authority. An older NGO Board certificate is also accepted.",
      },
    },
  },
  SOCIETY: {
    label: "Society, association or church",
    hint: "Registered with the Registrar of Societies.",
    required: [
      "REGISTRATION_CERTIFICATE",
      "GOVERNING_DOCUMENT",
      "KRA_PIN",
      ...ALWAYS_REQUIRED,
    ],
    optional: ["ANNUAL_ACCOUNTS"],
    overrides: {
      REGISTRATION_CERTIFICATE: {
        label: "Certificate of Registration",
        description:
          "From the Registrar of Societies (a Certificate of Exemption is also accepted).",
      },
    },
  },
  TRUST: {
    label: "Trust or foundation",
    hint: "A registered charitable trust or foundation.",
    required: [
      "REGISTRATION_CERTIFICATE",
      "GOVERNING_DOCUMENT",
      "KRA_PIN",
      ...ALWAYS_REQUIRED,
    ],
    optional: ["TAX_EXEMPTION", "ANNUAL_ACCOUNTS"],
    overrides: {
      REGISTRATION_CERTIFICATE: {
        label: "Trust registration certificate",
        description: "The certificate showing your trust is registered.",
      },
      GOVERNING_DOCUMENT: {
        label: "Trust deed",
        description: "Your signed trust deed.",
      },
    },
  },
  CBO_SELF_HELP: {
    label: "CBO or self-help group",
    hint: "Registered with the Social Services / Social Development office in your sub-county.",
    required: [
      "REGISTRATION_CERTIFICATE",
      "GOVERNING_DOCUMENT",
      ...ALWAYS_REQUIRED,
    ],
    optional: ["KRA_PIN", "ANNUAL_ACCOUNTS"],
    overrides: {
      REGISTRATION_CERTIFICATE: {
        label: "Group registration certificate",
        description:
          "From Social Services / Social Development. It must be current — group registrations need renewing periodically.",
      },
      AUTHORISATION_RESOLUTION: {
        description:
          "Signed minutes of the meeting that elected your officials and authorised you to register on GoUplift and receive funds.",
      },
      ANNUAL_ACCOUNTS: {
        label: "Latest progress report or accounts",
        description:
          "Your most recent annual progress report or financial statement.",
      },
    },
  },
  OTHER: {
    label: "Other registered body",
    hint: "For example a school, hospital, or co-operative registered with its own regulator.",
    required: ["REGISTRATION_CERTIFICATE", ...ALWAYS_REQUIRED],
    optional: [
      "GOVERNING_DOCUMENT",
      "KRA_PIN",
      "REGULATOR_LETTER",
    ],
    overrides: {
      REGISTRATION_CERTIFICATE: {
        description:
          "The certificate issued by the body that registered your organization.",
      },
    },
  },
};

export interface DocumentSlot extends DocumentInfo {
  documentType: DocumentType;
  required: boolean;
}

/** The ordered upload slots to show (and enforce) for an organization type. */
export function getDocumentSlots(type: OrganizationType): DocumentSlot[] {
  const reqs = ORGANIZATION_REQUIREMENTS[type];
  const build = (documentType: DocumentType, required: boolean): DocumentSlot => ({
    documentType,
    required,
    ...DOCUMENT_INFO[documentType],
    ...reqs.overrides?.[documentType],
  });
  return [
    ...reqs.required.map((t) => build(t, true)),
    ...reqs.optional.map((t) => build(t, false)),
  ];
}

export type DocumentReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * The required slots that still stop an organization from being verified:
 * every required slot needs at least one file, and every file in it approved.
 * The server enforces this on verify; the admin UI uses it to explain why the
 * Verify button is disabled.
 */
export function getVerificationBlockers(
  type: OrganizationType,
  documents: ReadonlyArray<{
    documentType: DocumentType;
    reviewStatus: DocumentReviewStatus;
  }>,
): DocumentSlot[] {
  return getDocumentSlots(type).filter((slot) => {
    if (!slot.required) return false;
    const files = documents.filter(
      (doc) => doc.documentType === slot.documentType,
    );
    return (
      files.length === 0 ||
      files.some((file) => file.reviewStatus !== "APPROVED")
    );
  });
}

/** Client-side check for a single chosen file. Returns an error message or null. */
export function validateDocumentFile(file: File): string | null {
  if (
    !(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)
  ) {
    return `${file.name} isn't a supported file. Use PDF, JPG, PNG or WebP.`;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `${file.name} is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}
