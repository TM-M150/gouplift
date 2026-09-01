import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { fundraiserSchema } from "../lib/validations/fundraiser";

function requireModerator(user: Doc<"users">) {
  if (user.role !== "ADMIN" && user.role !== "MODERATOR") {
    throw new ConvexError("You don't have permission to do that.");
  }
}

function requireOwner(user: Doc<"users">, fundraiser: Doc<"fundraisers">) {
  if (fundraiser.creatorId !== user.authUserId && user.role !== "ADMIN") {
    throw new ConvexError(
      "You don't have permission to modify this fundraiser.",
    );
  }
}

export const createFundraiser = mutation({
  args: {
    title: v.string(),
    tagline: v.optional(v.string()),
    type: v.string(),
    story: v.string(),
    beneficiaryType: v.string(),
    beneficiaryName: v.optional(v.string()),
    beneficiaryRelationship: v.optional(v.string()),
    organizationName: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    coverImageStorageId: v.optional(v.id("_storage")),
    goalAmount: v.number(),
    currency: v.string(),
    isPrivate: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    country: v.optional(v.string()),
    location: v.optional(v.string()),
    commentsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("You must be signed in to update your profile");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      throw new ConvexError("User profile not found");
    }

    const parsed = fundraiserSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Invalid profile data",
      );
    }

    const now = Date.now();
    const newFundraiser = await ctx.db.insert("fundraisers", {
      creatorId: user._id,
      title: parsed.data.title,
      tagline: parsed.data.tagline,
      story: parsed.data.story,
      type: parsed.data.type,
      beneficiaryType: parsed.data.beneficiaryType,
      beneficiaryName: parsed.data.beneficiaryName,
      beneficiaryRelationship: parsed.data.beneficiaryRelationship,
      organizationName: parsed.data.organizationName,
      tags: parsed.data.tags,
      coverImage: parsed.data.coverImage,
      coverImageStorageId: args.coverImageStorageId,
      goalAmount: parsed.data.goalAmount,
      currency: "KES",
      country: parsed.data.country,
      location: parsed.data.location,
      amountRaised: 0,
      donorCount: 0,
      status: "ACTIVE",
      isPrivate: args.isPrivate ?? false,
      isVerified: false,
      commentsEnabled: args.commentsEnabled ?? true,
      startDate: args.startDate,
      endDate: args.endDate,
      createdAt: now,
      updatedAt: now,
    });

    return newFundraiser;
  },
});

export const listMyFundraisers = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      return [];
    }

    const fundraisers = await ctx.db
      .query("fundraisers")
      .withIndex("by_creatorId", (q) => q.eq("creatorId", user._id))
      .order("desc")
      .collect();

    return Promise.all(
      fundraisers.map(async (fundraiser) => ({
        _id: fundraiser._id,
        title: fundraiser.title,
        type: fundraiser.type,
        status: fundraiser.status,
        goalAmount: fundraiser.goalAmount,
        amountRaised: fundraiser.amountRaised,
        currency: fundraiser.currency,
        donorCount: fundraiser.donorCount,
        location: fundraiser.location,
        createdAt: fundraiser.createdAt,
        coverImageUrl: fundraiser.coverImageStorageId
          ? await ctx.storage.getUrl(fundraiser.coverImageStorageId)
          : (fundraiser.coverImage ?? null),
      })),
    );
  },
});

export const updateFundraiser = mutation({
  args: {
    fundraiserId: v.id("fundraisers"),
    title: v.string(),
    tagline: v.optional(v.string()),
    type: v.string(),
    story: v.string(),
    beneficiaryType: v.string(),
    beneficiaryName: v.optional(v.string()),
    beneficiaryRelationship: v.optional(v.string()),
    organizationName: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    coverImageStorageId: v.optional(v.id("_storage")),
    goalAmount: v.number(),
    currency: v.string(),
    isPrivate: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    country: v.optional(v.string()),
    location: v.optional(v.string()),
    commentsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("You must be signed in to edit a fundraiser");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      throw new ConvexError("User profile not found");
    }

    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) {
      throw new ConvexError("Fundraiser not found");
    }

    // Ownership check (fixed)
    if (fundraiser.creatorId !== user._id && user.role !== "ADMIN") {
      throw new ConvexError(
        "You don't have permission to modify this fundraiser.",
      );
    }

    const parsed = fundraiserSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Invalid fundraiser data",
      );
    }

    const { fundraiserId, ...updateData } = args;

    await ctx.db.patch(fundraiserId, {
      ...parsed.data,
      coverImageStorageId: args.coverImageStorageId,
      updatedAt: Date.now(),
    });

    return fundraiserId;
  },
});

const RESTRICTED_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "REJECTED"]);

export const getFundraiserById = query({
  args: { fundraiserId: v.id("fundraisers") },
  handler: async (ctx, args) => {
    const fundraiser = await ctx.db.get(args.fundraiserId);
    if (!fundraiser) {
      return null;
    }

    // Restricted fundraisers are only visible to their owner or staff —
    // everyone else gets treated as "not found" rather than "forbidden"
    // so the detail page doesn't leak that a restricted fundraiser exists.
    const needsAuth =
      fundraiser.isPrivate || RESTRICTED_STATUSES.has(fundraiser.status);

    if (needsAuth) {
      const authUser = await authComponent.safeGetAuthUser(ctx);
      const user = authUser
        ? await ctx.db
            .query("users")
            .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
            .unique()
        : null;

      const isOwner = user?._id === fundraiser.creatorId;
      const isStaff = user?.role === "ADMIN" || user?.role === "MODERATOR";

      if (!isOwner && !isStaff) {
        return null;
      }
    }

    return {
      ...fundraiser,
      coverImageUrl: fundraiser.coverImageStorageId
        ? await ctx.storage.getUrl(fundraiser.coverImageStorageId)
        : (fundraiser.coverImage ?? null),
    };
  },
});

const FUNDRAISER_TYPE_ORDER = [
  "MEDICAL",
  "EDUCATION",
  "EMERGENCY",
  "MEMORIAL_FUNERAL",
  "COMMUNITY_HARAMBEE",
  "BUSINESS_STARTUP",
  "SPORTS",
  "CREATIVE_ARTS",
  "ANIMAL_WELFARE",
  "ENVIRONMENT",
  "DISASTER_RELIEF",
  "NONPROFIT",
  "OTHER",
] as const;

const SCAN_LIMIT = 200;

const PER_GROUP_LIMIT = 6;

export const listFundraisersByType = query({
  args: {},
  handler: async (ctx) => {
    const fundraisers = await ctx.db
      .query("fundraisers")
      .withIndex("by_status", (q) => q.eq("status", "ACTIVE"))
      .filter((q) => q.eq(q.field("isPrivate"), false))
      .order("desc")
      .take(SCAN_LIMIT);

    const groups = FUNDRAISER_TYPE_ORDER.map((type) => ({
      type,
      fundraisers: fundraisers
        .filter((f) => f.type === type)
        .slice(0, PER_GROUP_LIMIT),
    })).filter((group) => group.fundraisers.length > 0);

    return Promise.all(
      groups.map(async (group) => ({
        type: group.type,
        fundraisers: await Promise.all(
          group.fundraisers.map(async (fundraiser) => ({
            _id: fundraiser._id,
            title: fundraiser.title,
            goalAmount: fundraiser.goalAmount,
            amountRaised: fundraiser.amountRaised,
            currency: fundraiser.currency,
            donorCount: fundraiser.donorCount,
            location: fundraiser.location,
            coverImageUrl: fundraiser.coverImageStorageId
              ? await ctx.storage.getUrl(fundraiser.coverImageStorageId)
              : (fundraiser.coverImage ?? null),
          })),
        ),
      })),
    );
  },
});

export const searchFundraisers = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const trimmed = args.searchTerm.trim();
    if (!trimmed) {
      return [];
    }

    const fundraisers = await ctx.db
      .query("fundraisers")
      .withSearchIndex("search_title", (q) =>
        q
          .search("title", trimmed)
          .eq("status", "ACTIVE")
          .eq("isPrivate", false),
      )
      .take(20);

    return Promise.all(
      fundraisers.map(async (fundraiser) => ({
        _id: fundraiser._id,
        title: fundraiser.title,
        goalAmount: fundraiser.goalAmount,
        amountRaised: fundraiser.amountRaised,
        donorCount: fundraiser.donorCount,
        location: fundraiser.location,
        coverImageUrl: fundraiser.coverImageStorageId
          ? await ctx.storage.getUrl(fundraiser.coverImageStorageId)
          : (fundraiser.coverImage ?? null),
      })),
    );
  },
});
