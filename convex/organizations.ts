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
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENT_BYTES,
  getDocumentSlots,
  type DocumentType,
} from "../lib/organization-verification";
import { organizationDetailsSchema } from "../lib/validations/organization";
import {
  documentTypeValidator,
  organizationTypeValidator,
} from "./lib/organizationValidators";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_DOCUMENT_FILE_NAME_LENGTH = 200;

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

// An organization is created together with the documents that prove it exists.
// The files are uploaded to Convex storage first (via users.generateUploadUrl)
// and referenced here by storageId; everything else about a file (type, size)
// is read from storage rather than trusted from the client.
export const createOrganization = mutation({
  args: {
    name: v.string(),
    organizationType: organizationTypeValidator,
    registrationNumber: v.string(),
    description: v.optional(v.string()),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    documents: v.array(
      v.object({
        documentType: documentTypeValidator,
        storageId: v.id("_storage"),
        fileName: v.string(),
      }),
    ),
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

    const parsed = organizationDetailsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Invalid organization details.",
      );
    }
    const details = parsed.data;
    const name = details.name;

    // 1. Shape check: only documents this type of organization is asked for,
    //    within each slot's file limit, with every required slot filled.
    const slots = getDocumentSlots(details.organizationType);
    const slotByType = new Map(slots.map((slot) => [slot.documentType, slot]));
    const countByType = new Map<DocumentType, number>();
    const seenStorageIds = new Set<string>();

    for (const doc of args.documents) {
      const slot = slotByType.get(doc.documentType);
      if (!slot) {
        throw new ConvexError(
          "A document was attached that isn't needed for this type of organization.",
        );
      }

      const count = (countByType.get(doc.documentType) ?? 0) + 1;
      if (count > slot.maxFiles) {
        throw new ConvexError(
          `${slot.label}: you can upload at most ${slot.maxFiles} file${slot.maxFiles === 1 ? "" : "s"}.`,
        );
      }
      countByType.set(doc.documentType, count);

      if (seenStorageIds.has(doc.storageId)) {
        throw new ConvexError("The same file was attached more than once.");
      }
      seenStorageIds.add(doc.storageId);
    }

    const missing = slots.filter(
      (slot) => slot.required && !countByType.has(slot.documentType),
    );
    if (missing.length > 0) {
      throw new ConvexError(
        `Missing required documents: ${missing.map((slot) => slot.label).join(", ")}.`,
      );
    }

    // 2. File check: read the real type and size from storage, and make sure
    //    the file isn't already attached to another submission.
    const verifiedDocuments: Array<{
      documentType: DocumentType;
      storageId: Id<"_storage">;
      fileName: string;
      contentType: string;
      size: number;
    }> = [];

    for (const doc of args.documents) {
      const fileName =
        doc.fileName.trim().slice(0, MAX_DOCUMENT_FILE_NAME_LENGTH) ||
        "document";

      const stored = await ctx.db.system.get("_storage", doc.storageId);
      if (!stored) {
        throw new ConvexError(
          `${fileName} wasn't uploaded properly. Please try again.`,
        );
      }

      const contentType = stored.contentType ?? "";
      if (
        !(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(
          contentType,
        )
      ) {
        throw new ConvexError(
          `${fileName} isn't a supported file. Use PDF, JPG, PNG or WebP.`,
        );
      }
      if (stored.size > MAX_DOCUMENT_BYTES) {
        throw new ConvexError(
          `${fileName} is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
        );
      }

      const alreadyUsed = await ctx.db
        .query("organizationDocuments")
        .withIndex("by_storageId", (q) => q.eq("storageId", doc.storageId))
        .first();
      if (alreadyUsed) {
        throw new ConvexError(`${fileName} has already been submitted.`);
      }

      verifiedDocuments.push({
        documentType: doc.documentType,
        storageId: doc.storageId,
        fileName,
        contentType,
        size: stored.size,
      });
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
    // Submitting the documents is part of creating the organization, so it
    // starts out waiting for an admin to review it.
    const organizationId = await ctx.db.insert("organizations", {
      name,
      slug,
      organizationType: details.organizationType,
      registrationNumber: details.registrationNumber,
      description: details.description,
      website: details.website,
      contactEmail: details.contactEmail,
      contactPhone: details.contactPhone,
      verificationStatus: "PENDING_REVIEW",
      verificationSubmittedAt: now,
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

    for (const doc of verifiedDocuments) {
      await ctx.db.insert("organizationDocuments", {
        organizationId,
        ...doc,
        uploadedBy: user._id,
        reviewStatus: "PENDING",
        createdAt: now,
      });
    }

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

const BROWSE_SCAN_LIMIT = 60;
const BROWSE_LIMIT = 24;
const SEARCH_LIMIT = 20;
const FUNDRAISER_LIMIT = 24;

function isPubliclyVisible(org: Doc<"organizations">) {
  return org.verificationStatus !== "REJECTED";
}

function verifiedRank(org: Doc<"organizations">) {
  return org.verificationStatus === "VERIFIED" ? 0 : 1;
}

function safeWebsite(website?: string): string | null {
  if (!website) return null;
  try {
    const url = new URL(website);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function toPublicSummary(ctx: QueryCtx, org: Doc<"organizations">) {
  return {
    _id: org._id,
    slug: org.slug,
    name: org.name,
    description: org.description ?? null,
    isVerified: org.verificationStatus === "VERIFIED",
    logoUrl: org.logoStorageId
      ? await ctx.storage.getUrl(org.logoStorageId)
      : (org.logoUrl ?? null),
  };
}

export const listOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("organizations")
      .order("desc")
      .take(BROWSE_SCAN_LIMIT);

    const visible = recent
      .filter(isPubliclyVisible)
      .sort((a, b) => verifiedRank(a) - verifiedRank(b)) // stable: verified first, newest within each group
      .slice(0, BROWSE_LIMIT);

    return Promise.all(visible.map((org) => toPublicSummary(ctx, org)));
  },
});

export const searchOrganizations = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, args) => {
    const trimmed = args.searchTerm.trim();
    if (!trimmed) return [];

    const matches = await ctx.db
      .query("organizations")
      .withSearchIndex("search_name", (q) => q.search("name", trimmed))
      .take(SEARCH_LIMIT);

    return Promise.all(
      matches.filter(isPubliclyVisible).map((org) => toPublicSummary(ctx, org)),
    );
  },
});

export const getPublicOrganization = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!org || !isPubliclyVisible(org)) return null;

    return {
      ...(await toPublicSummary(ctx, org)),
      website: safeWebsite(org.website),
      createdAt: org.createdAt,
    };
  },
});

export const listOrganizationFundraisers = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.organizationId);
    if (!org || !isPubliclyVisible(org)) return [];

    const fundraisers = await ctx.db
      .query("fundraisers")
      .withIndex("by_organizationId_and_status_and_isPrivate", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("status", "ACTIVE")
          .eq("isPrivate", false),
      )
      .order("desc")
      .take(FUNDRAISER_LIMIT);

    return Promise.all(
      fundraisers.map(async (fundraiser) => ({
        _id: fundraiser._id,
        title: fundraiser.title,
        goalAmount: fundraiser.goalAmount,
        amountRaised: fundraiser.amountRaised,
        donorCount: fundraiser.donorCount,
        location: fundraiser.location,
        coverImageUrl: fundraiser.coverImageStorageId
          ? await ctx.storage.getUrl(fundraiser.coverImageStorageId)
          : (fundraiser.coverImage ?? null),
      })),
    );
  },
});
