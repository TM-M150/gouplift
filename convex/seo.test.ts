import { describe, expect, it } from "vitest";
import {
  buildRobots,
  buildSitemap,
  collectPages,
  MAX_SITEMAP_URLS,
  PRIVATE_PATHS,
  STATIC_PAGES,
} from "../lib/seo";
import { SITE_URL } from "../lib/site";

// How a crawler reads a robots.txt rule: a prefix, where `*` is any run of
// characters and a trailing `$` pins the end of the address.
function blocked(path: string, rules: readonly string[]): boolean {
  return rules.some((rule) => {
    const pattern = rule
      .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\$$/, "$");
    return new RegExp(`^${pattern}`).test(path);
  });
}

describe("buildSitemap", () => {
  const sitemap = buildSitemap({
    fundraisers: [
      { id: "k17abc", updatedAt: Date.parse("2026-11-10T08:00:00Z") },
    ],
    organizations: [
      { slug: "kajiado-youth-trust", updatedAt: Date.parse("2026-11-01T08:00:00Z") },
    ],
  });
  const urls = sitemap.map((entry) => entry.url);

  it("lists every fixed page on the real domain, the homepage without a trailing slash", () => {
    for (const path of STATIC_PAGES) {
      expect(urls).toContain(path === "/" ? SITE_URL : `${SITE_URL}${path}`);
    }
    expect(urls).toContain("https://www.gouplift.africa");
    expect(urls).not.toContain("https://www.gouplift.africa/");
  });

  it("lists each fundraiser and organization at its page, with when it changed", () => {
    expect(sitemap).toContainEqual({
      url: `${SITE_URL}/fundraiser/k17abc`,
      lastModified: new Date("2026-11-10T08:00:00Z"),
    });
    expect(sitemap).toContainEqual({
      url: `${SITE_URL}/organizations/kajiado-youth-trust`,
      lastModified: new Date("2026-11-01T08:00:00Z"),
    });
  });

  it("gives the fixed pages no date: nothing records when they changed", () => {
    for (const entry of sitemap.slice(0, STATIC_PAGES.length)) {
      expect(entry).not.toHaveProperty("lastModified");
    }
  });

  it("encodes what goes into an address", () => {
    const [entry] = buildSitemap({
      fundraisers: [],
      organizations: [{ slug: "a b/c?d", updatedAt: 0 }],
    }).slice(STATIC_PAGES.length);
    expect(entry.url).toBe(`${SITE_URL}/organizations/a%20b%2Fc%3Fd`);
  });

  it("lists an address once", () => {
    const twice = buildSitemap({
      fundraisers: [
        { id: "x", updatedAt: 1 },
        { id: "x", updatedAt: 2 },
      ],
      organizations: [],
    });
    expect(twice.filter((e) => e.url.endsWith("/fundraiser/x"))).toHaveLength(1);
  });

  it("stays under Google's limit, keeping the fixed pages and dropping the oldest fundraisers", () => {
    const many = buildSitemap({
      fundraisers: Array.from({ length: MAX_SITEMAP_URLS + 10 }, (_, i) => ({
        id: `f${i}`,
        updatedAt: 0,
      })),
      organizations: [{ slug: "acme", updatedAt: 0 }],
    });
    expect(many).toHaveLength(MAX_SITEMAP_URLS);
    expect(many.map((e) => e.url)).toContain(`${SITE_URL}/about`);
    expect(many.map((e) => e.url)).toContain(`${SITE_URL}/organizations/acme`);
    expect(many.at(-1)?.url).not.toContain(`/f${MAX_SITEMAP_URLS + 9}`);
  });
});

describe("robots rules", () => {
  it("never block a page that is in the sitemap", () => {
    for (const path of STATIC_PAGES) {
      expect(blocked(path, PRIVATE_PATHS), path).toBe(false);
    }
    for (const path of [
      "/fundraiser/k17abc",
      "/organizations/kajiado-youth-trust",
      // The organization paths are the easy ones to get wrong.
      "/organizations/newhope-trust",
      "/organizations/dashboard-group",
      "/organizations/developers-club",
      "/fundraisers",
    ]) {
      expect(blocked(path, PRIVATE_PATHS), path).toBe(false);
    }
  });

  it("keep crawlers out of the private areas", () => {
    for (const path of [
      "/admin",
      "/admin/payouts/abc",
      "/api/v1/organizations",
      "/api/auth/get-session",
      "/embed/organizations/acme",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/reset-password",
      "/profile",
      "/payouts",
      "/verification",
      "/fundraiser-form",
      "/fundraiser/k17abc/edit",
      "/organizations/new",
      "/organizations/kajiado-youth-trust/dashboard",
      "/organizations/kajiado-youth-trust/developers",
      "/users/abc",
    ]) {
      // "/admin" has no trailing slash: it is the admin home itself.
      expect(blocked(path === "/admin" ? "/admin/" : path, PRIVATE_PATHS), path).toBe(true);
    }
  });
});

describe("buildRobots", () => {
  it("on the live site: allow it, keep out the private areas, and point to the sitemap", () => {
    for (const env of [undefined, "production"]) {
      expect(buildRobots(env)).toEqual({
        rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
        sitemap: "https://www.gouplift.africa/sitemap.xml",
      });
    }
  });

  it("on a preview or development deployment: keep everything out of search", () => {
    for (const env of ["preview", "development"]) {
      expect(buildRobots(env)).toEqual({
        rules: { userAgent: "*", disallow: "/" },
      });
    }
  });
});

describe("collectPages", () => {
  const paged = (pages: string[][]) => {
    const calls: Array<string | null> = [];
    const fetchPage = async (cursor: string | null) => {
      calls.push(cursor);
      const index = cursor === null ? 0 : Number(cursor);
      return {
        page: pages[index],
        isDone: index === pages.length - 1,
        continueCursor: String(index + 1),
      };
    };
    return { fetchPage, calls };
  };

  it("walks every page, passing the cursor on", async () => {
    const { fetchPage, calls } = paged([["a", "b"], ["c"], ["d", "e"]]);
    expect(await collectPages(fetchPage, 100)).toEqual(["a", "b", "c", "d", "e"]);
    expect(calls).toEqual([null, "1", "2"]);
  });

  it("goes on past an empty page that isn't the last", async () => {
    const { fetchPage } = paged([[], ["a"], []]);
    expect(await collectPages(fetchPage, 100)).toEqual(["a"]);
  });

  it("stops at the limit", async () => {
    const { fetchPage, calls } = paged([["a", "b"], ["c", "d"], ["e"]]);
    expect(await collectPages(fetchPage, 3)).toEqual(["a", "b", "c"]);
    expect(calls).toEqual([null, "1"]);
  });

  it("gives up on a query that never finishes", async () => {
    let calls = 0;
    const result = await collectPages(
      async () => {
        calls++;
        return { page: ["x"], isDone: false, continueCursor: "same" };
      },
      1000,
      5,
    );
    expect(calls).toBe(5);
    expect(result).toHaveLength(5);
  });
});
