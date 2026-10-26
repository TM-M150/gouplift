import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// The single place that decides what the outside world may see of an
// organization and its fundraisers. Everything public — the organization
// page, the browse and search lists, and (next) the /api/v1 HTTP routes and
// embeds — builds its response from the functions below instead of returning
// database documents, so a field added to the schema later (contact details,
// registration numbers, review notes) is private until someone deliberately
// adds it here.
//
// Conventions: a value that isn't set is `null`, not missing, so the same
// shape serializes cleanly to JSON; images are always resolved to a URL.

export const PUBLIC_FUNDRAISER_LIMIT = 24;
const STORY_SNIPPET_LENGTH = 280;

// Rejected organizations are hidden everywhere. Unverified and pending ones
// stay visible (carrying isVerified: false) so the page works while an admin
// is still reviewing the documents.
export function isPubliclyVisible(org: Doc<"organizations">): boolean {
  return org.verificationStatus !== "REJECTED";
}

// Only http(s) links are ever handed out, so a stored "javascript:" URL can't
// end up in an href on someone else's page.
export function safeWebsite(website?: string): string | null {
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

async function resolveImageUrl(
  ctx: QueryCtx,
  storageId: Id<"_storage"> | undefined,
  externalUrl: string | undefined,
): Promise<string | null> {
  if (storageId) {
    const stored = await ctx.storage.getUrl(storageId);
    if (stored) return stored;
  }
  return externalUrl ?? null;
}

// A short plain-text teaser. Public lists never carry a full story: those can
// run long, and the full text belongs on the fundraiser's own page.
function snippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

export async function toPublicOrganizationSummary(
  ctx: QueryCtx,
  org: Doc<"organizations">,
) {
  return {
    _id: org._id,
    slug: org.slug,
    name: org.name,
    description: org.description ?? null,
    isVerified: org.verificationStatus === "VERIFIED",
    logoUrl: await resolveImageUrl(ctx, org.logoStorageId, org.logoUrl),
  };
}

export async function toPublicOrganization(
  ctx: QueryCtx,
  org: Doc<"organizations">,
) {
  return {
    ...(await toPublicOrganizationSummary(ctx, org)),
    website: safeWebsite(org.website),
    heroImageUrl: await resolveImageUrl(
      ctx,
      org.heroImageStorageId,
      org.heroImageUrl,
    ),
    heroVideoUrl: org.heroVideoUrl ?? null,
    createdAt: org.createdAt,
  };
}

export async function loadPublicOrganizationBySlug(
  ctx: QueryCtx,
  slug: string,
) {
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (!org || !isPubliclyVisible(org)) return null;
  return await toPublicOrganization(ctx, org);
}

// Active, non-private fundraisers of a publicly visible organization, newest
// first. Bounded: this list is read by every visitor to an organization page,
// and will be read by every site that embeds one.
export async function loadPublicFundraisers(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  limit: number = PUBLIC_FUNDRAISER_LIMIT,
) {
  const org = await ctx.db.get(organizationId);
  if (!org || !isPubliclyVisible(org)) return [];

  const fundraisers = await ctx.db
    .query("fundraisers")
    .withIndex("by_organizationId_and_status_and_isPrivate", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("status", "ACTIVE")
        .eq("isPrivate", false),
    )
    .order("desc")
    .take(Math.min(limit, PUBLIC_FUNDRAISER_LIMIT));

  return await Promise.all(
    fundraisers.map(async (fundraiser) => ({
      _id: fundraiser._id,
      title: fundraiser.title,
      tagline: fundraiser.tagline ?? null,
      storySnippet: snippet(fundraiser.story, STORY_SNIPPET_LENGTH),
      type: fundraiser.type,
      currency: fundraiser.currency,
      goalAmount: fundraiser.goalAmount,
      amountRaised: fundraiser.amountRaised,
      donorCount: fundraiser.donorCount,
      location: fundraiser.location ?? null,
      coverImageUrl: await resolveImageUrl(
        ctx,
        fundraiser.coverImageStorageId,
        fundraiser.coverImage,
      ),
    })),
  );
}
