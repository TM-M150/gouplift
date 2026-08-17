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
    .index("by_endDate", ["endDate"]),
});
