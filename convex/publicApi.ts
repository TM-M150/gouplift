import { v } from "convex/values";
import { httpAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveReturnOrigin } from "./lib/constants";
import {
  PUBLIC_FUNDRAISER_LIMIT,
  loadPublicFundraisers,
  loadPublicOrganizationBySlug,
  type PublicFundraiser,
  type PublicOrganization,
} from "./lib/publicOrganizations";

// Public, read-only API for organizations that want to show their GoUplift
// fundraisers on their own site. Served by Convex at /api/v1/* and exposed on
// the GoUplift domain through a rewrite in next.config.ts.
//
//   GET /api/v1/organizations/{slug}
//   GET /api/v1/organizations/{slug}/fundraisers?limit=1..24
//
// Everything here is built from the public projections in
// lib/publicOrganizations.ts, and the response shapes below are an explicit
// contract: a field only appears in the API if it is listed in the mappers,
// so changing the internal projections can't leak or break anything silently.
//
// Only VERIFIED organizations are served. An organization still under review
// gets a 403 that says so (rather than a 404 that looks like a typo in the
// slug); rejected and unknown ones are 404.

const ORGANIZATIONS_PREFIX = "/api/v1/organizations/";

// What createOrganization's slug generator produces, with some slack for
// older slugs. Anything else can't be a real slug, so it is a 404 without
// touching the database.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Fundraiser totals change as donations land, so cached copies are short
// lived. s-maxage is for the CDN in front of this (Vercel, via the rewrite);
// stale-while-revalidate lets it keep answering while it refreshes.
const CACHE_OK = "public, max-age=30, s-maxage=60, stale-while-revalidate=300";
const CACHE_MISS = "public, max-age=10, s-maxage=30";
const CACHE_NONE = "no-store";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
} as const;

type OrganizationLookup =
  | { kind: "not_found" }
  | { kind: "not_verified" }
  | {
      kind: "ok";
      organization: PublicOrganization;
      fundraisers: PublicFundraiser[];
    };

// One query, so the organization and its fundraisers come from the same
// snapshot instead of two separate transactions.
export const getOrganizationForApi = internalQuery({
  args: { slug: v.string(), includeFundraisers: v.boolean() },
  handler: async (ctx, args): Promise<OrganizationLookup> => {
    const organization = await loadPublicOrganizationBySlug(ctx, args.slug);
    if (!organization) return { kind: "not_found" };
    if (!organization.isVerified) return { kind: "not_verified" };

    const fundraisers = args.includeFundraisers
      ? await loadPublicFundraisers(ctx, organization._id)
      : [];
    return { kind: "ok", organization, fundraisers };
  },
});

function json(status: number, body: unknown, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  cacheControl: string = CACHE_NONE,
): Response {
  return json(status, { error: { code, message } }, cacheControl);
}

// Canonical links back to GoUplift come from the first allowed app origin,
// the same one checkout uses as its default. Without one configured (local
// development) the links are simply null rather than wrong.
function link(origin: string, path: string): string | null {
  return origin ? `${origin}${path}` : null;
}

function toApiOrganization(org: PublicOrganization, origin: string) {
  return {
    id: org._id,
    slug: org.slug,
    name: org.name,
    description: org.description,
    isVerified: org.isVerified,
    logoUrl: org.logoUrl,
    heroImageUrl: org.heroImageUrl,
    heroVideoUrl: org.heroVideoUrl,
    website: org.website,
    url: link(origin, `/organizations/${org.slug}`),
    createdAt: new Date(org.createdAt).toISOString(),
  };
}

function toApiFundraiser(fundraiser: PublicFundraiser, origin: string) {
  return {
    id: fundraiser._id,
    title: fundraiser.title,
    tagline: fundraiser.tagline,
    summary: fundraiser.storySnippet,
    category: fundraiser.type,
    currency: fundraiser.currency,
    goalAmount: fundraiser.goalAmount,
    amountRaised: fundraiser.amountRaised,
    donorCount: fundraiser.donorCount,
    location: fundraiser.location,
    coverImageUrl: fundraiser.coverImageUrl,
    url: link(origin, `/fundraiser/${fundraiser._id}`),
  };
}

// `limit` is optional; when present it must be a whole number from 1 to the
// most the list ever holds. Returns null for an invalid value.
function parseLimit(raw: string | null): number | null {
  if (raw === null) return PUBLIC_FUNDRAISER_LIMIT;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= PUBLIC_FUNDRAISER_LIMIT ? limit : null;
}

export const organizationsRoute = httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    const segments = url.pathname
      .slice(ORGANIZATIONS_PREFIX.length)
      .split("/")
      .filter(Boolean);

    const [slug, resource] = segments;
    const isOrganization = segments.length === 1;
    const isFundraiserList = segments.length === 2 && resource === "fundraisers";

    if (!slug || !(isOrganization || isFundraiserList)) {
      return errorResponse(404, "not_found", "No such endpoint.", CACHE_MISS);
    }

    let limit = PUBLIC_FUNDRAISER_LIMIT;
    if (isFundraiserList) {
      const parsed = parseLimit(url.searchParams.get("limit"));
      if (parsed === null) {
        return errorResponse(
          400,
          "invalid_parameter",
          `limit must be a whole number between 1 and ${PUBLIC_FUNDRAISER_LIMIT}.`,
        );
      }
      limit = parsed;
    }

    if (!SLUG_PATTERN.test(slug)) {
      return errorResponse(
        404,
        "organization_not_found",
        "No organization has this slug.",
        CACHE_MISS,
      );
    }

    const result: OrganizationLookup = await ctx.runQuery(
      internal.publicApi.getOrganizationForApi,
      { slug, includeFundraisers: isFundraiserList },
    );

    if (result.kind === "not_found") {
      return errorResponse(
        404,
        "organization_not_found",
        "No organization has this slug.",
        CACHE_MISS,
      );
    }
    if (result.kind === "not_verified") {
      return errorResponse(
        403,
        "organization_not_verified",
        "This organization hasn't completed verification yet, so its data isn't available through the API.",
        CACHE_MISS,
      );
    }

    const origin = resolveReturnOrigin("");

    if (isFundraiserList) {
      return json(
        200,
        {
          data: result.fundraisers
            .slice(0, limit)
            .map((fundraiser) => toApiFundraiser(fundraiser, origin)),
        },
        CACHE_OK,
      );
    }

    return json(
      200,
      { data: toApiOrganization(result.organization, origin) },
      CACHE_OK,
    );
  } catch (error) {
    // Details stay in the logs; callers only learn that it failed.
    console.error("Public API request failed", error);
    return errorResponse(
      500,
      "internal_error",
      "Something went wrong. Please try again.",
    );
  }
});

// Anything under /api/v1/ that isn't a real endpoint: a JSON 404 instead of
// Convex's plain-text one, so API clients always get the same error shape.
export const apiNotFoundRoute = httpAction(async () =>
  errorResponse(404, "not_found", "No such endpoint.", CACHE_MISS),
);

// Browsers send this before a cross-origin request that isn't "simple". The
// API only serves public data and takes no credentials, so any origin may
// read it.
export const apiPreflightRoute = httpAction(
  async () =>
    new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    }),
);
