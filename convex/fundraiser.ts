import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { authComponent } from "./auth";
import {
  fundraiserSchema,
} from "../lib/validations/fundraiser";

function requireModerator(user: Doc<"users">) {
  if (user.role !== "ADMIN" && user.role !== "MODERATOR") {
    throw new ConvexError("You don't have permission to do that.");
  }
}

function requireOwner(user: Doc<"users">, fundraiser: Doc<"fundraisers">) {
  if (fundraiser.creatorId !== user.authUserId && user.role !== "ADMIN") {
    throw new ConvexError("You don't have permission to modify this fundraiser.");
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
      throw new ConvexError(parsed.error.issues[0]?.message ?? "Invalid profile data");
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