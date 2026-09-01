import { v, ConvexError } from "convex/values";
import {
  mutation,
  query,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authComponent } from "./auth";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function resolveReturnOrigin(requestedOrigin: string): string {
  const allowed = (process.env.ALLOWED_APP_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowed.includes(requestedOrigin)) {
    return requestedOrigin;
  }
  return allowed[0] ?? requestedOrigin;
}

async function getMembership(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("organizationMembers")
    .withIndex("by_organizationId_and_userId", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .unique();
}

export const getUserByAuthUserId = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId))
      .unique();
  },
});

export const getMembershipInternal = internalQuery({
  args: { organizationId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    return await getMembership(ctx, args.organizationId, args.userId);
  },
});

export const getMyMembershipRole = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return null;

    const membership = await getMembership(ctx, args.organizationId, user._id);
    return membership?.role ?? null;
  },
});

export const createOrganization = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("You must be signed in to create an organization.");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) {
      throw new ConvexError("User profile not found.");
    }

    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Organization name is required.");
    }

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name,
      description: args.description,
      website: args.website,
      contactEmail: args.contactEmail,
      contactPhone: args.contactPhone,
      verificationStatus: "UNVERIFIED",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("organizationMembers", {
      organizationId,
      userId: user._id,
      role: "OWNER",
      joinedAt: now,
    });

    return organizationId;
  },
});

export const createInvite = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("ADMIN"), v.literal("MEMBER")),
    invitedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    const now = Date.now();

    const inviteId = await ctx.db.insert("organizationInvites", {
      organizationId: args.organizationId,
      email: args.email,
      role: args.role,
      invitedBy: args.invitedBy,
      token,
      status: "PENDING",
      expiresAt: now + INVITE_EXPIRY_MS,
      createdAt: now,
    });

    return { inviteId, token };
  },
});

export const inviteMember = action({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("ADMIN"), v.literal("MEMBER")),
    origin: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ inviteId: Id<"organizationInvites">; acceptUrl: string }> => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("You must be signed in to invite a member.");
    }

    const inviterUser = await ctx.runQuery(
      internal.organizations.getUserByAuthUserId,
      { authUserId: authUser._id },
    );
    if (!inviterUser) {
      throw new Error("User profile not found.");
    }

    const membership = await ctx.runQuery(
      internal.organizations.getMembershipInternal,
      { organizationId: args.organizationId, userId: inviterUser._id },
    );

    if (
      !membership ||
      (membership.role !== "OWNER" && membership.role !== "ADMIN")
    ) {
      throw new Error(
        "You don't have permission to invite members to this organization.",
      );
    }

    const { inviteId, token } = await ctx.runMutation(
      internal.organizations.createInvite,
      {
        organizationId: args.organizationId,
        email: args.email.trim().toLowerCase(),
        role: args.role,
        invitedBy: inviterUser._id,
      },
    );

    const returnOrigin = resolveReturnOrigin(args.origin);
    const acceptUrl = `${returnOrigin}/organizations/invite?token=${token}`;

    return { inviteId, acceptUrl };
  },
});

export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("You must be signed in to accept an invite.");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) {
      throw new ConvexError("User profile not found.");
    }

    const invite = await ctx.db
      .query("organizationInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!invite) {
      throw new ConvexError("This invite link is invalid.");
    }

    if (invite.status !== "PENDING") {
      throw new ConvexError(
        "This invite has already been used or is no longer valid.",
      );
    }

    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, { status: "EXPIRED" });
      throw new ConvexError("This invite has expired.");
    }

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ConvexError(
        `This invite was sent to ${invite.email}. Sign in with that email to accept it.`,
      );
    }

    const existingMembership = await getMembership(
      ctx,
      invite.organizationId,
      user._id,
    );

    const now = Date.now();

    if (!existingMembership) {
      await ctx.db.insert("organizationMembers", {
        organizationId: invite.organizationId,
        userId: user._id,
        role: invite.role,
        joinedAt: now,
      });
    }

    await ctx.db.patch(invite._id, {
      status: "ACCEPTED",
      acceptedAt: now,
    });

    return invite.organizationId;
  },
});
