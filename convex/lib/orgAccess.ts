import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { authComponent } from "../auth";

export const NOT_ORGANIZATION_OWNER =
  "Only the organization's owner can do this.";

// The signed-in user and the organization, but only when that user is the
// organization's OWNER. Everything is derived on the server from the session;
// nothing about who is asking comes from the caller.
//
// Returns null (rather than saying which part failed) so a stranger can't use
// the difference to learn that an organization or endpoint exists.
export async function getOwnerAccess(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
): Promise<{
  user: Doc<"users">;
  organization: Doc<"organizations">;
} | null> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
    .unique();
  if (!user) return null;

  const membership = await ctx.db
    .query("organizationMembers")
    .withIndex("by_organizationId_and_userId", (q) =>
      q.eq("organizationId", organizationId).eq("userId", user._id),
    )
    .unique();
  if (membership?.role !== "OWNER") return null;

  const organization = await ctx.db.get(organizationId);
  if (!organization) return null;

  return { user, organization };
}

export async function requireOwnerAccess(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const access = await getOwnerAccess(ctx, organizationId);
  if (!access) throw new ConvexError(NOT_ORGANIZATION_OWNER);
  return access;
}
