/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { seedPayoutWorld, type T } from "./payouts.fixtures";

const modules = import.meta.glob("./**/*.ts");

const NOW = Date.parse("2026-11-14T06:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function fundraiser(
  t: T,
  creatorId: Id<"users">,
  over: Partial<Doc<"fundraisers">> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("fundraisers", {
      creatorId,
      beneficiaryType: "SELF",
      title: "A fundraiser",
      story: "A story that is long enough to be a story.",
      type: "EDUCATION",
      goalAmount: 1000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status: "ACTIVE",
      isPrivate: false,
      isVerified: false,
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    }),
  );
}

function organization(
  t: T,
  createdBy: Id<"users">,
  slug: string,
  verificationStatus: Doc<"organizations">["verificationStatus"],
) {
  return t.run((ctx) =>
    ctx.db.insert("organizations", {
      name: slug,
      slug,
      verificationStatus,
      createdBy,
      createdAt: NOW,
      updatedAt: NOW + 5,
    }),
  );
}

async function listedFundraisers(t: T) {
  const result = await t.query(api.sitemap.fundraiserPage, {
    now: NOW,
    paginationOpts: { numItems: 100, cursor: null },
  });
  return result.page.map((entry) => entry.id);
}

describe("sitemap.fundraiserPage", () => {
  it("lists only fundraisers search engines should see", async () => {
    const t = convexTest(schema, modules);
    const owner = (await seedPayoutWorld(t)).ids.owner;
    const live = await fundraiser(t, owner);
    // Every one of these has a page, and none should be promoted.
    for (const status of [
      "DRAFT",
      "PENDING_REVIEW",
      "PAUSED",
      "COMPLETED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
    ] as const) {
      await fundraiser(t, owner, { status });
    }
    await fundraiser(t, owner, { isPrivate: true });
    await fundraiser(t, owner, { isFlagged: true });
    await fundraiser(t, owner, { endDate: NOW - DAY });
    await fundraiser(t, owner, { startDate: NOW + DAY });
    const running = await fundraiser(t, owner, {
      startDate: NOW - DAY,
      endDate: NOW + DAY,
    });
    const seedFundraiser = (await t.run((ctx) =>
      ctx.db.query("fundraisers").first(),
    ))!;

    const ids = await listedFundraisers(t);
    // The one the fixture made is public and active too.
    expect(new Set(ids)).toEqual(new Set([live, running, seedFundraiser._id]));
  });

  it("gives the id and when it last changed, and nothing else", async () => {
    const t = convexTest(schema, modules);
    const owner = (await seedPayoutWorld(t)).ids.owner;
    await t.run(async (ctx) => {
      for (const f of await ctx.db.query("fundraisers").collect()) {
        await ctx.db.delete(f._id);
      }
    });
    const id = await fundraiser(t, owner, { updatedAt: NOW + 123 });
    const result = await t.query(api.sitemap.fundraiserPage, {
      now: NOW,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(result.page).toEqual([{ id, updatedAt: NOW + 123 }]);
  });

  it("pages through the whole list", async () => {
    const t = convexTest(schema, modules);
    const owner = (await seedPayoutWorld(t)).ids.owner;
    for (let i = 0; i < 7; i++) await fundraiser(t, owner);
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const result: Awaited<
        ReturnType<typeof t.query<typeof api.sitemap.fundraiserPage>>
      > = await t.query(api.sitemap.fundraiserPage, {
        now: NOW,
        paginationOpts: { numItems: 3, cursor },
      });
      for (const entry of result.page) seen.add(entry.id);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen.size).toBe(8);
  });
});

describe("sitemap.organizationPage", () => {
  it("lists verified organizations only", async () => {
    const t = convexTest(schema, modules);
    const owner = (await seedPayoutWorld(t)).ids.owner;
    await organization(t, owner, "verified-one", "VERIFIED");
    await organization(t, owner, "not-yet-checked", "UNVERIFIED");
    await organization(t, owner, "being-reviewed", "PENDING_REVIEW");
    await organization(t, owner, "turned-down", "REJECTED");

    const result = await t.query(api.sitemap.organizationPage, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(result.page).toEqual([{ slug: "verified-one", updatedAt: NOW + 5 }]);
  });
});
