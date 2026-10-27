import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { authComponent } from "../auth";

type Ctx = QueryCtx | MutationCtx;

/** The signed-in user's profile row, or null when signed out / not yet created. */
export async function getCurrentUserDoc(
  ctx: Ctx,
): Promise<Doc<"users"> | null> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) return null;

  return await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
    .unique();
}

/**
 * The signed-in user if they are a moderator or admin, otherwise null. For
 * queries that should quietly return nothing to everyone else.
 */
export async function getStaffUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const user = await getCurrentUserDoc(ctx);
  if (user && (user.role === "ADMIN" || user.role === "MODERATOR")) {
    return user;
  }
  return null;
}

/** Moderators and admins. Throws for everyone else, signed in or not. */
export async function requireStaff(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getStaffUser(ctx);
  if (!user) {
    throw new ConvexError("You don't have permission to do that.");
  }
  return user;
}

/** Admins only — for role changes, payouts and similar. */
export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUserDoc(ctx);
  if (!user || user.role !== "ADMIN") {
    throw new ConvexError("You don't have permission to do that.");
  }
  return user;
}
