import type { MetadataRoute } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { buildSitemap, collectPages, MAX_SITEMAP_URLS } from "@/lib/seo";

// Rebuilt at most once an hour. A new fundraiser is listed within the hour,
// which is plenty for a crawler, and the page isn't regenerated on every visit
// from a bot. Without this the sitemap would be fixed at build time.
export const revalidate = 3600;

const PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Rounded to the hour so the query's answer stays cacheable.
  const now = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;

  try {
    const [organizations, fundraisers] = await Promise.all([
      collectPages(
        (cursor) =>
          fetchQuery(api.sitemap.organizationPage, {
            paginationOpts: { numItems: PAGE_SIZE, cursor },
          }),
        MAX_SITEMAP_URLS,
      ),
      collectPages(
        (cursor) =>
          fetchQuery(api.sitemap.fundraiserPage, {
            now,
            paginationOpts: { numItems: PAGE_SIZE, cursor },
          }),
        MAX_SITEMAP_URLS,
      ),
    ]);
    return buildSitemap({ fundraisers, organizations });
  } catch (error) {
    // The fixed pages are still worth listing if the database can't be
    // reached, for instance while a build runs. This copy lasts an hour.
    console.error("[sitemap] could not read fundraisers:", error);
    return buildSitemap({ fundraisers: [], organizations: [] });
  }
}
