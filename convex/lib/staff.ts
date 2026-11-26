import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { authComponent } from "../auth";
import {
  STAFF_BLOCK_MESSAGES,
  staffAccessBlock,
  staffEmailRule,
  type StaffAccessBlock,
} from "../../lib/staff-access";

type Ctx = QueryCtx | MutationCtx;

export type StaffRole = Exclude<Doc<"users">["role"], "USER">;

// A staff role is granted by hand (admin:setUserRole, from the command line),
// and holding it is not enough: the account's email must be confirmed and, once
// STAFF_EMAIL_DOMAINS is set, be a company address (lib/staff-access.ts has the
// rules). EVERY check of "is this person staff?" on the server goes through
// this file, so none of them can skip those rules. Reading `user.role` directly
// anywhere else is what convex/staffAccessGuard.test.ts forbids.

// Read on every check, not once at start-up, so changing the setting takes
// effect straight away.
function currentRule() {
  return staffEmailRule(process.env.STAFF_EMAIL_DOMAINS);
}

function staffRoleOf(user: Doc<"users">): StaffRole | null {
  return user.role === "ADMIN" || user.role === "MODERATOR" ? user.role : null;
}

/** The part of the sign-in service's record that the rules look at. */
interface AuthUserFacts {
  _id: string;
  email?: string | null;
  emailVerified?: boolean | null;
}

// `authUser` is the signed-in person's record from the sign-in service, the
// source of truth for the email address and whether it was confirmed. It must be
// the same person as `user`; anything else is refused.
function blockFor(
  authUser: AuthUserFacts | null | undefined,
  user: Doc<"users">,
): StaffAccessBlock | null {
  if (!authUser || authUser._id !== user.authUserId) {
    return "EMAIL_NOT_CONFIRMED";
  }
  return staffAccessBlock({
    email: authUser.email || user.email,
    emailConfirmed: authUser.emailVerified === true,
    rule: currentRule(),
  });
}

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
 * The staff role the SIGNED-IN user may use right now, or null: they have none,
 * or it is blocked (see lib/staff-access.ts). For code that already has the
 * signed-in user's row. A person without a staff role is turned away before
 * anything else is read, so ordinary visitors cost nothing extra.
 */
export async function activeStaffRole(
  ctx: Ctx,
  user: Doc<"users">,
): Promise<StaffRole | null> {
  const role = staffRoleOf(user);
  if (!role) return null;
  const authUser = await authComponent.safeGetAuthUser(ctx);
  return blockFor(authUser, user) === null ? role : null;
}

/** Whether the signed-in `user` is moderator or admin and may use that. */
export async function isActiveStaff(
  ctx: Ctx,
  user: Doc<"users">,
): Promise<boolean> {
  return (await activeStaffRole(ctx, user)) !== null;
}

/** Whether the signed-in `user` is an admin and may use that. */
export async function isActiveAdmin(
  ctx: Ctx,
  user: Doc<"users">,
): Promise<boolean> {
  return (await activeStaffRole(ctx, user)) === "ADMIN";
}

/**
 * The signed-in user if they are a moderator or admin who may use that role,
 * otherwise null. For queries that should quietly return nothing to everyone
 * else.
 */
export async function getStaffUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const user = await getCurrentUserDoc(ctx);
  return user && (await isActiveStaff(ctx, user)) ? user : null;
}

/** Like getStaffUser, for admins only. */
export async function getAdminUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const user = await getCurrentUserDoc(ctx);
  return user && (await isActiveAdmin(ctx, user)) ? user : null;
}

// Throws unless the signed-in user holds one of `roles` and may use it. Only
// someone who does hold the role is told WHY they are blocked; to everyone else
// it is the same plain refusal as ever.
async function requireRole(
  ctx: Ctx,
  roles: readonly StaffRole[],
  signedOutMessage: string,
): Promise<Doc<"users">> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) throw new ConvexError(signedOutMessage);

  const user = await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
    .unique();

  const role = user ? staffRoleOf(user) : null;
  if (!user || !role || !roles.includes(role)) {
    throw new ConvexError("You don't have permission to do that.");
  }

  const block = blockFor(authUser, user);
  if (block) throw new ConvexError(STAFF_BLOCK_MESSAGES[block]);
  return user;
}

/** Moderators and admins. Throws for everyone else, signed in or not. */
export async function requireStaff(ctx: Ctx) {
  return await requireRole(
    ctx,
    ["ADMIN", "MODERATOR"],
    "You must be signed in.",
  );
}

/** Admins only — for role changes, payouts and similar. */
export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  return await requireRole(
    ctx,
    ["ADMIN"],
    "You don't have permission to do that.",
  );
}

/** Where the signed-in person stands, for the admin area to decide what to show. */
export type StaffStatus =
  | { state: "NOT_STAFF" }
  | { state: "BLOCKED"; role: StaffRole; block: StaffAccessBlock }
  | { state: "ALLOWED"; role: StaffRole; name: string };

export async function getStaffStatus(ctx: Ctx): Promise<StaffStatus> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) return { state: "NOT_STAFF" };

  const user = await ctx.db
    .query("users")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
    .unique();
  const role = user ? staffRoleOf(user) : null;
  if (!user || !role) return { state: "NOT_STAFF" };

  const block = blockFor(authUser, user);
  return block
    ? { state: "BLOCKED", role, block }
    : { state: "ALLOWED", role, name: user.displayName };
}
