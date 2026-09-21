import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS = 8; // max donation starts per email per hour

export const check = internalQuery({
  args: { key: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!existing || now - existing.windowStart > WINDOW_MS) {
      return { allowed: true };
    }

    if (existing.count >= MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterMs: WINDOW_MS - (now - existing.windowStart),
      };
    }

    return { allowed: true };
  },
});

export const increment = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!existing || now - existing.windowStart > WINDOW_MS) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      await ctx.db.insert("rateLimits", {
        key: args.key,
        count: 1,
        windowStart: now,
      });
      return null;
    }

    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
    });
    return null;
  },
});
