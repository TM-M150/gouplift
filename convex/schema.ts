import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    currency: v.union(v.literal("KES")),
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
    rejectionReason: v.optional(v.id("users")),
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
    grossAmount: v.number(),
    currency: v.union(v.literal("KES")),
    message: v.optional(v.string()),
    platformFeeRate: v.number(), // e.g. 0.0425
    platformFeeAmount: v.number(), // round(grossAmount * platformFeeRate, 2)
    netAmount: v.number(), // grossAmount - platformFeeAmount — owed to the fundraiser's beneficiary.
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
      ),
    ),
    merchantRequestId: v.optional(v.string()), // SasaPay's MerchantRequestID
    checkoutRequestId: v.optional(v.string()), // SasaPay's CheckoutRequestID — what the async callback correlates back to this row with
    providerTransactionCode: v.optional(v.string()), // SasaPay's settlement-time transaction code from the callback, for reconciling against their statement API later
    providerPayload: v.optional(v.string()), // raw callback JSON, stringified — worth keeping for debugging/reconciliation

    failureReason: v.optional(v.string()),
    refundedAt: v.optional(v.number()),
    refundReason: v.optional(v.string()),

    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_fundraiserId", ["fundraiserId"])
    .index("by_fundraiserId_and_status", ["fundraiserId", "status"])
    .index("by_donorUserId", ["donorUserId"])
    .index("by_status", ["status"])
    .index("by_checkoutRequestId", ["checkoutRequestId"])
    .index("by_payoutStatus", ["payoutStatus"]),
  sasapayTokens: defineTable({
    accessToken: v.string(),
    expiresAt: v.number(),
  }),
  organizations: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    verificationStatus: v.union(
      v.literal("UNVERIFIED"),
      v.literal("PENDING_REVIEW"),
      v.literal("VERIFIED"),
      v.literal("REJECTED"),
    ),
    verifiedAt: v.optional(v.number()),
    verifiedBy: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_verificationStatus", ["verificationStatus"]),
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
});
