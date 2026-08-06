// convex/users.ts
import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { profileSchema } from "@/lib/validations/profile";
import { internal } from "./_generated/api";

// Follower
export const getProfileStats = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const followers = await ctx.db
      .query("follows")
      .withIndex("by_followingId", (q) => q.eq("followingId", args.userId))
      .collect();

    const following = await ctx.db
      .query("follows")
      .withIndex("by_followerId", (q) => q.eq("followerId", args.userId))
      .collect();

    return {
      followersCount: followers.length,
      followingCount: following.length,
    };
  },
});

export const isFollowing = query({
  args: {
    followerId: v.string(),
    followingId: v.string(),
  },

  handler: async (ctx, args) => {
    const follow = await ctx.db
      .query("follows")
      .withIndex("by_both", (q) =>
        q.eq("followerId", args.followerId)
          .eq("followingId", args.followingId)
      )
      .first();

    return !!follow;
  },
});

export const toggleFollow = mutation({
  args: {
    followerId: v.string(),
    followingId: v.string(),
  },

  handler: async (ctx, args) => {
    // Prevent following yourself
    if (args.followerId === args.followingId) {
      throw new Error("You cannot follow yourself.");
    }

    const existing = await ctx.db
      .query("follows")
      .withIndex("by_both", (q) =>
        q.eq("followerId", args.followerId)
         .eq("followingId", args.followingId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { following: false };
    }

    await ctx.db.insert("follows", {
      followerId: args.followerId,
      followingId: args.followingId,
    });

    return { following: true };
  },
});

export const updateProfile = mutation({
  args: {
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    website: v.optional(v.string()),
    isPrivate: v.optional(v.boolean()),
    courses: v.optional(v.array(v.string())),
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
    if (!user) throw new ConvexError("Profile not found");

    const parsed = profileSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(parsed.error.issues[0]?.message ?? "Invalid profile data");
    }

    await ctx.db.patch(user._id, { ...parsed.data, updatedAt: Date.now() });
  },
});

export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return null;

    return {
      bio: user.bio ?? "",
      courses: user.courses ?? [],
      isPrivate: user.isPrivate ?? false,
      image: user.image,
    };
  },
});

export const getUserById = query({
  args: {
    authUserId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) =>
        q.eq("authUserId", args.authUserId)
      )
      .unique();
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("You must be signed in to upload a photo");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveProfileImage = internalMutation({
  args: {
    authUserId: v.string(),
    storageId: v.id("_storage"),
    url: v.string(),
  },
  handler: async (ctx, { authUserId, storageId, url }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUserId))
      .unique();
    if (!user) throw new ConvexError("Profile not found");

    if (user.imageStorageId) {
      await ctx.storage.delete(user.imageStorageId);
    }

    await ctx.db.patch(user._id, {
      image: url,
      imageStorageId: storageId,
      updatedAt: Date.now(),
    });
  },
});

export const processProfileImageAction = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("You must be signed in to upload a photo");
    }

    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new ConvexError("Upload failed, please try again");

    await ctx.runMutation(internal.users.saveProfileImage, {
      authUserId: authUser._id,
      storageId,
      url,
    });

    return url;
  },
});