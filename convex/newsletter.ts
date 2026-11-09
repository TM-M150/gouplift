import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { consumeRateLimit } from "./lib/rateLimit";
import { newsletterEmailSchema } from "../lib/validations/newsletter";

// Convex can't see who is calling, so the only handle on abuse is a cap on the
// form as a whole. It is set far above what real visitors will reach, and a
// hidden field catches the bots that fill in every input.
const GLOBAL_LIMIT = { max: 60, windowMs: 10 * 60 * 1000 };

/**
 * Adds an address to the newsletter list. Saying yes twice is fine, and the
 * answer is the same either way, so the form can't be used to find out whether
 * someone is already on the list.
 */
export const subscribe = mutation({
  args: {
    email: v.string(),
    // A field real visitors never see. Anything in it means a bot.
    website: v.optional(v.string()),
  },
  returns: v.object({ status: v.literal("subscribed") }),
  handler: async (ctx, args) => {
    // Pretend it worked, so a bot learns nothing and doesn't retry.
    if (args.website) return { status: "subscribed" as const };

    const parsed = newsletterEmailSchema.safeParse(args.email);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Please enter a valid email address",
      );
    }
    const email = parsed.data;

    const existing = await ctx.db
      .query("newsletterSignups")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) return { status: "subscribed" as const };

    const limit = await consumeRateLimit(ctx, "newsletter:global", GLOBAL_LIMIT);
    if (!limit.allowed) {
      throw new ConvexError(
        "Lots of people are signing up right now. Please try again in a few minutes.",
      );
    }

    await ctx.db.insert("newsletterSignups", {
      email,
      consentedAt: Date.now(),
      source: "footer",
    });
    return { status: "subscribed" as const };
  },
});
