import type { MutationCtx, QueryCtx } from "../_generated/server";

// An organization's slug is its public address: /organizations/<slug> today,
// and the identifier embeds and the public API will use tomorrow. Slugs are
// never regenerated after creation so those URLs stay stable.

const MAX_SLUG_LENGTH = 48;
const FALLBACK_SLUG = "organization";
const MAX_COLLISION_ATTEMPTS = 8;

// Segments that already mean something next to /organizations/ (or will, for
// the embed and API routes). A slug equal to one of these would be shadowed
// by the real route, or would shadow it.
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "new",
  "invite",
  "create",
  "edit",
  "search",
  "dashboard",
  "settings",
  "admin",
  "api",
  "embed",
  "undefined",
  "null",
]);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "Café" -> "cafe"
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

// The name an organization asks for, turned into a slug that is safe to use
// before checking for collisions. Names with no usable characters ("!!!",
// non-Latin scripts) fall back to a generic base rather than an empty slug.
export function baseSlugFor(name: string): string {
  const slug = slugify(name);
  if (!slug) return FALLBACK_SLUG;
  return isReservedSlug(slug) ? `${slug}-org` : slug;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

// Returns a slug no other organization is using. The check and the caller's
// insert run in the same mutation, so two organizations created at the same
// moment can't both claim it: Convex retries the loser, which then sees the
// winner's slug and picks another.
export async function generateUniqueOrganizationSlug(
  ctx: QueryCtx | MutationCtx,
  name: string,
): Promise<string> {
  const base = baseSlugFor(name);

  for (let attempt = 0; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const taken = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken) return candidate;
  }

  // Nine collisions in a row means something is badly wrong (a name that
  // somehow keeps drawing the same suffixes), not bad luck.
  throw new Error("Couldn't generate a unique address for this organization.");
}
