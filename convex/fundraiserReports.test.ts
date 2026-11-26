/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  checkReportDetails,
  FUNDRAISER_REPORT_REASONS,
  FUNDRAISER_REPORT_WINDOW_MS,
  fundraiserIdFromInput,
  MAX_FUNDRAISER_REPORTS_PER_DAY,
  MAX_REPORT_DETAILS_LENGTH,
  MIN_OTHER_DETAILS_LENGTH,
} from "../lib/fundraiser-reports";
import { DONATIONS_CLOSED_MESSAGE } from "./lib/donationGate";
import {
  canCommentOn,
  canEmailDonorsAbout,
  isOpenToThePublic,
  isPubliclyVisible,
  isSuspended,
} from "./lib/fundraiserAccess";

// The real auth component needs a running Better Auth deployment. These tests
// only need `safeGetAuthUser`, so it reads the identity convex-test attaches.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject, emailVerified: true } : null;
    },
  },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const NOW = Date.parse("2026-11-21T09:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const REASON = "Photos are taken from another family's appeal.";
const NOTE = "Checked the photos against the original appeal.";

async function setup() {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const user = (
      authUserId: string,
      displayName: string,
      role: Doc<"users">["role"] = "USER",
      extra: Partial<Doc<"users">> = {},
    ) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: NOW - 30 * DAY,
        updatedAt: NOW - 30 * DAY,
        ...extra,
      });

    const owner = await user("auth_owner", "Fund Raiser", "USER", {
      phoneNumber: "+254712345678",
    });
    const alice = await user("auth_alice", "Alice Wanjiru");
    const bob = await user("auth_bob", "Bob Otieno");
    const carol = await user("auth_carol", "Carol Achieng");
    const stranger = await user("auth_stranger", "Someone Else");
    const mod = await user("auth_mod", "Mo Derator", "MODERATOR");
    const admin = await user("auth_admin", "Ad Min", "ADMIN");

    const fundraiser = (extra: Partial<Doc<"fundraisers">> = {}) =>
      ctx.db.insert("fundraisers", {
        creatorId: owner,
        beneficiaryType: "SELF",
        title: "Water for Kajiado",
        story: "A story that is long enough to be a story.",
        type: "COMMUNITY_HARAMBEE",
        goalAmount: 100000,
        currency: "KES",
        amountRaised: 25000,
        donorCount: 12,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: NOW - 10 * DAY,
        updatedAt: NOW - 10 * DAY,
        ...extra,
      });

    return {
      owner,
      alice,
      bob,
      carol,
      stranger,
      mod,
      admin,
      fundraiserId: await fundraiser(),
      secondId: await fundraiser({ title: "School fees for Achieng" }),
      privateId: await fundraiser({ isPrivate: true }),
      draftId: await fundraiser({ status: "DRAFT" }),
      pendingId: await fundraiser({ status: "PENDING_REVIEW" }),
      rejectedId: await fundraiser({ status: "REJECTED" }),
      pausedId: await fundraiser({ status: "PAUSED" }),
      completedId: await fundraiser({ status: "COMPLETED" }),
      expiredId: await fundraiser({ status: "EXPIRED" }),
      // Already suspended, the way the flag has always been set.
      flaggedId: await fundraiser({ isFlagged: true }),
    };
  });

  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "auth_owner" }),
    alice: t.withIdentity({ subject: "auth_alice" }),
    bob: t.withIdentity({ subject: "auth_bob" }),
    carol: t.withIdentity({ subject: "auth_carol" }),
    stranger: t.withIdentity({ subject: "auth_stranger" }),
    mod: t.withIdentity({ subject: "auth_mod" }),
    admin: t.withIdentity({ subject: "auth_admin" }),
  };
}
type S = Awaited<ReturnType<typeof setup>>;
type Client = S["alice"];

const reportOf = (
  who: Client,
  fundraiserId: Id<"fundraisers">,
  reason: (typeof FUNDRAISER_REPORT_REASONS)[number] = "SCAM",
  details?: string,
) =>
  who.mutation(api.fundraiserReports.report, { fundraiserId, reason, details });

const reportRows = (t: T, fundraiserId?: Id<"fundraisers">) =>
  t.run(async (ctx) => {
    const rows = await ctx.db.query("fundraiserReports").collect();
    return fundraiserId
      ? rows.filter((row) => row.fundraiserId === fundraiserId)
      : rows;
  });

const suspensionRows = (t: T, fundraiserId: Id<"fundraisers">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("fundraiserSuspensions").collect()).filter(
      (row) => row.fundraiserId === fundraiserId,
    ),
  );

const holdRows = (t: T, fundraiserId: Id<"fundraisers">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("fundraiserPayoutHolds").collect()).filter(
      (row) => row.fundraiserId === fundraiserId,
    ),
  );

const auditRows = (t: T, fundraiserId: Id<"fundraisers">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("adminAuditLog").collect()).filter(
      (row) => row.fundraiserId === fundraiserId,
    ),
  );

const fundraiserDoc = (t: T, id: Id<"fundraisers">) =>
  t.run((ctx) => ctx.db.get(id));

const suspend = (
  who: Client,
  fundraiserId: Id<"fundraisers">,
  reason = REASON,
  holdPayouts = true,
) =>
  who.mutation(api.fundraiserReports.suspend, {
    fundraiserId,
    reason,
    holdPayouts,
  });

const reinstate = (who: Client, fundraiserId: Id<"fundraisers">, note = NOTE) =>
  who.mutation(api.fundraiserReports.reinstate, { fundraiserId, note });

/** Several people report the same fundraiser. */
async function reportedBy(s: S, who: Client[], id: Id<"fundraisers">) {
  for (const person of who) await reportOf(person, id, "SCAM");
}

// ---- The rules --------------------------------------------------------

describe("what a report may say", () => {
  it("takes no details for most reasons, and tidies the ones it is given", () => {
    expect(checkReportDetails("SCAM", undefined)).toEqual({
      ok: true,
      details: undefined,
    });
    expect(checkReportDetails("SCAM", "  \n  ")).toEqual({
      ok: true,
      details: undefined,
    });
    expect(
      checkReportDetails("FALSE_STORY", "  The hospital\r\nsays no.  "),
    ).toEqual({ ok: true, details: "The hospital\nsays no." });
  });

  it("needs a few words when the reason is 'something else'", () => {
    const short = "x".repeat(MIN_OTHER_DETAILS_LENGTH - 1);
    expect(checkReportDetails("OTHER", undefined).ok).toBe(false);
    expect(checkReportDetails("OTHER", short).ok).toBe(false);
    expect(
      checkReportDetails("OTHER", "x".repeat(MIN_OTHER_DETAILS_LENGTH)).ok,
    ).toBe(true);
    // Another reason doesn't need them.
    expect(checkReportDetails("SCAM", short).ok).toBe(true);
  });

  it("stops at the longest it takes", () => {
    expect(
      checkReportDetails("SCAM", "x".repeat(MAX_REPORT_DETAILS_LENGTH)).ok,
    ).toBe(true);
    expect(
      checkReportDetails("SCAM", "x".repeat(MAX_REPORT_DETAILS_LENGTH + 1)).ok,
    ).toBe(false);
  });
});

describe("who can see a suspended fundraiser", () => {
  const base = {
    isPrivate: false,
    status: "ACTIVE",
    commentsEnabled: undefined,
  } as Doc<"fundraisers">;

  it("is anyone, unless it is suspended", () => {
    expect(isPubliclyVisible({ ...base })).toBe(true);
    expect(isPubliclyVisible({ ...base, isFlagged: false })).toBe(true);
    expect(isPubliclyVisible({ ...base, isFlagged: true })).toBe(false);
  });

  it("knows a suspended one from one that was never open", () => {
    const suspended = { ...base, isFlagged: true };
    expect(isSuspended(suspended)).toBe(true);
    expect(isOpenToThePublic(suspended)).toBe(true);
    expect(isSuspended({ ...base })).toBe(false);
    expect(isSuspended({ ...base, isFlagged: false })).toBe(false);
    for (const hidden of [
      { ...base, isPrivate: true, isFlagged: true },
      { ...base, status: "DRAFT", isFlagged: true },
      { ...base, status: "REJECTED", isFlagged: true },
    ] as Doc<"fundraisers">[]) {
      expect(isOpenToThePublic(hidden)).toBe(false);
    }
  });

  it("takes no comments and sends no emails while suspended", () => {
    expect(canCommentOn({ ...base })).toBe(true);
    expect(canEmailDonorsAbout({ ...base })).toBe(true);
    expect(canCommentOn({ ...base, isFlagged: true })).toBe(false);
    expect(canEmailDonorsAbout({ ...base, isFlagged: true })).toBe(false);
  });
});

// ---- Reporting --------------------------------------------------------

describe("reporting a fundraiser", () => {
  it("needs a signed-in person", async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.fundraiserReports.report, {
        fundraiserId: s.ids.fundraiserId,
        reason: "SCAM",
      }),
    ).rejects.toThrow("You must be signed in.");
    expect(await reportRows(s.t)).toHaveLength(0);
  });

  it("is kept for staff, with who made it and when", async () => {
    const s = await setup();
    await reportOf(
      s.alice,
      s.ids.fundraiserId,
      "FALSE_STORY",
      "  No such clinic. ",
    );
    const [row] = await reportRows(s.t);
    expect(row).toMatchObject({
      fundraiserId: s.ids.fundraiserId,
      reporterUserId: s.ids.alice,
      reason: "FALSE_STORY",
      details: "No such clinic.",
      status: "OPEN",
      createdAt: NOW,
    });
    expect(row.resolvedBy).toBeUndefined();
    expect(row.resolvedAt).toBeUndefined();
  });

  it("keeps no details when none are given", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId, "SCAM", "   ");
    const [row] = await reportRows(s.t);
    expect(row.details).toBeUndefined();
  });

  it("takes every reason the form offers", async () => {
    const s = await setup();
    // One fundraiser for each reason, so none is a repeat of an earlier report.
    const targets = [
      s.ids.fundraiserId,
      s.ids.secondId,
      s.ids.pausedId,
      s.ids.completedId,
      s.ids.expiredId,
      await s.t.run((ctx) =>
        ctx.db.insert("fundraisers", {
          creatorId: s.ids.owner,
          beneficiaryType: "SELF",
          title: "Sixth fundraiser",
          story: "A story that is long enough to be a story.",
          type: "OTHER",
          goalAmount: 1000,
          currency: "KES",
          amountRaised: 0,
          donorCount: 0,
          status: "ACTIVE",
          isPrivate: false,
          isVerified: false,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ),
    ];
    expect(targets).toHaveLength(FUNDRAISER_REPORT_REASONS.length);
    for (const [i, reason] of FUNDRAISER_REPORT_REASONS.entries()) {
      await reportOf(
        s.alice,
        targets[i],
        reason,
        "Something is clearly wrong here.",
      );
    }
    const stored = (await reportRows(s.t)).map((row) => row.reason).sort();
    expect(stored).toEqual([...FUNDRAISER_REPORT_REASONS].sort());
  });

  it("turns away a reason it doesn't know", async () => {
    const s = await setup();
    await expect(
      s.alice.mutation(api.fundraiserReports.report, {
        fundraiserId: s.ids.fundraiserId,
        reason: "BECAUSE" as never,
      }),
    ).rejects.toThrow();
    expect(await reportRows(s.t)).toHaveLength(0);
  });

  it("asks for a few words when the reason is 'something else'", async () => {
    const s = await setup();
    await expect(
      reportOf(s.alice, s.ids.fundraiserId, "OTHER"),
    ).rejects.toThrow("Tell us in a few words what is wrong.");
    await expect(
      reportOf(s.alice, s.ids.fundraiserId, "OTHER", "bad"),
    ).rejects.toThrow("Tell us in a few words what is wrong.");
    expect(await reportRows(s.t)).toHaveLength(0);

    await reportOf(
      s.alice,
      s.ids.fundraiserId,
      "OTHER",
      "Money goes to a stranger.",
    );
    expect(await reportRows(s.t)).toHaveLength(1);
  });

  it("stops details that run too long", async () => {
    const s = await setup();
    await expect(
      reportOf(
        s.alice,
        s.ids.fundraiserId,
        "SCAM",
        "x".repeat(MAX_REPORT_DETAILS_LENGTH + 1),
      ),
    ).rejects.toThrow(/Keep it under/);
    await reportOf(
      s.alice,
      s.ids.fundraiserId,
      "SCAM",
      "x".repeat(MAX_REPORT_DETAILS_LENGTH),
    );
    expect(await reportRows(s.t)).toHaveLength(1);
  });

  it("isn't for your own fundraiser", async () => {
    const s = await setup();
    await expect(reportOf(s.owner, s.ids.fundraiserId)).rejects.toThrow(
      "You can't report your own fundraiser.",
    );
    expect(await reportRows(s.t)).toHaveLength(0);
  });

  it("only finds a fundraiser the public can see", async () => {
    const s = await setup();
    for (const id of [
      s.ids.privateId,
      s.ids.draftId,
      s.ids.pendingId,
      s.ids.rejectedId,
      s.ids.flaggedId,
    ]) {
      await expect(reportOf(s.alice, id), id).rejects.toThrow(
        "Fundraiser not found.",
      );
    }
    // One that doesn't exist reads the same.
    const gone = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("fundraisers", {
        creatorId: s.ids.owner,
        beneficiaryType: "SELF",
        title: "Gone",
        story: "A story that is long enough to be a story.",
        type: "OTHER",
        goalAmount: 1,
        currency: "KES",
        amountRaised: 0,
        donorCount: 0,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(reportOf(s.alice, gone)).rejects.toThrow(
      "Fundraiser not found.",
    );
    expect(await reportRows(s.t)).toHaveLength(0);
  });

  it("still takes a report once the fundraiser is paused, finished or ended", async () => {
    const s = await setup();
    for (const id of [s.ids.pausedId, s.ids.completedId, s.ids.expiredId]) {
      await reportOf(s.alice, id, "SCAM");
    }
    expect(await reportRows(s.t)).toHaveLength(3);
  });

  it("changes nothing when the same person reports again before staff look", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId, "SCAM");
    await reportOf(
      s.alice,
      s.ids.fundraiserId,
      "FALSE_STORY",
      "Different words.",
    );
    const rows = await reportRows(s.t, s.ids.fundraiserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("SCAM");
  });

  it("counts a different person's report", async () => {
    const s = await setup();
    await reportedBy(s, [s.alice, s.bob, s.carol], s.ids.fundraiserId);
    expect(await reportRows(s.t, s.ids.fundraiserId)).toHaveLength(3);
  });

  it("takes a new report from someone whose last one was closed", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId, "SCAM");
    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    await reportOf(s.alice, s.ids.fundraiserId, "SCAM");
    const rows = await reportRows(s.t, s.ids.fundraiserId);
    expect(rows.map((row) => row.status).sort()).toEqual(["DISMISSED", "OPEN"]);
  });

  describe("the daily limit", () => {
    it("is ten reports in a day", () => {
      // A product decision, so changing it should be on purpose.
      expect(MAX_FUNDRAISER_REPORTS_PER_DAY).toBe(10);
      expect(FUNDRAISER_REPORT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    });

    async function manyFundraisers(s: S, count: number) {
      return await s.t.run(async (ctx) => {
        const ids: Id<"fundraisers">[] = [];
        for (let i = 0; i < count; i++) {
          ids.push(
            await ctx.db.insert("fundraisers", {
              creatorId: s.ids.owner,
              beneficiaryType: "SELF",
              title: `Fundraiser ${i}`,
              story: "A story that is long enough to be a story.",
              type: "OTHER",
              goalAmount: 1000,
              currency: "KES",
              amountRaised: 0,
              donorCount: 0,
              status: "ACTIVE",
              isPrivate: false,
              isVerified: false,
              createdAt: NOW,
              updatedAt: NOW,
            }),
          );
        }
        return ids;
      });
    }

    it("lets one person report so many fundraisers in a day, and no more", async () => {
      const s = await setup();
      const ids = await manyFundraisers(s, MAX_FUNDRAISER_REPORTS_PER_DAY + 1);
      for (const id of ids.slice(0, MAX_FUNDRAISER_REPORTS_PER_DAY)) {
        await reportOf(s.alice, id);
      }
      await expect(
        reportOf(s.alice, ids[MAX_FUNDRAISER_REPORTS_PER_DAY]),
      ).rejects.toThrow("You've sent a lot of reports today.");
      expect(await reportRows(s.t)).toHaveLength(
        MAX_FUNDRAISER_REPORTS_PER_DAY,
      );

      // Someone else is not held to it.
      await reportOf(s.bob, ids[MAX_FUNDRAISER_REPORTS_PER_DAY]);
    });

    it("starts again once the day is up, and not before", async () => {
      const s = await setup();
      const ids = await manyFundraisers(s, MAX_FUNDRAISER_REPORTS_PER_DAY + 1);
      for (const id of ids.slice(0, MAX_FUNDRAISER_REPORTS_PER_DAY)) {
        await reportOf(s.alice, id);
      }
      const last = ids[MAX_FUNDRAISER_REPORTS_PER_DAY];

      vi.setSystemTime(NOW + FUNDRAISER_REPORT_WINDOW_MS - HOUR);
      await expect(reportOf(s.alice, last)).rejects.toThrow(
        "You've sent a lot of reports today.",
      );

      vi.setSystemTime(NOW + FUNDRAISER_REPORT_WINDOW_MS + HOUR);
      await reportOf(s.alice, last);
    });

    it("doesn't count a repeat of a report that is still waiting", async () => {
      const s = await setup();
      const ids = await manyFundraisers(s, MAX_FUNDRAISER_REPORTS_PER_DAY);
      await reportOf(s.alice, ids[0]);
      for (let i = 0; i < 5; i++) await reportOf(s.alice, ids[0]);
      for (const id of ids.slice(1)) await reportOf(s.alice, id);
      expect(await reportRows(s.t)).toHaveLength(
        MAX_FUNDRAISER_REPORTS_PER_DAY,
      );
    });

    it("doesn't count a report that was refused", async () => {
      const s = await setup();
      const ids = await manyFundraisers(s, MAX_FUNDRAISER_REPORTS_PER_DAY);
      for (let i = 0; i < 5; i++) {
        await expect(reportOf(s.alice, s.ids.privateId)).rejects.toThrow();
        await expect(reportOf(s.alice, ids[0], "OTHER")).rejects.toThrow();
      }
      for (const id of ids) await reportOf(s.alice, id);
    });
  });
});

// ---- The staff queue --------------------------------------------------

describe("the reported fundraisers", () => {
  it("is for staff only", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId);
    expect(await s.t.query(api.fundraiserReports.listReported, {})).toEqual([]);
    expect(await s.owner.query(api.fundraiserReports.listReported, {})).toEqual(
      [],
    );
    expect(await s.alice.query(api.fundraiserReports.listReported, {})).toEqual(
      [],
    );
    expect(
      await s.mod.query(api.fundraiserReports.listReported, {}),
    ).toHaveLength(1);
    expect(
      await s.admin.query(api.fundraiserReports.listReported, {}),
    ).toHaveLength(1);
  });

  it("is empty when nobody has reported anything", async () => {
    const s = await setup();
    expect(await s.mod.query(api.fundraiserReports.listReported, {})).toEqual(
      [],
    );
  });

  it("gathers a fundraiser's reports into one row", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId, "SCAM");
    vi.setSystemTime(NOW + HOUR);
    await reportOf(s.bob, s.ids.fundraiserId, "SCAM");
    await reportOf(s.carol, s.ids.fundraiserId, "FALSE_STORY");

    const rows = await s.mod.query(api.fundraiserReports.listReported, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fundraiserId: s.ids.fundraiserId,
      title: "Water for Kajiado",
      status: "ACTIVE",
      suspended: false,
      ownerName: "Fund Raiser",
      amountRaised: 25000,
      currency: "KES",
      donorCount: 12,
      reportCount: 3,
      firstReportedAt: NOW,
    });
    expect(rows[0].reasons).toEqual(
      expect.arrayContaining([
        { reason: "SCAM", count: 2 },
        { reason: "FALSE_STORY", count: 1 },
      ]),
    );
    expect(rows[0].reasons).toHaveLength(2);
  });

  it("puts the fundraiser with the most reports first, then the oldest", async () => {
    const s = await setup();
    // One report on the first, two on the second, one on the third, the first
    // reported earliest.
    await reportOf(s.alice, s.ids.fundraiserId);
    vi.setSystemTime(NOW + HOUR);
    await reportOf(s.alice, s.ids.secondId);
    await reportOf(s.bob, s.ids.secondId);
    vi.setSystemTime(NOW + 2 * HOUR);
    await reportOf(s.alice, s.ids.pausedId);

    const rows = await s.mod.query(api.fundraiserReports.listReported, {});
    expect(rows.map((row) => row.fundraiserId)).toEqual([
      s.ids.secondId,
      s.ids.fundraiserId,
      s.ids.pausedId,
    ]);
  });

  it("leaves out reports that have been dealt with", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId);
    await reportOf(s.alice, s.ids.secondId);
    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    const rows = await s.mod.query(api.fundraiserReports.listReported, {});
    expect(rows.map((row) => row.fundraiserId)).toEqual([s.ids.secondId]);
  });

  it("marks a fundraiser that is suspended", async () => {
    const s = await setup();
    // Reports are closed when a fundraiser is suspended, so this can only
    // happen to a fundraiser flagged some other way; the queue still says so.
    await s.t.run(async (ctx) => {
      await ctx.db.insert("fundraiserReports", {
        fundraiserId: s.ids.flaggedId,
        reporterUserId: s.ids.alice,
        reason: "SCAM",
        status: "OPEN",
        createdAt: NOW,
      });
    });
    await reportOf(s.alice, s.ids.fundraiserId);
    const rows = await s.mod.query(api.fundraiserReports.listReported, {});
    expect(
      Object.fromEntries(rows.map((row) => [row.fundraiserId, row.suspended])),
    ).toEqual({ [s.ids.flaggedId]: true, [s.ids.fundraiserId]: false });
  });

  it("stops at a screenful", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        const id = await ctx.db.insert("fundraisers", {
          creatorId: s.ids.owner,
          beneficiaryType: "SELF",
          title: `Fundraiser ${i}`,
          story: "A story that is long enough to be a story.",
          type: "OTHER",
          goalAmount: 1000,
          currency: "KES",
          amountRaised: 0,
          donorCount: 0,
          status: "ACTIVE",
          isPrivate: false,
          isVerified: false,
          createdAt: NOW,
          updatedAt: NOW,
        });
        await ctx.db.insert("fundraiserReports", {
          fundraiserId: id,
          reporterUserId: s.ids.alice,
          reason: "SCAM",
          status: "OPEN",
          createdAt: NOW + i,
        });
      }
    });
    const rows = await s.mod.query(api.fundraiserReports.listReported, {});
    expect(rows).toHaveLength(50);
    // Oldest first among equals.
    expect(rows[0].title).toBe("Fundraiser 0");
  });
});

// ---- The review page --------------------------------------------------

describe("reviewing a fundraiser", () => {
  it("is for staff only", async () => {
    const s = await setup();
    const args = { fundraiserId: s.ids.fundraiserId };
    expect(await s.t.query(api.fundraiserReports.getForStaff, args)).toBeNull();
    expect(
      await s.owner.query(api.fundraiserReports.getForStaff, args),
    ).toBeNull();
    expect(
      await s.alice.query(api.fundraiserReports.getForStaff, args),
    ).toBeNull();
    expect(
      await s.mod.query(api.fundraiserReports.getForStaff, args),
    ).not.toBeNull();
    expect(
      await s.admin.query(api.fundraiserReports.getForStaff, args),
    ).not.toBeNull();
  });

  it("works for any fundraiser, and says nothing for one that doesn't exist", async () => {
    const s = await setup();
    for (const id of [s.ids.privateId, s.ids.draftId, s.ids.flaggedId]) {
      expect(
        await s.mod.query(api.fundraiserReports.getForStaff, {
          fundraiserId: id,
        }),
      ).not.toBeNull();
    }
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete(s.ids.secondId);
      return s.ids.secondId;
    });
    expect(
      await s.mod.query(api.fundraiserReports.getForStaff, {
        fundraiserId: gone,
      }),
    ).toBeNull();
  });

  it("says nothing for an address that was mistyped, instead of failing", async () => {
    const s = await setup();
    for (const fundraiserId of ["", "abc", "not an id at all", s.ids.alice]) {
      expect(
        await s.mod.query(api.fundraiserReports.getForStaff, { fundraiserId }),
      ).toBeNull();
    }
  });

  it("shows what it says and who is behind it", async () => {
    const s = await setup();
    const view = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(view?.fundraiser).toMatchObject({
      _id: s.ids.fundraiserId,
      title: "Water for Kajiado",
      tagline: null,
      status: "ACTIVE",
      isPrivate: false,
      suspended: false,
      goalAmount: 100000,
      amountRaised: 25000,
      currency: "KES",
      donorCount: 12,
      coverImageUrl: null,
    });
    expect(view?.owner).toMatchObject({
      _id: s.ids.owner,
      name: "Fund Raiser",
      email: "auth_owner@example.test",
      phoneNumber: "+254712345678",
      joinedAt: NOW - 30 * DAY,
      kycTier: 0,
    });
  });

  it("lists the owner's other fundraisers, but not this one", async () => {
    const s = await setup();
    const view = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    const others = view?.owner?.otherFundraisers ?? [];
    expect(others.some((other) => other._id === s.ids.fundraiserId)).toBe(
      false,
    );
    expect(others.map((other) => other._id)).toEqual(
      expect.arrayContaining([s.ids.secondId, s.ids.flaggedId]),
    );
    expect(
      others.find((other) => other._id === s.ids.flaggedId)?.suspended,
    ).toBe(true);
    expect(
      others.find((other) => other._id === s.ids.secondId)?.suspended,
    ).toBe(false);
  });

  it("shows the money at stake", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      ctx.db.insert("fundraiserBalances", {
        fundraiserId: s.ids.fundraiserId,
        settledNet: 20000,
        pendingNet: 1500,
        reserved: 2000,
        paid: 5000,
        updatedAt: NOW,
      }),
    );
    const view = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(view?.money).toEqual({
      paidOut: 5000,
      available: 13000,
      pending: 1500,
    });

    const empty = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.secondId,
    });
    expect(empty?.money).toEqual({ paidOut: 0, available: 0, pending: 0 });
  });

  it("shows who reported it and what they said, the open reports first", async () => {
    const s = await setup();
    await reportOf(
      s.alice,
      s.ids.fundraiserId,
      "SCAM",
      "The number isn't theirs.",
    );
    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    vi.setSystemTime(NOW + HOUR);
    await reportOf(s.bob, s.ids.fundraiserId, "FALSE_STORY");

    const view = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(
      view?.reports.map((item) => [item.reporterName, item.status]),
    ).toEqual([
      ["Bob Otieno", "OPEN"],
      ["Alice Wanjiru", "DISMISSED"],
    ]);
    expect(view?.reports[1]).toMatchObject({
      reason: "SCAM",
      details: "The number isn't theirs.",
      reporterEmail: "auth_alice@example.test",
    });
    expect(view?.reports[0].details).toBeNull();
  });

  it("shows whether payouts are held", async () => {
    const s = await setup();
    const none = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(none?.payoutHold).toBeNull();

    await s.mod.mutation(api.admin.placePayoutHold, {
      fundraiserId: s.ids.fundraiserId,
      reason: "Waiting on proof of the hospital bill.",
    });
    const held = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(held?.payoutHold).toMatchObject({
      reason: "Waiting on proof of the hospital bill.",
      placedAt: NOW,
      placedByName: "Mo Derator",
    });
  });

  it("shows what staff have done, newest first", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    vi.setSystemTime(NOW + HOUR);
    await reinstate(s.admin, s.ids.fundraiserId);

    const view = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(view?.history.map((entry) => entry.action)).toEqual([
      "FUNDRAISER_REINSTATED",
      "FUNDRAISER_SUSPENDED",
      "PAYOUT_HOLD_PLACED",
    ]);
    expect(view?.history[0]).toMatchObject({
      actorName: "Ad Min",
      note: NOTE,
      at: NOW + HOUR,
    });
    expect(view?.suspensions).toHaveLength(1);
    expect(view?.suspensions[0]).toMatchObject({
      status: "LIFTED",
      reason: REASON,
      placedByName: "Mo Derator",
      liftedByName: "Ad Min",
      liftNote: NOTE,
      liftedAt: NOW + HOUR,
    });
  });
});

// ---- Suspending -------------------------------------------------------

describe("suspending a fundraiser", () => {
  it("is for staff", async () => {
    const s = await setup();
    const args = {
      fundraiserId: s.ids.fundraiserId,
      reason: REASON,
      holdPayouts: true,
    };
    await expect(
      s.t.mutation(api.fundraiserReports.suspend, args),
    ).rejects.toThrow("You must be signed in.");
    await expect(
      s.alice.mutation(api.fundraiserReports.suspend, args),
    ).rejects.toThrow("You don't have permission to do that.");
    // Not even the organizer's own fundraiser.
    await expect(
      s.owner.mutation(api.fundraiserReports.suspend, args),
    ).rejects.toThrow("You don't have permission to do that.");

    const doc = await fundraiserDoc(s.t, s.ids.fundraiserId);
    expect(doc?.isFlagged).toBeUndefined();
    expect(await suspensionRows(s.t, s.ids.fundraiserId)).toHaveLength(0);
    expect(await holdRows(s.t, s.ids.fundraiserId)).toHaveLength(0);
  });

  it("works for a moderator and for an admin", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    await suspend(s.admin, s.ids.secondId);
    expect((await fundraiserDoc(s.t, s.ids.fundraiserId))?.isFlagged).toBe(
      true,
    );
    expect((await fundraiserDoc(s.t, s.ids.secondId))?.isFlagged).toBe(true);
  });

  it("needs a reason the organizer can read", async () => {
    const s = await setup();
    for (const reason of ["", "   ", "Too short", "x".repeat(1001)]) {
      await expect(
        suspend(s.mod, s.ids.fundraiserId, reason),
        JSON.stringify(reason),
      ).rejects.toThrow();
    }
    expect(
      (await fundraiserDoc(s.t, s.ids.fundraiserId))?.isFlagged,
    ).toBeUndefined();
    expect(await suspensionRows(s.t, s.ids.fundraiserId)).toHaveLength(0);
    // Ten characters will do.
    await suspend(s.mod, s.ids.fundraiserId, "0123456789");
  });

  it("says when there is no such fundraiser", async () => {
    const s = await setup();
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete(s.ids.secondId);
      return s.ids.secondId;
    });
    await expect(suspend(s.mod, gone)).rejects.toThrow("Fundraiser not found.");
  });

  it("can't suspend one that is already suspended", async () => {
    const s = await setup();
    await expect(suspend(s.mod, s.ids.flaggedId)).rejects.toThrow(
      "This fundraiser is already suspended.",
    );
    await suspend(s.mod, s.ids.fundraiserId);
    await expect(suspend(s.admin, s.ids.fundraiserId)).rejects.toThrow(
      "This fundraiser is already suspended.",
    );
    expect(await suspensionRows(s.t, s.ids.fundraiserId)).toHaveLength(1);
  });

  it("flags it, keeps its status, and records why, who and when", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId, `  ${REASON}  `);

    const doc = await fundraiserDoc(s.t, s.ids.fundraiserId);
    expect(doc).toMatchObject({
      isFlagged: true,
      status: "ACTIVE",
      updatedAt: NOW,
    });

    const [suspension] = await suspensionRows(s.t, s.ids.fundraiserId);
    expect(suspension).toMatchObject({
      status: "ACTIVE",
      reason: REASON,
      placedBy: s.ids.mod,
      placedAt: NOW,
    });
    expect(suspension.liftedAt).toBeUndefined();
  });

  it("keeps the reason off the fundraiser itself, which is public", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    const doc = await fundraiserDoc(s.t, s.ids.fundraiserId);
    expect(JSON.stringify(doc)).not.toContain(REASON);
  });

  it("closes the open reports on it as acted on, and leaves old ones as they were", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId);
    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    const dismissedBefore = (await reportRows(s.t, s.ids.fundraiserId))[0];
    expect(dismissedBefore).toMatchObject({
      status: "DISMISSED",
      resolvedBy: s.ids.mod,
    });
    vi.setSystemTime(NOW + HOUR);
    await reportedBy(s, [s.alice, s.bob], s.ids.fundraiserId);
    await reportOf(s.carol, s.ids.secondId);

    vi.setSystemTime(NOW + 2 * HOUR);
    await suspend(s.mod, s.ids.fundraiserId);

    const rows = await reportRows(s.t, s.ids.fundraiserId);
    const byStatus = (status: string) =>
      rows.filter((row) => row.status === status);
    expect(byStatus("DISMISSED")).toEqual([dismissedBefore]);
    expect(byStatus("ACTIONED")).toHaveLength(2);
    for (const row of byStatus("ACTIONED")) {
      expect(row).toMatchObject({
        resolvedBy: s.ids.mod,
        resolvedAt: NOW + 2 * HOUR,
      });
    }
    expect(byStatus("OPEN")).toHaveLength(0);

    // Another fundraiser's reports are not touched.
    const other = await reportRows(s.t, s.ids.secondId);
    expect(other.map((row) => row.status)).toEqual(["OPEN"]);
  });

  it("holds payouts too, unless told not to", async () => {
    const s = await setup();
    const result = await suspend(s.mod, s.ids.fundraiserId);
    expect(result).toEqual({ payoutsOnHold: true });
    const [hold] = await holdRows(s.t, s.ids.fundraiserId);
    expect(hold).toMatchObject({
      status: "ACTIVE",
      reason: `Fundraiser suspended: ${REASON}`,
      placedBy: s.ids.mod,
      placedAt: NOW,
    });

    const without = await suspend(s.mod, s.ids.secondId, REASON, false);
    expect(without).toEqual({ payoutsOnHold: false });
    expect(await holdRows(s.t, s.ids.secondId)).toHaveLength(0);
  });

  it("doesn't hold twice when payouts are held already", async () => {
    const s = await setup();
    await s.mod.mutation(api.admin.placePayoutHold, {
      fundraiserId: s.ids.fundraiserId,
      reason: "Waiting on proof of the hospital bill.",
    });
    const result = await suspend(s.mod, s.ids.fundraiserId);
    expect(result).toEqual({ payoutsOnHold: true });
    const holds = await holdRows(s.t, s.ids.fundraiserId);
    expect(holds).toHaveLength(1);
    expect(holds[0].reason).toBe("Waiting on proof of the hospital bill.");

    // Choosing not to hold, when it is held already, doesn't release it.
    await suspend(s.admin, s.ids.secondId, REASON, false);
    await s.mod.mutation(api.admin.placePayoutHold, {
      fundraiserId: s.ids.pausedId,
      reason: "Waiting on proof of the hospital bill.",
    });
    await suspend(s.admin, s.ids.pausedId, REASON, false);
    expect(await holdRows(s.t, s.ids.pausedId)).toHaveLength(1);
  });

  it("goes in the audit log", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    const entries = await auditRows(s.t, s.ids.fundraiserId);
    const suspended = entries.find(
      (entry) => entry.action === "FUNDRAISER_SUSPENDED",
    );
    expect(suspended).toMatchObject({
      actorId: s.ids.mod,
      fundraiserId: s.ids.fundraiserId,
      statusBefore: "NOT_SUSPENDED",
      statusAfter: "SUSPENDED",
      note: REASON,
      createdAt: NOW,
    });
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      "FUNDRAISER_SUSPENDED",
      "PAYOUT_HOLD_PLACED",
    ]);
  });

  it("leaves the payout hold action as it was", async () => {
    const s = await setup();
    await s.mod.mutation(api.admin.placePayoutHold, {
      fundraiserId: s.ids.fundraiserId,
      reason: "Waiting on proof of the hospital bill.",
    });
    const [hold] = await holdRows(s.t, s.ids.fundraiserId);
    expect(hold).toMatchObject({
      status: "ACTIVE",
      reason: "Waiting on proof of the hospital bill.",
      placedBy: s.ids.mod,
    });
    const [entry] = await auditRows(s.t, s.ids.fundraiserId);
    expect(entry).toMatchObject({
      action: "PAYOUT_HOLD_PLACED",
      statusBefore: "NO_HOLD",
      statusAfter: "ON_HOLD",
    });
    await expect(
      s.mod.mutation(api.admin.placePayoutHold, {
        fundraiserId: s.ids.fundraiserId,
        reason: "Waiting on proof of the hospital bill.",
      }),
    ).rejects.toThrow("already on hold");
  });
});

// ---- What a suspension takes off the public site ----------------------

describe("what a suspended fundraiser looks like", () => {
  const feature = (s: S) =>
    s.t.query(api.fundraiser.listFeaturedFundraisers, { now: NOW });

  it("is gone from the page for everyone but its organizer and staff", async () => {
    const s = await setup();
    const args = { fundraiserId: s.ids.fundraiserId };
    for (const who of [s.t, s.alice, s.stranger]) {
      expect(
        await who.query(api.fundraiser.getFundraiserById, args),
      ).not.toBeNull();
    }

    await suspend(s.mod, s.ids.fundraiserId);

    for (const who of [s.t, s.alice, s.stranger]) {
      expect(
        await who.query(api.fundraiser.getFundraiserById, args),
      ).toBeNull();
    }
    for (const who of [s.owner, s.mod, s.admin]) {
      const seen = await who.query(api.fundraiser.getFundraiserById, args);
      expect(seen?.isFlagged).toBe(true);
    }
  });

  it("drops off the homepage and the category lists", async () => {
    const s = await setup();
    const inCategories = async () =>
      (await s.t.query(api.fundraiser.listFundraisersByType, {}))
        .flatMap((group) => group.fundraisers)
        .map((item) => item._id);

    expect(await inCategories()).toContain(s.ids.fundraiserId);
    expect((await feature(s)).map((item) => item._id)).toContain(
      s.ids.fundraiserId,
    );

    await suspend(s.mod, s.ids.fundraiserId);

    expect(await inCategories()).not.toContain(s.ids.fundraiserId);
    expect((await feature(s)).map((item) => item._id)).not.toContain(
      s.ids.fundraiserId,
    );
    // Others stay.
    expect(await inCategories()).toContain(s.ids.secondId);
    expect(await inCategories()).not.toContain(s.ids.flaggedId);
  });

  it("drops out of search", async () => {
    const s = await setup();
    const found = async () =>
      (
        await s.t.query(api.fundraiser.searchFundraisers, {
          searchTerm: "Kajiado",
        })
      ).map((item) => item._id);

    expect(await found()).toContain(s.ids.fundraiserId);
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await found()).not.toContain(s.ids.fundraiserId);
    // The one that was flagged all along doesn't come up either.
    expect(await found()).not.toContain(s.ids.flaggedId);
  });

  it("drops out of the sitemap", async () => {
    const s = await setup();
    const listed = async () =>
      (
        await s.t.query(api.sitemap.fundraiserPage, {
          now: NOW,
          paginationOpts: { numItems: 100, cursor: null },
        })
      ).page.map((item) => item.id);

    expect(await listed()).toContain(s.ids.fundraiserId);
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await listed()).not.toContain(s.ids.fundraiserId);
  });

  it("drops off its organization's page, embed and public listing", async () => {
    const s = await setup();
    const organizationId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("organizations", {
        name: "Kajiado Water Trust",
        slug: "kajiado-water",
        verificationStatus: "VERIFIED",
        createdBy: s.ids.owner,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.patch(s.ids.fundraiserId, { organizationId: id });
      await ctx.db.patch(s.ids.secondId, { organizationId: id });
      return id;
    });
    const listed = async () =>
      (
        await s.t.query(api.organizations.listOrganizationFundraisers, {
          organizationId,
        })
      ).map((item) => item._id);

    expect(await listed()).toEqual(
      expect.arrayContaining([s.ids.fundraiserId, s.ids.secondId]),
    );
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await listed()).toEqual([s.ids.secondId]);

    // The public API reads it the same way.
    const api2 = await s.t.query(internal.publicApi.getOrganizationForApi, {
      slug: "kajiado-water",
      includeFundraisers: true,
    });
    expect(api2.kind).toBe("ok");
    if (api2.kind === "ok") {
      expect(api2.fundraisers.map((item) => item._id)).toEqual([
        s.ids.secondId,
      ]);
    }
  });

  it("stops counting as an active fundraiser in the public numbers", async () => {
    const s = await setup();
    const active = async () => {
      await s.t.mutation(internal.platformStats.refresh, {});
      return (await s.t.query(api.platformStats.get, {}))?.activeFundraisers;
    };
    const before = await active();
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await active()).toBe((before ?? 0) - 1);
  });

  it("takes no new donations", async () => {
    const s = await setup();
    const donation = (fundraiserId: Id<"fundraisers">) => ({
      fundraiserId,
      grossAmount: 1000,
      currency: "KES" as const,
      isAnonymous: false,
    });
    await s.t.mutation(
      internal.donations.createPendingDonation,
      donation(s.ids.fundraiserId),
    );

    await suspend(s.mod, s.ids.fundraiserId);
    await expect(
      s.t.mutation(
        internal.donations.createPendingDonation,
        donation(s.ids.fundraiserId),
      ),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);
    await expect(
      s.t.mutation(internal.paypal.createPendingPayPalDonation, {
        fundraiserId: s.ids.fundraiserId,
        isAnonymous: false,
        grossAmountKes: 1300,
        platformFeeAmountKes: 55,
        netAmountKes: 1245,
        platformFeeRate: 0.0425,
      }),
    ).rejects.toThrow(DONATIONS_CLOSED_MESSAGE);

    // Another fundraiser still does.
    await s.t.mutation(
      internal.donations.createPendingDonation,
      donation(s.ids.secondId),
    );
  });

  it("is shown to its organizer in their own list, marked", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    const mine = await s.owner.query(api.fundraiser.listMyFundraisers, {});
    expect(
      mine.find((item) => item._id === s.ids.fundraiserId)?.suspended,
    ).toBe(true);
    expect(mine.find((item) => item._id === s.ids.secondId)?.suspended).toBe(
      false,
    );
  });
});

// ---- Putting it back --------------------------------------------------

describe("lifting a suspension", () => {
  it("is for staff", async () => {
    const s = await setup();
    await expect(
      s.t.mutation(api.fundraiserReports.reinstate, {
        fundraiserId: s.ids.flaggedId,
        note: NOTE,
      }),
    ).rejects.toThrow("You must be signed in.");
    await expect(reinstate(s.alice, s.ids.flaggedId)).rejects.toThrow(
      "You don't have permission to do that.",
    );
    await expect(reinstate(s.owner, s.ids.flaggedId)).rejects.toThrow(
      "You don't have permission to do that.",
    );
    expect((await fundraiserDoc(s.t, s.ids.flaggedId))?.isFlagged).toBe(true);
  });

  it("needs a note, and a fundraiser that is suspended", async () => {
    const s = await setup();
    for (const note of ["", "   ", "Too short"]) {
      await expect(reinstate(s.mod, s.ids.flaggedId, note)).rejects.toThrow();
    }
    await expect(reinstate(s.mod, s.ids.fundraiserId)).rejects.toThrow(
      "This fundraiser isn't suspended.",
    );
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete(s.ids.secondId);
      return s.ids.secondId;
    });
    await expect(reinstate(s.mod, gone)).rejects.toThrow(
      "Fundraiser not found.",
    );
    expect((await fundraiserDoc(s.t, s.ids.flaggedId))?.isFlagged).toBe(true);
  });

  it("puts it back on the site, with its status as it was", async () => {
    const s = await setup();
    const args = { fundraiserId: s.ids.fundraiserId };
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await s.t.query(api.fundraiser.getFundraiserById, args)).toBeNull();

    vi.setSystemTime(NOW + HOUR);
    await reinstate(s.mod, s.ids.fundraiserId);

    expect(
      await s.t.query(api.fundraiser.getFundraiserById, args),
    ).toMatchObject({
      status: "ACTIVE",
      isFlagged: false,
    });
    const categories = (
      await s.t.query(api.fundraiser.listFundraisersByType, {})
    )
      .flatMap((group) => group.fundraisers)
      .map((item) => item._id);
    expect(categories).toContain(s.ids.fundraiserId);
    await s.t.mutation(internal.donations.createPendingDonation, {
      fundraiserId: s.ids.fundraiserId,
      grossAmount: 1000,
      currency: "KES",
      isAnonymous: false,
    });
  });

  it("records who lifted it, when, and why", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    vi.setSystemTime(NOW + HOUR);
    await reinstate(s.admin, s.ids.fundraiserId, `  ${NOTE}  `);

    const [suspension] = await suspensionRows(s.t, s.ids.fundraiserId);
    expect(suspension).toMatchObject({
      status: "LIFTED",
      reason: REASON,
      placedBy: s.ids.mod,
      liftedBy: s.ids.admin,
      liftedAt: NOW + HOUR,
      liftNote: NOTE,
    });
    const entry = (await auditRows(s.t, s.ids.fundraiserId)).find(
      (row) => row.action === "FUNDRAISER_REINSTATED",
    );
    expect(entry).toMatchObject({
      actorId: s.ids.admin,
      statusBefore: "SUSPENDED",
      statusAfter: "NOT_SUSPENDED",
      note: NOTE,
    });
  });

  it("leaves a payout hold alone, and says so", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    const result = await reinstate(s.mod, s.ids.fundraiserId);
    expect(result).toEqual({ payoutsOnHold: true });
    expect((await holdRows(s.t, s.ids.fundraiserId))[0].status).toBe("ACTIVE");

    // Only an admin lets it go.
    await expect(
      s.mod.mutation(api.admin.releasePayoutHold, {
        fundraiserId: s.ids.fundraiserId,
        note: "Photos are the family's own.",
      }),
    ).rejects.toThrow("You don't have permission to do that.");
    await s.admin.mutation(api.admin.releasePayoutHold, {
      fundraiserId: s.ids.fundraiserId,
      note: "Photos are the family's own.",
    });
    expect((await holdRows(s.t, s.ids.fundraiserId))[0].status).toBe(
      "RELEASED",
    );
  });

  it("says when no payout hold is left", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId, REASON, false);
    expect(await reinstate(s.mod, s.ids.fundraiserId)).toEqual({
      payoutsOnHold: false,
    });
  });

  it("can be suspended again, with both suspensions kept", async () => {
    const s = await setup();
    await suspend(
      s.mod,
      s.ids.fundraiserId,
      "First reason, for the first time.",
    );
    vi.setSystemTime(NOW + HOUR);
    await reinstate(s.mod, s.ids.fundraiserId);
    vi.setSystemTime(NOW + 2 * HOUR);
    await suspend(s.admin, s.ids.fundraiserId, "Second reason, a second time.");

    const rows = await suspensionRows(s.t, s.ids.fundraiserId);
    expect(rows.map((row) => [row.status, row.reason])).toEqual([
      ["LIFTED", "First reason, for the first time."],
      ["ACTIVE", "Second reason, a second time."],
    ]);
    // The hold is still the first one: it was never released.
    expect(await holdRows(s.t, s.ids.fundraiserId)).toHaveLength(1);

    const view = await s.mod.query(api.fundraiserReports.getForStaff, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(view?.suspensions.map((row) => row.status)).toEqual([
      "ACTIVE",
      "LIFTED",
    ]);
  });

  it("clears a flag that has no record behind it", async () => {
    const s = await setup();
    // The fixture's flagged fundraiser was flagged by hand.
    expect(await suspensionRows(s.t, s.ids.flaggedId)).toHaveLength(0);
    await reinstate(s.mod, s.ids.flaggedId);
    expect((await fundraiserDoc(s.t, s.ids.flaggedId))?.isFlagged).toBe(false);
  });
});

// ---- Dismissing reports -----------------------------------------------

describe("closing reports without suspending", () => {
  it("is for staff", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId);
    const args = { fundraiserId: s.ids.fundraiserId };
    await expect(
      s.t.mutation(api.fundraiserReports.dismissReports, args),
    ).rejects.toThrow("You must be signed in.");
    await expect(
      s.alice.mutation(api.fundraiserReports.dismissReports, args),
    ).rejects.toThrow("You don't have permission to do that.");
    await expect(
      s.owner.mutation(api.fundraiserReports.dismissReports, args),
    ).rejects.toThrow("You don't have permission to do that.");
    expect((await reportRows(s.t))[0].status).toBe("OPEN");
  });

  it("closes the open reports and leaves the fundraiser up", async () => {
    const s = await setup();
    await reportedBy(s, [s.alice, s.bob], s.ids.fundraiserId);
    await reportOf(s.carol, s.ids.secondId);
    vi.setSystemTime(NOW + HOUR);

    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
      note: "  Photos are theirs.  ",
    });

    const rows = await reportRows(s.t, s.ids.fundraiserId);
    expect(rows.map((row) => row.status)).toEqual(["DISMISSED", "DISMISSED"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        resolvedBy: s.ids.mod,
        resolvedAt: NOW + HOUR,
      });
    }
    expect((await reportRows(s.t, s.ids.secondId))[0].status).toBe("OPEN");

    const doc = await fundraiserDoc(s.t, s.ids.fundraiserId);
    expect(doc?.isFlagged).toBeUndefined();
    expect(await suspensionRows(s.t, s.ids.fundraiserId)).toHaveLength(0);
    expect(await holdRows(s.t, s.ids.fundraiserId)).toHaveLength(0);

    const [entry] = await auditRows(s.t, s.ids.fundraiserId);
    expect(entry).toMatchObject({
      actorId: s.ids.mod,
      action: "FUNDRAISER_REPORTS_DISMISSED",
      note: "Photos are theirs.",
    });
  });

  it("records nothing when there was nothing to close", async () => {
    const s = await setup();
    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(await auditRows(s.t, s.ids.fundraiserId)).toHaveLength(0);
  });

  it("brings it back to the queue if someone reports it again", async () => {
    const s = await setup();
    await reportOf(s.alice, s.ids.fundraiserId);
    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect(await s.mod.query(api.fundraiserReports.listReported, {})).toEqual(
      [],
    );
    await reportOf(s.bob, s.ids.fundraiserId);
    expect(
      (await s.mod.query(api.fundraiserReports.listReported, {})).map(
        (row) => row.fundraiserId,
      ),
    ).toEqual([s.ids.fundraiserId]);
  });

  it("says when there is no such fundraiser", async () => {
    const s = await setup();
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete(s.ids.secondId);
      return s.ids.secondId;
    });
    await expect(
      s.mod.mutation(api.fundraiserReports.dismissReports, {
        fundraiserId: gone,
      }),
    ).rejects.toThrow("Fundraiser not found.");
  });
});

// ---- The overview count -----------------------------------------------

/** Gives each of `count` new fundraisers one open report. */
async function insertReported(s: S, count: number) {
  await s.t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert("fundraisers", {
        creatorId: s.ids.owner,
        beneficiaryType: "SELF",
        title: `Reported ${i}`,
        story: "A story that is long enough to be a story.",
        type: "OTHER",
        goalAmount: 1000,
        currency: "KES",
        amountRaised: 0,
        donorCount: 0,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("fundraiserReports", {
        fundraiserId: id,
        reporterUserId: s.ids.alice,
        reason: "SCAM",
        status: "OPEN",
        createdAt: NOW + i,
      });
    }
  });
}

describe("the count on the admin overview", () => {
  it("counts the fundraisers with reports waiting, not the reports", async () => {
    const s = await setup();
    const attention = () => s.mod.query(api.admin.getAttentionCounts, {});
    expect((await attention()).fundraisersReported).toEqual({
      count: 0,
      capped: false,
    });

    await reportedBy(s, [s.alice, s.bob, s.carol], s.ids.fundraiserId);
    await reportOf(s.alice, s.ids.secondId);
    expect((await attention()).fundraisersReported).toEqual({
      count: 2,
      capped: false,
    });

    await s.mod.mutation(api.fundraiserReports.dismissReports, {
      fundraiserId: s.ids.fundraiserId,
    });
    expect((await attention()).fundraisersReported.count).toBe(1);
  });

  it("counts up to a hundred, then says there are more", async () => {
    const s = await setup();
    const attention = () => s.mod.query(api.admin.getAttentionCounts, {});

    await insertReported(s, 100);
    expect((await attention()).fundraisersReported).toEqual({
      count: 100,
      capped: false,
    });

    await insertReported(s, 1);
    expect((await attention()).fundraisersReported).toEqual({
      count: 100,
      capped: true,
    });
  });

  it("is for staff only", async () => {
    const s = await setup();
    await expect(
      s.alice.query(api.admin.getAttentionCounts, {}),
    ).rejects.toThrow("You don't have permission to do that.");
  });
});

// ---- Opening a fundraiser from the admin page -------------------------

describe("fundraiserIdFromInput", () => {
  const id = "k17abc123def456ghi789jkl012mno345";

  it("takes the id from an address on the site", () => {
    expect(
      fundraiserIdFromInput(`https://gouplift.example/fundraiser/${id}`),
    ).toBe(id);
    expect(fundraiserIdFromInput(`/fundraiser/${id}`)).toBe(id);
  });

  it("drops what follows the id", () => {
    for (const tail of [
      "?donation=abc",
      "#comments",
      "/edit",
      "?source=embed#x",
    ]) {
      expect(
        fundraiserIdFromInput(
          `https://gouplift.example/fundraiser/${id}${tail}`,
        ),
      ).toBe(id);
    }
  });

  it("takes a bare id, tidied", () => {
    expect(fundraiserIdFromInput(id)).toBe(id);
    expect(fundraiserIdFromInput(`  ${id}  `)).toBe(id);
    expect(fundraiserIdFromInput(`${id}?x=1`)).toBe(id);
  });

  it("gives nothing for a blank box", () => {
    expect(fundraiserIdFromInput("")).toBeNull();
    expect(fundraiserIdFromInput("   ")).toBeNull();
    expect(fundraiserIdFromInput("?x=1")).toBeNull();
  });
});

// ---- The suspended list -----------------------------------------------

describe("the suspended fundraisers", () => {
  it("is for staff only", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await s.t.query(api.fundraiserReports.listSuspended, {})).toEqual(
      [],
    );
    expect(
      await s.owner.query(api.fundraiserReports.listSuspended, {}),
    ).toEqual([]);
    expect(
      await s.mod.query(api.fundraiserReports.listSuspended, {}),
    ).toHaveLength(1);
  });

  it("lists the ones suspended now, the longest first, with why", async () => {
    const s = await setup();
    await suspend(
      s.mod,
      s.ids.fundraiserId,
      "First reason, for the first time.",
    );
    vi.setSystemTime(NOW + HOUR);
    await suspend(
      s.admin,
      s.ids.secondId,
      "Second reason, a second time.",
      false,
    );
    vi.setSystemTime(NOW + 2 * HOUR);
    await suspend(s.mod, s.ids.pausedId, "Third reason, a third time.");
    await reinstate(s.mod, s.ids.pausedId);

    const rows = await s.mod.query(api.fundraiserReports.listSuspended, {});
    expect(rows.map((row) => row.fundraiserId)).toEqual([
      s.ids.fundraiserId,
      s.ids.secondId,
    ]);
    expect(rows[0]).toMatchObject({
      title: "Water for Kajiado",
      status: "ACTIVE",
      ownerName: "Fund Raiser",
      amountRaised: 25000,
      currency: "KES",
      reason: "First reason, for the first time.",
      placedAt: NOW,
      placedByName: "Mo Derator",
      payoutsOnHold: true,
    });
    expect(rows[1]).toMatchObject({
      placedByName: "Ad Min",
      payoutsOnHold: false,
    });
  });
});

// ---- What the page asks -----------------------------------------------

describe("saying a fundraiser is under review", () => {
  it("is true for a suspended fundraiser the public could otherwise see", async () => {
    const s = await setup();
    const ask = (id: Id<"fundraisers">) =>
      s.t.query(api.fundraiserReports.isUnderReview, { fundraiserId: id });
    expect(await ask(s.ids.fundraiserId)).toBe(false);
    await suspend(s.mod, s.ids.fundraiserId);
    expect(await ask(s.ids.fundraiserId)).toBe(true);
    expect(await ask(s.ids.flaggedId)).toBe(true);
    await reinstate(s.mod, s.ids.fundraiserId);
    expect(await ask(s.ids.fundraiserId)).toBe(false);
  });

  it("says nothing about one that was never public, or doesn't exist", async () => {
    const s = await setup();
    for (const id of [
      s.ids.privateId,
      s.ids.draftId,
      s.ids.pendingId,
      s.ids.rejectedId,
    ]) {
      await s.t.run((ctx) => ctx.db.patch(id, { isFlagged: true }));
      expect(
        await s.t.query(api.fundraiserReports.isUnderReview, {
          fundraiserId: id,
        }),
        id,
      ).toBe(false);
    }
    const gone = await s.t.run(async (ctx) => {
      await ctx.db.delete(s.ids.secondId);
      return s.ids.secondId;
    });
    expect(
      await s.t.query(api.fundraiserReports.isUnderReview, {
        fundraiserId: gone,
      }),
    ).toBe(false);
  });
});

describe("telling the organizer why", () => {
  const ask = (who: Client | S["t"], id: Id<"fundraisers">) =>
    who.query(api.fundraiserReports.mySuspension, { fundraiserId: id });

  it("shows the organizer and staff the reason, and nobody else", async () => {
    const s = await setup();
    await suspend(s.mod, s.ids.fundraiserId);
    for (const who of [s.owner, s.mod, s.admin]) {
      expect(await ask(who, s.ids.fundraiserId)).toEqual({
        reason: REASON,
        placedAt: NOW,
      });
    }
    for (const who of [s.t, s.alice, s.stranger]) {
      expect(await ask(who, s.ids.fundraiserId)).toBeNull();
    }
  });

  it("says nothing when it isn't suspended, or once it is back", async () => {
    const s = await setup();
    expect(await ask(s.owner, s.ids.fundraiserId)).toBeNull();
    await suspend(s.mod, s.ids.fundraiserId);
    await reinstate(s.mod, s.ids.fundraiserId);
    expect(await ask(s.owner, s.ids.fundraiserId)).toBeNull();
  });

  it("shows the latest reason after a second suspension", async () => {
    const s = await setup();
    await suspend(
      s.mod,
      s.ids.fundraiserId,
      "First reason, for the first time.",
    );
    await reinstate(s.mod, s.ids.fundraiserId);
    vi.setSystemTime(NOW + HOUR);
    await suspend(s.mod, s.ids.fundraiserId, "Second reason, a second time.");
    expect(await ask(s.owner, s.ids.fundraiserId)).toEqual({
      reason: "Second reason, a second time.",
      placedAt: NOW + HOUR,
    });
  });

  it("has no reason to give for one that was flagged by hand", async () => {
    const s = await setup();
    expect(await ask(s.owner, s.ids.flaggedId)).toMatchObject({ reason: null });
  });
});
