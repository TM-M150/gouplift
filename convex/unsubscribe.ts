import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  httpAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { optOutState, recordOptOut } from "./lib/updateOptOuts";
import { SITE_URL } from "../lib/site";

// Unsubscribing from fundraiser update emails. Every email carries a link with
// a random token that belongs to one delivery, which knows the address and the
// fundraiser. The token is the only credential: it is unguessable, it never
// contains the address, and all it can do is stop emails.

// Tokens are 32 characters. Anything much longer is not one of ours.
const MAX_TOKEN_LENGTH = 100;

const scopeValidator = v.union(v.literal("FUNDRAISER"), v.literal("ALL"));

async function deliveryForToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"updateEmailDeliveries"> | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return await ctx.db
    .query("updateEmailDeliveries")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

/** What the unsubscribe page shows. Null for a link that isn't valid. */
export const lookup = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      fundraiserTitle: v.string(),
      stoppedForFundraiser: v.boolean(),
      stoppedForAll: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const delivery = await deliveryForToken(ctx, args.token);
    if (!delivery) return null;

    const fundraiser = await ctx.db.get(delivery.fundraiserId);
    const state = await optOutState(ctx, delivery.email, delivery.fundraiserId);
    return {
      fundraiserTitle: fundraiser?.title ?? "this fundraiser",
      stoppedForFundraiser: state.forFundraiser,
      stoppedForAll: state.forAll,
    };
  },
});

/** Stops update emails for this fundraiser, or for every fundraiser. Safe to repeat. */
export const confirm = mutation({
  args: { token: v.string(), scope: scopeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await deliveryForToken(ctx, args.token);
    if (!delivery) throw new ConvexError("This unsubscribe link isn't valid.");

    await recordOptOut(
      ctx,
      delivery.email,
      args.scope === "ALL" ? undefined : delivery.fundraiserId,
    );
    return null;
  },
});

/** The same for a mail app's own unsubscribe button: this fundraiser only. */
export const fromMailApp = internalMutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const delivery = await deliveryForToken(ctx, args.token);
    if (!delivery) return false;
    await recordOptOut(ctx, delivery.email, delivery.fundraiserId);
    return true;
  },
});

/**
 * The address in the List-Unsubscribe header. A POST, which is what a mail
 * app sends when its Unsubscribe button is pressed, unsubscribes. A GET only
 * sends the person to the page: mail scanners open every link in an email, and
 * that must not unsubscribe anyone.
 */
export const unsubscribeRoute = httpAction(async (ctx, request) => {
  const token = decodeURIComponent(
    new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "",
  );

  if (request.method === "POST") {
    const found: boolean = await ctx.runMutation(
      internal.unsubscribe.fromMailApp,
      { token },
    );
    return new Response(
      found
        ? "You have been unsubscribed."
        : "This unsubscribe link isn't valid.",
      { status: found ? 200 : 404 },
    );
  }

  const siteUrl = (process.env.SITE_URL || SITE_URL).replace(/\/+$/, "");
  return Response.redirect(
    `${siteUrl}/unsubscribe/${encodeURIComponent(token)}`,
    302,
  );
});
