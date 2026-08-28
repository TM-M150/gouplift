import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

const EXPIRY_SAFETY_BUFFER_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 55 * 60 * 1000;

export const getCachedToken = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cached = await ctx.db.query("sasapayTokens").first();
    if (!cached) return null;
    if (cached.expiresAt <= Date.now() + EXPIRY_SAFETY_BUFFER_MS) return null;
    return cached.accessToken;
  },
});

export const saveToken = internalMutation({
  args: { accessToken: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sasapayTokens").first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
      });
    } else {
      await ctx.db.insert("sasapayTokens", {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
      });
    }
  },
});

export const getSasaPayAccessToken = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    const cached: string | null = await ctx.runQuery(
      internal.sasapay.getCachedToken,
      {},
    );
    if (cached) {
      return cached;
    }

    const clientId = process.env.SASAPAY_CLIENT_ID;
    const clientSecret = process.env.SASAPAY_CLIENT_SECRET;
    const baseUrl =
      process.env.SASAPAY_BASE_URL;

    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing SASAPAY_CLIENT_ID / SASAPAY_CLIENT_SECRET — set them with `npx convex env set`.",
      );
    }

    const credentials = btoa(`${clientId}:${clientSecret}`);

    const response = await fetch(
      `${baseUrl}/api/v1/auth/token/?grant_type=client_credentials`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${credentials}` },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `SasaPay token request failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new Error("SasaPay token response didn't include access_token.");
    }

    const ttlMs = (data.expires_in ?? DEFAULT_TOKEN_TTL_MS / 1000) * 1000;
    const expiresAt = Date.now() + ttlMs;

    await ctx.runMutation(internal.sasapay.saveToken, {
      accessToken: data.access_token,
      expiresAt,
    });

    return data.access_token;
  },
});