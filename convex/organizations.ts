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

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

export const getPublicOrganizationBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!organization) return null;

    return {
      _id: organization._id,
      name: organization.name,
      description: organization.description,
      logoUrl: organization.logoUrl,
      heroVideoUrl: organization.heroVideoUrl,
      heroImageUrl: organization.heroImageUrl,
    };
  },
});

export const getUserByAuthUserId = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", args.authUserId))
      .unique();
  },
});

export const getPublicFundraisersByOrganization = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const allFundraisers = await ctx.db
      .query("fundraisers")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const active = allFundraisers.filter(
      (f) => f.status === "ACTIVE" && !f.isPrivate,
    );

    return await Promise.all(
      active.map(async (f) => ({
        _id: f._id,
        title: f.title,
        tagline: f.tagline,
        story: f.story,
        coverImage:
          f.coverImage ??
          (f.coverImageStorageId
            ? await ctx.storage.getUrl(f.coverImageStorageId)
            : undefined),
        goalAmount: f.goalAmount,
        amountRaised: f.amountRaised,
        donorCount: f.donorCount,
        currency: f.currency,
        type: f.type,
      })),
    );
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

    // Generate unique slug base
    let slug = slugify(name);
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    // Append a short random suffix if a duplicate slug exists
    if (existing) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
    }

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name,
      slug,
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

    return { organizationId, slug };
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

export const getOrganizationBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    // 1. Fetch organization using the slug index
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!organization) return null;

    // 2. Gate access to members only
    const authUser = await authComponent.safeGetAuthUser(ctx);
    const user = authUser
      ? await ctx.db
          .query("users")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
          .unique()
      : null;

    const membership = user
      ? await getMembership(ctx, organization._id, user._id)
      : null;

    if (!membership) return null;

    return organization;
  },
});

export const getDonationStats = query({
  args: {
    organizationId: v.id("organizations"),
    days: v.number(), // 7 | 30 | 90
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return [];

    const membership = await getMembership(ctx, args.organizationId, user._id);
    if (!membership) return [];

    // Get all fundraisers belonging to this organization
    // NOTE: Add .index("by_organizationId", ["organizationId"]) on fundraisers for better performance
    const allFundraisers = await ctx.db.query("fundraisers").collect();
    const orgFundraisers = allFundraisers.filter(
      (f) => f.organizationId === args.organizationId,
    );

    if (orgFundraisers.length === 0) return [];

    const now = Date.now();
    const startTime = now - args.days * 24 * 60 * 60 * 1000;

    // Aggregate completed donations by day
    const dailyTotals = new Map<string, number>();

    for (const fundraiser of orgFundraisers) {
      const donations = await ctx.db
        .query("donations")
        .withIndex("by_fundraiserId", (q) =>
          q.eq("fundraiserId", fundraiser._id),
        )
        .collect();

      for (const donation of donations) {
        if (donation.status !== "COMPLETED") continue;
        if (donation.completedAt === undefined) continue;
        if (donation.completedAt < startTime) continue;

        const date = new Date(donation.completedAt);
        const dateKey = date.toISOString().slice(0, 10); // YYYY-MM-DD

        const current = dailyTotals.get(dateKey) ?? 0;
        dailyTotals.set(dateKey, current + donation.netAmount);
      }
    }

    // Convert to sorted array
    const result = Array.from(dailyTotals.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return result;
  },
});

export const getOrganizationDashboardStats = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return {
        totalRaised: 0,
        activeFundraisers: 0,
        totalDonors: 0,
        avgDonation: 0,
        completedDonations: 0,
      };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) {
      return {
        totalRaised: 0,
        activeFundraisers: 0,
        totalDonors: 0,
        avgDonation: 0,
        completedDonations: 0,
      };
    }

    const membership = await getMembership(ctx, args.organizationId, user._id);
    if (!membership) {
      return {
        totalRaised: 0,
        activeFundraisers: 0,
        totalDonors: 0,
        avgDonation: 0,
        completedDonations: 0,
      };
    }

    const allFundraisers = await ctx.db.query("fundraisers").collect();
    const orgFundraisers = allFundraisers.filter(
      (f) => f.organizationId === args.organizationId,
    );

    let totalRaised = 0;
    let activeFundraisers = 0;
    let totalDonors = 0;

    for (const f of orgFundraisers) {
      totalRaised += f.amountRaised ?? 0;
      totalDonors += f.donorCount ?? 0;
      if (f.status === "ACTIVE") {
        activeFundraisers += 1;
      }
    }

    let completedDonations = 0;
    let completedTotal = 0;

    for (const fundraiser of orgFundraisers) {
      const donations = await ctx.db
        .query("donations")
        .withIndex("by_fundraiserId", (q) =>
          q.eq("fundraiserId", fundraiser._id),
        )
        .collect();

      for (const d of donations) {
        if (d.status !== "COMPLETED") continue;
        completedDonations += 1;
        completedTotal += d.netAmount ?? 0;
      }
    }

    const avgDonation =
      completedDonations > 0 ? completedTotal / completedDonations : 0;

    return {
      totalRaised,
      activeFundraisers,
      totalDonors,
      avgDonation,
      completedDonations,
    };
  },
});

export const getMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return [];

    // Get all memberships for this user
    const memberships = await ctx.db
      .query("organizationMembers")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();

    // Fetch the organization details for each membership
    const orgs = await Promise.all(
      memberships.map(async (membership) => {
        const org = await ctx.db.get(membership.organizationId);
        if (!org) return null;
        return {
          ...org,
          role: membership.role,
        };
      }),
    );

    return orgs.filter((org): org is NonNullable<typeof org> => org !== null);
  },
});

export const listFundraisersByOrganization = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return [];

    const membership = await getMembership(ctx, args.organizationId, user._id);
    if (!membership) return [];

    const allFundraisers = await ctx.db.query("fundraisers").collect();
    const orgFundraisers = allFundraisers.filter(
      (f) => f.organizationId === args.organizationId,
    );

    return orgFundraisers
      .map((f) => ({
        id: f._id,
        title: f.title,
        type: f.type,
        status: f.status,
        goalAmount: f.goalAmount,
        amountRaised: f.amountRaised,
        donorCount: f.donorCount,
        currency: f.currency,
      }))
      .sort((a, b) => b.id.localeCompare(a.id));
  },
});
