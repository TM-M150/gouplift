import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { donationSourceValidator } from "./lib/donationSource";
import {
  kycDocumentTypeValidator,
  kycIdTypeValidator,
  kycRequestedTierValidator,
  kycReviewCheckValidator,
  kycSubmissionStatusValidator,
} from "./lib/kycValidators";
import {
  beneficialOwnerBasisValidator,
  organizationReviewCheckValidator,
} from "./lib/beneficialOwnerValidators";
import {
  documentTypeValidator,
  organizationTypeValidator,
} from "./lib/organizationValidators";
import {
  payoutAccountReviewCheckValidator,
  payoutAccountStatusValidator,
  payoutHolderValidator,
  payoutMethodValidator,
  payoutVerifiedViaValidator,
} from "./lib/payoutAccountValidators";
import {
  eddReasonValidator,
  expectedTimelineValidator,
  pepOutcomeValidator,
  riskFactorsValidator,
  riskLevelValidator,
} from "./lib/riskValidators";
import {
  webhookDeliveryStatusValidator,
  webhookErrorValidator,
  webhookEventTypeValidator,
} from "./lib/webhookValidators";

export default defineSchema({
  users: defineTable({
    authUserId: v.string(), // Better Auth user.id
    username: v.optional(v.string()),
    email: v.string(), // unique
    phoneNumber: v.optional(v.string()),
    displayName: v.string(),
    bio: v.optional(v.string()),
    courses: v.optional(v.array(v.string())),
    image: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    coverImage: v.optional(v.string()),
    location: v.optional(v.string()),
    website: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    role: v.union(
      v.literal("USER"),
      v.literal("MODERATOR"),
      v.literal("ADMIN"),
    ),
    isPrivate: v.boolean(),
    isVerified: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authUserId", ["authUserId"])
    .index("by_username", ["username"])
    .index("by_email", ["email"])
    .index("by_phoneNumber", ["phoneNumber"]),

  follows: defineTable({
    followerId: v.string(),
    followingId: v.string(),
  })
    .index("by_followerId", ["followerId"])
    .index("by_followingId", ["followingId"])
    .index("by_both", ["followerId", "followingId"]),

  fundraisers: defineTable({
    creatorId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    beneficiaryType: v.union(
      v.literal("SELF"),
      v.literal("SOMEONE_ELSE"),
      v.literal("ORGANIZATION"),
    ),
    beneficiaryUserId: v.optional(v.id("users")),
    beneficiaryName: v.optional(v.string()),
    beneficiaryRelationship: v.optional(v.string()),
    organizationName: v.optional(v.string()),
    title: v.string(),
    tagline: v.optional(v.string()),
    story: v.string(),
    type: v.union(
      v.literal("MEDICAL"),
      v.literal("EDUCATION"),
      v.literal("EMERGENCY"),
      v.literal("MEMORIAL_FUNERAL"),
      v.literal("COMMUNITY_HARAMBEE"),
      v.literal("BUSINESS_STARTUP"),
      v.literal("SPORTS"),
      v.literal("CREATIVE_ARTS"),
      v.literal("ANIMAL_WELFARE"),
      v.literal("ENVIRONMENT"),
      v.literal("DISASTER_RELIEF"),
      v.literal("NONPROFIT"),
      v.literal("OTHER"),
    ),
    tags: v.optional(v.array(v.string())),
    coverImage: v.optional(v.string()),
    coverImageStorageId: v.optional(v.id("_storage")),
    goalAmount: v.number(),
    currency: v.union(v.literal("KES"), v.literal("USD")),
    amountRaised: v.number(),
    donorCount: v.number(),
    status: v.union(
      v.literal("DRAFT"),
      v.literal("PENDING_REVIEW"),
      v.literal("ACTIVE"),
      v.literal("PAUSED"),
      v.literal("COMPLETED"),
      v.literal("CANCELLED"),
      v.literal("REJECTED"),
      v.literal("EXPIRED"),
    ),
    isPrivate: v.boolean(),
    isVerified: v.boolean(),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    reportCount: v.optional(v.number()),
    isFlagged: v.optional(v.boolean()),
    country: v.optional(v.string()),
    location: v.optional(v.string()),
    viewCount: v.optional(v.number()),
    shareCount: v.optional(v.number()),
    commentsEnabled: v.optional(v.boolean()),
    updatesCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creatorId", ["creatorId"])
    .index("by_status", ["status"])
    .index("by_type", ["type"])
    .index("by_beneficiaryUserId", ["beneficiaryUserId"])
    .index("by_endDate", ["endDate"])
    // For the hourly sweep that expires fundraisers whose end date has passed.
    .index("by_status_and_endDate", ["status", "endDate"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_status_and_isPrivate", [
      "organizationId",
      "status",
      "isPrivate",
    ])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["status", "isPrivate"],
    }),

  donations: defineTable({
    fundraiserId: v.id("fundraisers"),
    donorUserId: v.optional(v.id("users")),
    donorName: v.optional(v.string()),
    donorEmail: v.optional(v.string()),
    donorPhone: v.optional(v.string()),
    isAnonymous: v.boolean(),
    grossAmount: v.number(), // stays the KES-equivalent — everything downstream (fundraiser totals, fees) keeps working unchanged
    currency: v.union(v.literal("KES")),

    // NEW — records what the donor actually paid, when it wasn't KES
    provider: v.optional(v.union(v.literal("SASAPAY"), v.literal("PAYPAL"))),
    originalCurrency: v.optional(v.union(v.literal("KES"), v.literal("USD"))),
    originalAmount: v.optional(v.number()), // amount charged in originalCurrency
    exchangeRate: v.optional(v.number()), // USD->KES rate used at capture time

    message: v.optional(v.string()),
    // The donor ticked "share my message as a testimonial". Only ever set for
    // a signed-in donor with a message, and only a request: the testimonials
    // table decides whether it is queued, and staff decide whether it is shown.
    shareAsTestimonial: v.optional(v.boolean()),

    // Where the donation was started. Missing on every donation made before
    // this field existed, and treated as "WEB".
    source: v.optional(donationSourceValidator),

    platformFeeRate: v.number(),
    platformFeeAmount: v.number(),
    netAmount: v.number(),
    gatewayFeeAmount: v.optional(v.number()),

    status: v.union(
      v.literal("PENDING"),
      v.literal("COMPLETED"),
      v.literal("FAILED"),
      v.literal("CANCELLED"),
      v.literal("REFUNDED"),
    ),
    payoutStatus: v.union(
      v.literal("NOT_YET_PAYABLE"),
      v.literal("PENDING_PAYOUT"),
      v.literal("PAID_OUT"),
    ),

    paymentMethod: v.optional(
      v.union(
        v.literal("SASAPAY_WALLET"),
        v.literal("MPESA"),
        v.literal("AIRTEL_MONEY"),
        v.literal("CARD"),
        v.literal("BANK"),
        v.literal("PAYPAL"), // NEW
      ),
    ),
    merchantRequestId: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
    providerTransactionCode: v.optional(v.string()),
    providerPayload: v.optional(v.string()),

    // NEW — PayPal's own correlation ids
    paypalOrderId: v.optional(v.string()),
    paypalCaptureId: v.optional(v.string()),
    paypalSubscriptionId: v.optional(v.string()),
    isSubscriptionPayment: v.optional(v.boolean()),

    failureReason: v.optional(v.string()),
    refundedAt: v.optional(v.number()),
    refundReason: v.optional(v.string()),

    completedAt: v.optional(v.number()),
    // When the money in this donation became withdrawable (see
    // fundraiserBalances). Mobile money is final, so it settles the moment it
    // completes; a PayPal payment can still be disputed, so it settles a few
    // days later. Empty means "not yet", or a donation from before this field.
    settledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_fundraiserId", ["fundraiserId"])
    .index("by_fundraiserId_and_status", ["fundraiserId", "status"])
    .index("by_donorUserId", ["donorUserId"])
    .index("by_status", ["status"])
    .index("by_checkoutRequestId", ["checkoutRequestId"])
    .index("by_payoutStatus", ["payoutStatus"])
    .index("by_paypalOrderId", ["paypalOrderId"]) // NEW
    .index("by_paypalSubscriptionId", ["paypalSubscriptionId"])
    .index("by_paypalCaptureId", ["paypalCaptureId"]),

  paypalSubscriptions: defineTable({
    fundraiserId: v.id("fundraisers"),
    donorUserId: v.optional(v.id("users")),
    donorEmail: v.optional(v.string()),
    donorName: v.optional(v.string()),
    isAnonymous: v.boolean(),
    message: v.optional(v.string()),

    paypalSubscriptionId: v.string(),
    paypalPlanId: v.string(),
    monthlyAmountUsd: v.number(),

    status: v.union(
      v.literal("PENDING"),
      v.literal("ACTIVE"),
      v.literal("SUSPENDED"),
      v.literal("CANCELLED"),
      v.literal("EXPIRED"),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
    cancelledAt: v.optional(v.number()),
  })
    .index("by_paypalSubscriptionId", ["paypalSubscriptionId"])
    .index("by_fundraiserId", ["fundraiserId"])
    .index("by_donorUserId", ["donorUserId"]),

  donationSubscriptions: defineTable({
    subscriptionId: v.string(), // PayPal Subscription ID
    planId: v.string(), // PayPal Plan ID
    status: v.union(
      v.literal("APPROVAL_PENDING"),
      v.literal("APPROVED"),
      v.literal("ACTIVE"),
      v.literal("SUSPENDED"),
      v.literal("CANCELLED"),
      v.literal("EXPIRED"),
    ),
    cadence: v.union(
      v.literal("MONTHLY"),
      v.literal("YEARLY"),
      v.literal("WEEKLY"),
    ),
    fundraiserId: v.id("fundraisers"),
    donorUserId: v.optional(v.id("users")),
    amount: v.number(),
    currency: v.union(v.literal("KES"), v.literal("USD")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subscriptionId", ["subscriptionId"])
    .index("by_fundraiserId", ["fundraiserId"])
    .index("by_donorUserId", ["donorUserId"])
    .index("by_status", ["status"]),

  sasapayTokens: defineTable({
    accessToken: v.string(),
    expiresAt: v.number(),
  }),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    heroVideoUrl: v.optional(v.string()),
    heroImageUrl: v.optional(v.string()),
    heroImageStorageId: v.optional(v.id("_storage")),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    // Optional so organizations created before document verification still validate.
    organizationType: v.optional(organizationTypeValidator),
    verificationStatus: v.union(
      v.literal("UNVERIFIED"),
      v.literal("PENDING_REVIEW"),
      v.literal("VERIFIED"),
      v.literal("REJECTED"),
    ),
    verificationSubmittedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.string()),
    // What it declared when it applied (policy 5.7, 5.8, 7, 9). Organizations
    // created before these were asked have none. The owners it named are in
    // organizationBeneficialOwners.
    registeredCountry: v.optional(v.string()), // ISO 3166-1 alpha-2
    expectedAmountKes: v.optional(v.number()),
    expectedTimeline: v.optional(expectedTimelineValidator),
    pepDeclared: v.optional(v.boolean()),
    pepDetails: v.optional(v.string()),
    prohibitedActivitiesAcknowledged: v.optional(v.boolean()),
    // Set when a reviewer passes it to the MLRO. Never shown to the owner.
    escalatedAt: v.optional(v.number()),
    // What the reviewer confirmed before verifying.
    confirmedChecks: v.optional(v.array(organizationReviewCheckValidator)),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_verificationStatus", ["verificationStatus"])
    .index("by_slug", ["slug"])
    .searchIndex("search_name", { searchField: "name" }),

  // Who owns or controls an organization (policy 5.4, 6): every natural person
  // with 10% or more or who otherwise controls it, or its senior managing
  // official where nobody does. Staff only: it holds ID numbers, so never
  // return a row to the organization or the public.
  organizationBeneficialOwners: defineTable({
    organizationId: v.id("organizations"),
    fullName: v.string(),
    idType: kycIdTypeValidator,
    idNumber: v.string(), // normalized: upper-case, no spaces
    basis: beneficialOwnerBasisValidator,
    ownershipPercent: v.optional(v.number()),
    role: v.optional(v.string()),
    residenceCountry: v.string(),
    pepDeclared: v.boolean(),
    addedBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),

  // How risky an organization is, and what enhanced due diligence has been
  // done (policy 4.3, 7, 8). The organization's counterpart to
  // customerRiskProfiles: one row per organization, made when it is verified
  // and updated by the MLRO, with the inputs kept next to the result so the
  // rating can be worked out again (lib/risk.ts). Staff only: never return it
  // to the organization (policy 12.3).
  organizationRiskProfiles: defineTable({
    organizationId: v.id("organizations"),

    // Inputs.
    residenceCountry: v.string(), // where it is registered
    expectedAmountKes: v.number(),
    pepOutcome: pepOutcomeValidator,
    behaviour: riskLevelValidator,
    complexStructure: v.boolean(),
    highRiskSector: v.boolean(),
    noOwnerIdentified: v.boolean(),
    mlroFlagged: v.boolean(),
    overrideRating: v.optional(riskLevelValidator),
    overrideReason: v.optional(v.string()),

    // Result.
    rating: riskLevelValidator,
    computedRating: riskLevelValidator,
    factors: riskFactorsValidator,
    eddReasons: v.array(eddReasonValidator),
    ratedAt: v.number(),
    ratedBy: v.id("users"),
    nextReviewDue: v.number(),

    // The enhanced due diligence record, once done. Cleared when a new reason
    // for it turns up, so it has to be done again.
    eddCompletedAt: v.optional(v.number()),
    eddCompletedBy: v.optional(v.id("users")),
    sourceOfFunds: v.optional(v.string()),
    sourceOfWealth: v.optional(v.string()),
    eddNote: v.optional(v.string()),
  }).index("by_organizationId", ["organizationId"]),

  // Verification files an organization uploads when it is created. One row per
  // file (a slot like OFFICIAL_IDS can hold several). Reviewed per document so
  // an admin can ask for a single file to be replaced.
  organizationDocuments: defineTable({
    organizationId: v.id("organizations"),
    documentType: documentTypeValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    uploadedBy: v.id("users"),
    reviewStatus: v.union(
      v.literal("PENDING"),
      v.literal("APPROVED"),
      v.literal("REJECTED"),
    ),
    reviewNote: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_documentType", [
      "organizationId",
      "documentType",
    ])
    .index("by_storageId", ["storageId"]),

  // Verification files someone has uploaded and registered but not yet
  // submitted. createOrganization claims (deletes) the rows for the files it
  // attaches; the sweep in documentUploads.ts deletes the rest, and their files,
  // once they are a day old. See documentUploads.ts for the whole lifecycle.
  pendingUploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
  })
    .index("by_storageId", ["storageId"])
    .index("by_userId", ["userId"]),

  // Who did what in the admin area. Written by every staff decision so a
  // verification (which later unlocks payouts) can always be traced.
  // A donor's message, offered as a public testimonial. One row per donation,
  // created only when the donor opted in and was an approved-KYC person at the
  // time. Nothing is shown until staff approve it, and the public list checks
  // again that the donation still stands and the author is still verified.
  // message and authorName are snapshots, so later edits to a profile or
  // donation can't change what staff approved.
  testimonials: defineTable({
    donationId: v.id("donations"),
    authorUserId: v.id("users"),
    fundraiserId: v.id("fundraisers"),
    authorName: v.string(), // first name and last initial only
    message: v.string(),
    status: v.union(
      v.literal("PENDING"),
      v.literal("APPROVED"),
      v.literal("REJECTED"),
      v.literal("WITHDRAWN"),
    ),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()), // the reason, when rejected
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_donationId", ["donationId"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_status_and_approvedAt", ["status", "approvedAt"])
    .index("by_authorUserId", ["authorUserId"]),

  adminAuditLog: defineTable({
    actorId: v.id("users"),
    action: v.union(
      v.literal("DOCUMENT_REVIEWED"),
      v.literal("ORGANIZATION_VERIFIED"),
      v.literal("ORGANIZATION_REJECTED"),
      v.literal("PAYOUT_HOLD_PLACED"),
      v.literal("PAYOUT_HOLD_RELEASED"),
      v.literal("KYC_APPROVED"),
      v.literal("KYC_REJECTED"),
      v.literal("PAYOUT_ACCOUNT_APPROVED"),
      v.literal("PAYOUT_ACCOUNT_REJECTED"),
      v.literal("PAYOUT_ACCOUNT_CHANGED"),
      v.literal("KYC_ESCALATED"),
      v.literal("RISK_RATED"),
      v.literal("RISK_OVERRIDDEN"),
      v.literal("EDD_FLAGGED"),
      v.literal("EDD_RECORDED"),
      v.literal("ORGANIZATION_ESCALATED"),
      v.literal("BENEFICIAL_OWNER_ADDED"),
      v.literal("BENEFICIAL_OWNER_REMOVED"),
      v.literal("TESTIMONIAL_APPROVED"),
      v.literal("TESTIMONIAL_REJECTED"),
      v.literal("PAYOUT_APPROVED"),
      v.literal("PAYOUT_REJECTED"),
      v.literal("PAYOUT_PAID"),
      v.literal("PAYOUT_FAILED"),
    ),
    organizationId: v.optional(v.id("organizations")),
    fundraiserId: v.optional(v.id("fundraisers")),
    testimonialId: v.optional(v.id("testimonials")),
    payoutId: v.optional(v.id("payouts")),
    kycSubmissionId: v.optional(v.id("kycSubmissions")),
    payoutAccountId: v.optional(v.id("payoutAccounts")),
    documentId: v.optional(v.id("organizationDocuments")),
    statusBefore: v.optional(v.string()),
    statusAfter: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_fundraiserId", ["fundraiserId"])
    .index("by_kycSubmissionId", ["kycSubmissionId"])
    .index("by_payoutAccountId", ["payoutAccountId"])
    .index("by_actorId", ["actorId"]),

  // An individual fundraiser's application for a verification tier (policy
  // 5.3). Every application is kept, approved or not, as the record of who was
  // checked, by whom and against what (policy 15). A user's tier is the
  // highest one with an APPROVED submission; see lib/kycTier.ts.
  //
  // Tier 1 submissions carry the identity fields, Tier 2 ones the KRA PIN.
  // Never return a whole row to the client: it holds an ID number.
  kycSubmissions: defineTable({
    userId: v.id("users"),
    requestedTier: kycRequestedTierValidator,
    status: kycSubmissionStatusValidator,
    legalName: v.optional(v.string()),
    idType: v.optional(kycIdTypeValidator),
    idNumber: v.optional(v.string()), // normalized: upper-case, no spaces
    phoneNumber: v.optional(v.string()), // +254...
    campaignPurpose: v.optional(v.string()),
    // What a Tier 1 applicant declares about themselves and the money (policy
    // 5.7, 7, 9). Applications made before these were asked have none.
    residenceCountry: v.optional(v.string()), // ISO 3166-1 alpha-2
    expectedAmountKes: v.optional(v.number()),
    expectedTimeline: v.optional(expectedTimelineValidator),
    pepDeclared: v.optional(v.boolean()),
    pepDetails: v.optional(v.string()),
    prohibitedActivitiesAcknowledged: v.optional(v.boolean()),
    kraPin: v.optional(v.string()),
    submittedAt: v.number(),
    // Set when a reviewer passes it to the MLRO. Never shown to the applicant.
    escalatedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    // What the reviewer confirmed before approving.
    confirmedChecks: v.optional(v.array(kycReviewCheckValidator)),
    // Shown to the fundraiser, so it must never hint at a suspicion.
    rejectionReason: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_status_and_submittedAt", ["status", "submittedAt"])
    // Finds the same ID, or the same phone number, on more than one account.
    .index("by_idType_and_idNumber_and_status", [
      "idType",
      "idNumber",
      "status",
    ])
    .index("by_phoneNumber_and_status", ["phoneNumber", "status"]),

  // How risky an individual fundraiser is, and what enhanced due diligence has
  // been done (policy 4.3, 7, 8). One row per person, made when their Level 1
  // is approved and updated by the MLRO. The inputs are kept next to the result
  // so the rating can be worked out again (lib/risk.ts) when something changes.
  // Staff only: never return it to the person it is about (policy 12.3).
  customerRiskProfiles: defineTable({
    userId: v.id("users"),
    // The Level 1 application it was first rated on.
    kycSubmissionId: v.id("kycSubmissions"),

    // Inputs.
    residenceCountry: v.string(),
    expectedAmountKes: v.number(),
    pepOutcome: pepOutcomeValidator,
    behaviour: riskLevelValidator,
    mlroFlagged: v.boolean(),
    overrideRating: v.optional(riskLevelValidator),
    overrideReason: v.optional(v.string()),

    // Result.
    rating: riskLevelValidator,
    computedRating: riskLevelValidator,
    factors: riskFactorsValidator,
    eddReasons: v.array(eddReasonValidator),
    ratedAt: v.number(),
    ratedBy: v.id("users"),
    // When the customer is next reviewed (policy 5.10).
    nextReviewDue: v.number(),

    // The enhanced due diligence record, once done. Cleared when a new reason
    // for it turns up, so it has to be done again.
    eddCompletedAt: v.optional(v.number()),
    eddCompletedBy: v.optional(v.id("users")),
    sourceOfFunds: v.optional(v.string()),
    sourceOfWealth: v.optional(v.string()),
    eddNote: v.optional(v.string()),
  }).index("by_userId", ["userId"]),

  kycDocuments: defineTable({
    submissionId: v.id("kycSubmissions"),
    userId: v.id("users"),
    documentType: kycDocumentTypeValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  })
    .index("by_submissionId", ["submissionId"])
    .index("by_storageId", ["storageId"]),

  // Where a verified fundraiser or organization can be paid (policy 5.5).
  // Details never change once saved: to change where money goes, add another
  // account and choose it (see fundraiserPayoutAccounts), so every change is a
  // new row to verify and a record of what was used when.
  //
  // Whoever registered it is userId; organizationId is set when the account
  // belongs to an organization. Never return a whole row to the client: it
  // holds a full account number.
  payoutAccounts: defineTable({
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    method: payoutMethodValidator,
    // OWN: in the fundraiser's or organization's name. THIRD_PARTY: a verified
    // beneficiary's (a hospital, a school), which needs a justification.
    holder: payoutHolderValidator,
    accountName: v.string(),
    mpesaNumber: v.optional(v.string()), // +254...
    bankName: v.optional(v.string()),
    bankAccountNumber: v.optional(v.string()), // digits only
    justification: v.optional(v.string()),
    // The file that shows the account is what it says. Not needed when the
    // account is the mobile number already verified at Level 1.
    proofStorageId: v.optional(v.id("_storage")),
    proofFileName: v.optional(v.string()),
    proofContentType: v.optional(v.string()),
    proofSize: v.optional(v.number()),
    status: payoutAccountStatusValidator,
    verifiedVia: v.optional(payoutVerifiedViaValidator),
    createdAt: v.number(),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    confirmedChecks: v.optional(v.array(payoutAccountReviewCheckValidator)),
    // Shown to the owner, so it must never hint at a suspicion.
    rejectionReason: v.optional(v.string()),
    closedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_proofStorageId", ["proofStorageId"])
    // Find the same number or account behind more than one owner (policy 10).
    .index("by_mpesaNumber_and_status", ["mpesaNumber", "status"])
    .index("by_bankAccountNumber_and_status", ["bankAccountNumber", "status"]),

  // Which payout account a fundraiser is paid to. One row per fundraiser, kept
  // out of the fundraiser document because public queries return that whole
  // document. changedAt is set only when an account was replaced by another,
  // and starts the temporary hold in policy 5.5.
  fundraiserPayoutAccounts: defineTable({
    fundraiserId: v.id("fundraisers"),
    payoutAccountId: v.id("payoutAccounts"),
    selectedBy: v.id("users"),
    selectedAt: v.number(),
    changedAt: v.optional(v.number()),
  })
    .index("by_fundraiserId", ["fundraiserId"])
    .index("by_payoutAccountId", ["payoutAccountId"]),

  // Staff holds on releasing a fundraiser's money (policy 3.3: the MLRO can
  // block payouts). Kept in a table of their own rather than on the
  // fundraiser: public queries return fundraiser documents, and the reason for
  // a hold must never reach the fundraiser (policy 12.3, no tipping off). A
  // released hold stays as a row, so the history is a record (policy 15).
  fundraiserPayoutHolds: defineTable({
    fundraiserId: v.id("fundraisers"),
    status: v.union(v.literal("ACTIVE"), v.literal("RELEASED")),
    reason: v.string(),
    placedBy: v.id("users"),
    placedAt: v.number(),
    releasedBy: v.optional(v.id("users")),
    releasedAt: v.optional(v.number()),
    releaseNote: v.optional(v.string()),
  }).index("by_fundraiserId_and_status", ["fundraiserId", "status"]),

  // What a fundraiser has earned and what has already left. Kept apart from the
  // fundraiser document because public queries return that whole document.
  // All amounts are KES, after the platform fee.
  //
  //   settledNet  every completed donation that is past its settlement delay
  //   pendingNet  completed donations still inside it (PayPal)
  //   reserved    payouts asked for or approved but not yet sent
  //   paid        payouts that have been sent
  //
  // The withdrawable amount is settledNet - reserved - paid. A payout request
  // takes its amount out of that in the same transaction that creates it, so
  // two requests can never claim the same money. convex/payoutBalances.ts can
  // rebuild every figure from the donations and payouts, which stay the record.
  fundraiserBalances: defineTable({
    fundraiserId: v.id("fundraisers"),
    settledNet: v.number(),
    pendingNet: v.number(),
    reserved: v.number(),
    paid: v.number(),
    updatedAt: v.number(),
  }).index("by_fundraiserId", ["fundraiserId"]),

  // One request to send a fundraiser some of its money to its verified payout
  // account (AML policy 5.5). Staff approve it, send the money themselves,
  // then record the reference. Every request is kept, whatever its outcome, as
  // the record of what was paid out and who decided (policy 15).
  payouts: defineTable({
    fundraiserId: v.id("fundraisers"),
    // Whose verification level applies: the fundraiser's creator.
    ownerUserId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    requestedBy: v.id("users"),
    payoutAccountId: v.id("payoutAccounts"),
    // Where it goes, as the owner saw it when they asked. Stays correct if
    // the account is closed later.
    destination: v.string(),
    // KES taken from the balance. Any transfer charge comes off what the
    // fundraiser receives, not off this.
    amount: v.number(),
    status: v.union(
      v.literal("REQUESTED"),
      v.literal("APPROVED"),
      v.literal("PAID"),
      v.literal("REJECTED"),
      v.literal("CANCELLED"),
      v.literal("FAILED"),
    ),
    // The owner's total payouts would pass the Level 2 limit (policy 5.3), so
    // the approval has to record a note.
    needsEnhancedApproval: v.boolean(),
    requestedAt: v.number(),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    approvalNote: v.optional(v.string()),
    rejectedBy: v.optional(v.id("users")),
    rejectedAt: v.optional(v.number()),
    // Shown to the owner, so it must never hint at a suspicion.
    rejectionReason: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    // An organization can have several owners, so which one is recorded.
    cancelledBy: v.optional(v.id("users")),
    paidBy: v.optional(v.id("users")),
    paidAt: v.optional(v.number()),
    // The M-Pesa code or bank reference of the transfer staff made.
    providerReference: v.optional(v.string()),
    transferFeeAmount: v.optional(v.number()),
    failedBy: v.optional(v.id("users")),
    failedAt: v.optional(v.number()),
    // Staff only.
    failureReason: v.optional(v.string()),
  })
    .index("by_fundraiserId_and_requestedAt", ["fundraiserId", "requestedAt"])
    .index("by_fundraiserId_and_status", ["fundraiserId", "status"])
    .index("by_status_and_requestedAt", ["status", "requestedAt"])
    .index("by_ownerUserId_and_status", ["ownerUserId", "status"])
    .index("by_providerReference", ["providerReference"]),

  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("OWNER"), v.literal("ADMIN"), v.literal("MEMBER")),
    joinedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_userId", ["userId"])
    .index("by_organizationId_and_userId", ["organizationId", "userId"]),

  organizationInvites: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("ADMIN"), v.literal("MEMBER")),
    invitedBy: v.id("users"),
    token: v.string(),
    status: v.union(
      v.literal("PENDING"),
      v.literal("ACCEPTED"),
      v.literal("DECLINED"),
      v.literal("EXPIRED"),
      v.literal("REVOKED"),
    ),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_email", ["email"])
    .index("by_token", ["token"]),

  fxRates: defineTable({
    pair: v.string(), // e.g. "USD_KES" — lets you add more pairs later without a migration
    rate: v.number(),
    fetchedAt: v.number(),
  }).index("by_pair", ["pair"]),

  // People who asked, in the footer, to hear from GoUplift. Nothing is sent
  // from here yet: this is the list to send from once there is something to
  // send. One row per address, stored in lower case. consentedAt is when they
  // ticked the box that says what the address will be used for.
  newsletterSignups: defineTable({
    email: v.string(),
    consentedAt: v.number(),
    source: v.literal("footer"),
  }).index("by_email", ["email"]),

  rateLimits: defineTable({
    key: v.string(), // e.g. "donate:email:user@example.com" or "donate:ip:1.2.3.4"
    count: v.number(),
    windowStart: v.number(), // timestamp
  }).index("by_key", ["key"]),

  // Where an organization wants to be told about things that happen to it.
  // Kept small and rarely written: nothing that changes on every delivery
  // lives here (that is what webhookDeliveries is for), so busy periods can't
  // make writers fight over one endpoint document.
  webhookEndpoints: defineTable({
    organizationId: v.id("organizations"),
    url: v.string(), // validated by lib/validations/webhook.ts
    // Signs every request. Needed in the clear to compute the signature, so it
    // is never returned by a query: only shown to the owner when it is created
    // or rolled.
    secret: v.string(),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),

  // One row per event per endpoint, written in the same step that decides the
  // event happened (so a delivery can't be lost between "donation completed"
  // and "told the organization"), then worked through by the delivery action.
  webhookDeliveries: defineTable({
    endpointId: v.id("webhookEndpoints"),
    organizationId: v.id("organizations"),
    eventId: v.string(), // stable across retries; receivers dedupe on it
    eventType: webhookEventTypeValidator,
    payload: v.string(), // the exact JSON body that is signed and sent
    status: webhookDeliveryStatusValidator,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(webhookErrorValidator),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    // Newest first for the delivery log, and cleanup by endpoint.
    .index("by_endpointId", ["endpointId"])
    // "Have we already queued this event for this endpoint?"
    .index("by_endpointId_and_eventId", ["endpointId", "eventId"]),

  // One row (key "global") of public, homepage-facing totals. Rebuilt on a
  // schedule by internal.platformStats.refresh, so the homepage never scans
  // fundraisers at request time.
  platformStats: defineTable({
    key: v.literal("global"),
    // Sum of amountRaised over KES fundraisers that went live.
    totalRaisedKes: v.number(),
    // Sum of donorCount. That counter goes up once per completed donation,
    // so it counts donations, not unique donors.
    totalDonations: v.number(),
    fundraisersLaunched: v.number(),
    activeFundraisers: v.number(),
    // ACTIVE, public fundraisers per type. Bounded by the number of types.
    categories: v.array(v.object({ type: v.string(), count: v.number() })),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
