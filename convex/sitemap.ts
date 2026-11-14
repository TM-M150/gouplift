import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { query } from "./_generated/server";

// What the sitemap (app/sitemap.ts) lists. Public on purpose: it returns only
// what is already on a public page's address (an id or slug) and when it last
// changed, never a field of the document, so it can't leak anything the page
// doesn't show. Paginated, so the sitemap can grow past what one query may
// read; the caller walks the pages.

/**
 * Fundraisers worth sending a search engine to: active, public, not flagged
 * for review, started and not yet ended. A draft, a private or a rejected one
 * must not appear, and neither should one that has run out, since its page
 * can no longer take a donation.
 *
 * Queries can't read the clock, so the caller passes `now` (rounded to the
 * hour, which keeps the result cacheable).
 */
export const fundraiserPage = query({
  args: { now: v.number(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({ id: v.id("fundraisers"), updatedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("fundraisers")
      .withIndex("by_status", (q) => q.eq("status", "ACTIVE"))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      // Dropped after the page is read, so a page can come back short or
      // empty without being the last one: the caller goes by `isDone`.
      page: result.page
        .filter(
          (f) =>
            f.isPrivate !== true &&
            f.isFlagged !== true &&
            (f.startDate === undefined || f.startDate <= args.now) &&
            (f.endDate === undefined || f.endDate > args.now),
        )
        .map((f) => ({ id: f._id, updatedAt: f.updatedAt })),
    };
  },
});

/**
 * Organizations whose pages are worth promoting: the verified ones. An
 * unverified or pending organization has a page too, so it works while staff
 * review it, but it isn't offered to search engines until it has passed.
 */
export const organizationPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({ slug: v.string(), updatedAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("organizations")
      .withIndex("by_verificationStatus", (q) =>
        q.eq("verificationStatus", "VERIFIED"),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((org) => ({
        slug: org.slug,
        updatedAt: org.updatedAt,
      })),
    };
  },
});
