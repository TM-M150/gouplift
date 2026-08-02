// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Follows join table
  follows: defineTable({
    followerId: v.string(),  // User ID of the person following
    followingId: v.string(), // User ID of the person being followed
  })
    .index("by_followerId", ["followerId"])
    .index("by_followingId", ["followingId"])
    .index("by_both", ["followerId", "followingId"]),
});