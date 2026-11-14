import type { MetadataRoute } from "next";
import { SITE_URL } from "./site";

// What search engines are told about the site: the pages worth listing
// (sitemap.xml) and the places they shouldn't bother with (robots.txt). Kept
// here, apart from app/sitemap.ts and app/robots.ts, so the rules can be
// tested without a running site or a database.

/**
 * The fixed public pages. A page that needs a signed-in user, or that doesn't
 * exist yet, doesn't belong here. Add a new public page when it is built.
 */
export const STATIC_PAGES = [
  "/",
  "/fundraisers",
  "/organizations",
  "/how-it-works",
  "/pricing",
  "/trust",
  "/withdrawals",
  "/about",
  "/help",
  "/privacy",
  "/terms",
] as const;

/**
 * Paths crawlers are asked to stay out of. They are prefixes, and `*` stands
 * for any run of characters. Note that robots.txt only asks: it is not access
 * control (these pages check who is asking themselves), and it stops a page
 * being crawled, not necessarily being listed if someone links to it.
 *
 * Careful with the organization paths: /organizations/<slug> is a public page,
 * so only the private areas beneath it are listed, never the whole prefix.
 */
export const PRIVATE_PATHS = [
  "/admin/",
  // Our own API and the embed widget's pages: made for programs, not search.
  "/api/",
  "/embed/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/profile",
  "/payouts",
  "/verification",
  "/fundraiser-form",
  "/fundraiser/*/edit",
  // Exactly this page: a prefix would also catch an organization whose slug
  // starts with "new".
  "/organizations/new$",
  "/organizations/*/dashboard",
  "/organizations/*/developers",
  // People's profiles aren't offered to search engines. Revisit if creators
  // should be findable by name.
  "/users/",
] as const;

/** Google reads at most 50,000 URLs from one sitemap. */
export const MAX_SITEMAP_URLS = 45_000;

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

export function buildSitemap(input: {
  fundraisers: Array<{ id: string; updatedAt: number }>;
  organizations: Array<{ slug: string; updatedAt: number }>;
}): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    // No lastModified on the fixed pages: there is no record of when one last
    // changed, and a made-up date teaches Google to ignore the real ones.
    ...STATIC_PAGES.map((path) => ({ url: absoluteUrl(path) })),
    ...input.organizations.map((org) => ({
      url: absoluteUrl(`/organizations/${encodeURIComponent(org.slug)}`),
      lastModified: new Date(org.updatedAt),
    })),
    ...input.fundraisers.map((fundraiser) => ({
      url: absoluteUrl(`/fundraiser/${encodeURIComponent(fundraiser.id)}`),
      lastModified: new Date(fundraiser.updatedAt),
    })),
  ];

  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
  // The fixed pages and organizations come first, so it is the oldest
  // fundraisers that fall off if the cap is ever reached. At that point the
  // sitemap should be split (generateSitemaps) rather than cut.
  return unique.slice(0, MAX_SITEMAP_URLS);
}

/**
 * robots.txt. Anything that isn't the live site (a Vercel preview or
 * development deployment) asks to be left out of search entirely, so a test
 * copy of a fundraiser can't turn up beside the real one. Anywhere else,
 * including a self-hosted production, is treated as the live site.
 */
export function buildRobots(
  vercelEnv: string | undefined,
): MetadataRoute.Robots {
  if (vercelEnv === "preview" || vercelEnv === "development") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_PATHS],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

/**
 * Addresses that reach this site but aren't the one we publish. They exist
 * only to send people on to SITE_URL. The published address (www.gouplift.africa)
 * must never be listed here, or it would redirect to itself.
 */
export const REDIRECTED_HOSTS = [
  "gouplift.co.ke",
  "www.gouplift.co.ke",
] as const;

/**
 * Paths that keep answering on a redirected host. Partner sites were told to
 * use whichever address they copied the snippet from: a script or an iframe
 * would follow a redirect, but a browser refuses a cross-site fetch() that is
 * redirected, so /api/ calls (and the embed widget's own files) must keep
 * working exactly where they are. Compared against the path without its
 * leading slash.
 */
export const NOT_REDIRECTED_PATH = "(?:api|embed)(?:/|$)|embed\\.js$";

/**
 * next.config.ts `redirects`: a permanent redirect from each redirected host to
 * the same path (and query string, which Next carries over) on SITE_URL. Done
 * here rather than in the Vercel dashboard because the dashboard can only
 * redirect a whole domain, not leave /api/ and the embed widget alone.
 */
export function canonicalHostRedirects() {
  const hosts = REDIRECTED_HOSTS.map((host) => host.replace(/\./g, "\\.")).join(
    "|",
  );
  return [
    {
      source: `/:path((?!${NOT_REDIRECTED_PATH}).*)`,
      // Next matches the whole host name against this pattern; the group keeps
      // the "|" from splitting the anchors away from the alternatives.
      has: [{ type: "host" as const, value: `(?:${hosts})` }],
      destination: `${SITE_URL}/:path`,
      permanent: true,
    },
  ];
}

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/**
 * Walks a paginated query to the end, or until `limit` items. The page count
 * is capped as well, so a query that never reports it is done can't hold the
 * sitemap up for ever.
 */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  limit: number,
  maxPages = 500,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < maxPages && items.length < limit; pages++) {
    const result: Page<T> = await fetchPage(cursor);
    items.push(...result.page);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return items.slice(0, limit);
}
