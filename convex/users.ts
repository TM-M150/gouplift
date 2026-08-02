import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
  args: { followerId: v.string(), followingId: v.string() },
  handler: async (ctx, args) => {
    const follow = await ctx.db
      .query("follows")
      .withIndex("by_both", (q) =>
        q.eq("followerId", args.followerId).eq("followingId", args.followingId)
      )
      .first();

    return !!follow;
  },
});

export const toggleFollow = mutation({
  args: { followerId: v.string(), followingId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_both", (q) =>
        q.eq("followerId", args.followerId).eq("followingId", args.followingId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { following: false };
    } else {
      await ctx.db.insert("follows", {
        followerId: args.followerId,
        followingId: args.followingId,
      });
      return { following: true };
    }
  },
});