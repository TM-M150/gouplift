import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rate/usd/kes";
const USD_KES_PAIR = "USD_KES";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — donation checkout doesn't need it fresher
const FALLBACK_RATE = 130; // last-resort number if the API is down AND there's no cache yet

export const getCachedRate = internalQuery({
  args: { pair: v.string() },
  returns: v.union(
    v.object({ rate: v.number(), fetchedAt: v.number() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q) => q.eq("pair", args.pair))
      .unique();
    return cached ? { rate: cached.rate, fetchedAt: cached.fetchedAt } : null;
  },
});

export const saveRate = internalMutation({
  args: { pair: v.string(), rate: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fxRates")
      .withIndex("by_pair", (q) => q.eq("pair", args.pair))
      .unique();
    const fetchedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { rate: args.rate, fetchedAt });
    } else {
      await ctx.db.insert("fxRates", {
        pair: args.pair,
        rate: args.rate,
        fetchedAt,
      });
    }
    return null;
  },
});

export async function getUsdToKesRate(ctx: ActionCtx): Promise<number> {
  const cached = await ctx.runQuery(internal.lib.fx.getCachedRate, {
    pair: USD_KES_PAIR,
  });

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }

  try {
    const response = await fetch(FRANKFURTER_URL);
    if (!response.ok) {
      throw new Error(`Frankfurter request failed (${response.status})`);
    }
    const data = (await response.json()) as { rate?: number };
    if (typeof data.rate !== "number") {
      throw new Error("Frankfurter response missing a rate.");
    }

    await ctx.runMutation(internal.lib.fx.saveRate, {
      pair: USD_KES_PAIR,
      rate: data.rate,
    });
    return data.rate;
  } catch (error) {
    console.error("getUsdToKesRate: live fetch failed, using fallback", error);
    return cached?.rate ?? FALLBACK_RATE;
  }
}
