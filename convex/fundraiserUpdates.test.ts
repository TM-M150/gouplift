/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  checkUpdateBody,
  MAX_UPDATE_LENGTH,
  MAX_UPDATES_PER_DAY,
  MIN_UPDATE_LENGTH,
  normalizeUpdateBody,
} from "../lib/updates";

// The real auth component needs a running Better Auth deployment. These tests
// only need `safeGetAuthUser`, so it reads the identity convex-test attaches.
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity ? { _id: identity.subject } : null;
    },
  },
}));

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const GOOD = "We have reached the first borehole and the pump is installed.";
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T09:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const user = (
      authUserId: string,
      displayName: string,
      role: Doc<"users">["role"] = "USER",
    ) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
      });

    const owner = await user("auth_owner", "Fund Raiser");
    const other = await user("auth_other", "Someone Else");
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
        amountRaised: 0,
        donorCount: 0,
        status: "ACTIVE",
        isPrivate: false,
        isVerified: false,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    return {
      owner,
      other,
      mod,
      admin,
      fundraiserId: await fundraiser(),
      privateId: await fundraiser({ isPrivate: true }),
      draftId: await fundraiser({ status: "DRAFT" }),
      pendingId: await fundraiser({ status: "PENDING_REVIEW" }),
      rejectedId: await fundraiser({ status: "REJECTED" }),
      pausedId: await fundraiser({ status: "PAUSED" }),
      completedId: await fundraiser({ status: "COMPLETED" }),
      expiredId: await fundraiser({ status: "EXPIRED" }),
    };
  });

  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "auth_owner" }),
    other: t.withIdentity({ subject: "auth_other" }),
    mod: t.withIdentity({ subject: "auth_mod" }),
    admin: t.withIdentity({ subject: "auth_admin" }),
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const page = (numItems = 20, cursor: string | null = null) => ({
  numItems,
  cursor,
});

async function listBodies(
  client: T | ReturnType<T["withIdentity"]>,
  fundraiserId: Id<"fundraisers">,
) {
  const result = await client.query(api.fundraiserUpdates.list, {
    fundraiserId,
    paginationOpts: page(),
  });
  return result.page.map((row) => row.body);
}

async function count(s: S, fundraiserId = s.ids.fundraiserId) {
  return s.t.run(
    async (ctx) => (await ctx.db.get(fundraiserId))?.updatesCount ?? 0,
  );
}

function post(s: S, body = GOOD, fundraiserId = s.ids.fundraiserId) {
  return s.owner.mutation(api.fundraiserUpdates.postUpdate, {
    fundraiserId,
    body,
  });
}

describe("the rules for what an update says", () => {
  it("tidies line endings, control characters and blank lines", () => {
    expect(
      normalizeUpdateBody("  Hello\r\nthere\u0000   \n\n\n\nbye \u2028 "),
    ).toBe("Hello\nthere\n\nbye");
  });

  it("accepts the shortest and the longest allowed", () => {
    expect(checkUpdateBody("x".repeat(MIN_UPDATE_LENGTH)).ok).toBe(true);
    expect(checkUpdateBody("x".repeat(MAX_UPDATE_LENGTH)).ok).toBe(true);
  });

  it("explains what is wrong with one that is too short, empty or too long", () => {
    for (const raw of ["", "   \n  ", "x".repeat(MIN_UPDATE_LENGTH - 1)]) {
      const result = checkUpdateBody(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toMatch(/at least 10/);
    }
    const long = checkUpdateBody("x".repeat(MAX_UPDATE_LENGTH + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.problem).toMatch(/under 2,000/);
  });

  it("counts the length after tidying, so padding doesn't help", () => {
    expect(
      checkUpdateBody(`${"x".repeat(MIN_UPDATE_LENGTH - 1)}\n\n\n\n   `).ok,
    ).toBe(false);
  });
});

describe("posting an update", () => {
  it("lets the creator post, and the update shows up and is counted", async () => {
    const s = await setup();
    const { updateId } = await post(s, `  ${GOOD}\r\n\r\n\r\n\r\nThank you!  `);

    const row = await s.t.run((ctx) => ctx.db.get(updateId));
    expect(row).toMatchObject({
      fundraiserId: s.ids.fundraiserId,
      authorUserId: s.ids.owner,
      body: `${GOOD}\n\nThank you!`,
      status: "PUBLISHED",
      createdAt: Date.now(),
    });
    expect(row?.editedAt).toBeUndefined();
    expect(await count(s)).toBe(1);
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([
      `${GOOD}\n\nThank you!`,
    ]);
  });

  it("refuses everyone who is not the creator", async () => {
    const s = await setup();
    await expect(
      s.other.mutation(api.fundraiserUpdates.postUpdate, {
        fundraiserId: s.ids.fundraiserId,
        body: GOOD,
      }),
    ).rejects.toThrow("Fundraiser not found.");
    // Staff can hide updates but don't post them in the creator's name.
    await expect(
      s.admin.mutation(api.fundraiserUpdates.postUpdate, {
        fundraiserId: s.ids.fundraiserId,
        body: GOOD,
      }),
    ).rejects.toThrow("Fundraiser not found.");
    await expect(
      s.t.mutation(api.fundraiserUpdates.postUpdate, {
        fundraiserId: s.ids.fundraiserId,
        body: GOOD,
      }),
    ).rejects.toThrow("You must be signed in.");
    expect(await count(s)).toBe(0);
  });

  it("only allows posting once the fundraiser has been approved", async () => {
    const s = await setup();
    for (const id of [s.ids.draftId, s.ids.pendingId, s.ids.rejectedId]) {
      await expect(post(s, GOOD, id)).rejects.toThrow(
        "once your fundraiser has been approved",
      );
    }
    // After it closes too: the thank-you at the end matters.
    for (const id of [
      s.ids.fundraiserId,
      s.ids.pausedId,
      s.ids.completedId,
      s.ids.expiredId,
    ]) {
      await post(s, GOOD, id);
      expect(await count(s, id)).toBe(1);
    }
  });

  it("rejects text that is too short or too long, with the reason", async () => {
    const s = await setup();
    await expect(post(s, "Thanks")).rejects.toThrow("at least 10");
    await expect(post(s, "x".repeat(MAX_UPDATE_LENGTH + 1))).rejects.toThrow(
      "under 2,000",
    );
    expect(await count(s)).toBe(0);
  });

  it("stops at a daily limit, and a new day starts fresh", async () => {
    const s = await setup();
    for (let i = 0; i < MAX_UPDATES_PER_DAY; i++) await post(s);
    await expect(post(s)).rejects.toThrow("a lot of updates today");
    expect(await count(s)).toBe(MAX_UPDATES_PER_DAY);

    // Another fundraiser has its own allowance.
    await post(s, GOOD, s.ids.pausedId);

    vi.setSystemTime(Date.now() + DAY_MS + 1000);
    await post(s);
    expect(await count(s)).toBe(MAX_UPDATES_PER_DAY + 1);
  });
});

describe("editing and removing", () => {
  it("lets the author edit, and marks it as edited", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    vi.advanceTimersByTime(60_000);

    await s.owner.mutation(api.fundraiserUpdates.editUpdate, {
      updateId,
      body: "  The pump is working and families are collecting water today.  ",
    });
    const row = await s.t.run((ctx) => ctx.db.get(updateId));
    expect(row?.body).toBe(
      "The pump is working and families are collecting water today.",
    );
    expect(row?.editedAt).toBe(Date.now());
    expect(row?.createdAt).toBeLessThan(Date.now());
  });

  it("leaves it unmarked when the text did not change", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await s.owner.mutation(api.fundraiserUpdates.editUpdate, {
      updateId,
      body: `${GOOD}  `,
    });
    expect(
      (await s.t.run((ctx) => ctx.db.get(updateId)))?.editedAt,
    ).toBeUndefined();
  });

  it("checks an edit like a new update", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await expect(
      s.owner.mutation(api.fundraiserUpdates.editUpdate, {
        updateId,
        body: "short",
      }),
    ).rejects.toThrow("at least 10");
    expect((await s.t.run((ctx) => ctx.db.get(updateId)))?.body).toBe(GOOD);
  });

  it("keeps edit and remove to the author", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    for (const client of [s.other, s.admin, s.mod]) {
      await expect(
        client.mutation(api.fundraiserUpdates.editUpdate, {
          updateId,
          body: "Changed by somebody else entirely.",
        }),
      ).rejects.toThrow("Update not found.");
      await expect(
        client.mutation(api.fundraiserUpdates.removeUpdate, { updateId }),
      ).rejects.toThrow("Update not found.");
    }
    await expect(
      s.t.mutation(api.fundraiserUpdates.removeUpdate, { updateId }),
    ).rejects.toThrow("You must be signed in.");
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([GOOD]);
  });

  it("removes an update: gone from the list, and the count goes down", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await post(s, "A second update that is also long enough.");
    expect(await count(s)).toBe(2);

    await s.owner.mutation(api.fundraiserUpdates.removeUpdate, { updateId });
    expect(await count(s)).toBe(1);
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([
      "A second update that is also long enough.",
    ]);
    expect((await s.t.run((ctx) => ctx.db.get(updateId)))?.status).toBe(
      "REMOVED",
    );

    // Once removed it can be neither removed again nor edited.
    await expect(
      s.owner.mutation(api.fundraiserUpdates.removeUpdate, { updateId }),
    ).rejects.toThrow("can't be removed");
    await expect(
      s.owner.mutation(api.fundraiserUpdates.editUpdate, {
        updateId,
        body: "Trying to bring it back with an edit.",
      }),
    ).rejects.toThrow("can't be edited");
    expect(await count(s)).toBe(1);
  });
});

describe("staff hiding and restoring", () => {
  it("hides an update with a reason, which is audited and uncounted", async () => {
    const s = await setup();
    const { updateId } = await post(s);

    await s.mod.mutation(api.fundraiserUpdates.hideUpdate, {
      updateId,
      reason: "  Asks donors to send money to a phone number  ",
    });

    const row = await s.t.run((ctx) => ctx.db.get(updateId));
    expect(row).toMatchObject({
      status: "HIDDEN",
      hiddenBy: s.ids.mod,
      hiddenAt: expect.any(Number),
      hiddenReason: "Asks donors to send money to a phone number",
    });
    expect(await count(s)).toBe(0);
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([]);

    const audit = await s.t.run((ctx) =>
      ctx.db.query("adminAuditLog").collect(),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: s.ids.mod,
      action: "FUNDRAISER_UPDATE_HIDDEN",
      fundraiserId: s.ids.fundraiserId,
      fundraiserUpdateId: updateId,
      statusBefore: "PUBLISHED",
      statusAfter: "HIDDEN",
      note: "Asks donors to send money to a phone number",
    });
  });

  it("needs staff, a real reason, and a published update", async () => {
    const s = await setup();
    const { updateId } = await post(s);

    for (const client of [s.owner, s.other, s.t]) {
      await expect(
        client.mutation(api.fundraiserUpdates.hideUpdate, {
          updateId,
          reason: "A perfectly good reason here",
        }),
      ).rejects.toThrow(/permission|signed in/);
    }
    await expect(
      s.admin.mutation(api.fundraiserUpdates.hideUpdate, {
        updateId,
        reason: "too short",
      }),
    ).rejects.toThrow("at least 10 characters");
    expect(await count(s)).toBe(1);

    await s.admin.mutation(api.fundraiserUpdates.hideUpdate, {
      updateId,
      reason: "A perfectly good reason here",
    });
    // Hiding twice must not take the count below what is really published.
    await expect(
      s.admin.mutation(api.fundraiserUpdates.hideUpdate, {
        updateId,
        reason: "A perfectly good reason here",
      }),
    ).rejects.toThrow("Only a published update");
    expect(await count(s)).toBe(0);
  });

  it("restores a hidden update and records it", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await s.mod.mutation(api.fundraiserUpdates.hideUpdate, {
      updateId,
      reason: "Hidden by mistake, to be checked",
    });

    await expect(
      s.owner.mutation(api.fundraiserUpdates.restoreUpdate, { updateId }),
    ).rejects.toThrow("permission");
    await s.admin.mutation(api.fundraiserUpdates.restoreUpdate, { updateId });

    const row = await s.t.run((ctx) => ctx.db.get(updateId));
    expect(row?.status).toBe("PUBLISHED");
    expect(row?.hiddenBy).toBeUndefined();
    expect(row?.hiddenAt).toBeUndefined();
    expect(row?.hiddenReason).toBeUndefined();
    expect(await count(s)).toBe(1);
    expect(await listBodies(s.t, s.ids.fundraiserId)).toEqual([GOOD]);

    const audit = await s.t.run((ctx) =>
      ctx.db.query("adminAuditLog").collect(),
    );
    expect(audit.map((row) => row.action)).toEqual([
      "FUNDRAISER_UPDATE_HIDDEN",
      "FUNDRAISER_UPDATE_RESTORED",
    ]);
    await expect(
      s.admin.mutation(api.fundraiserUpdates.restoreUpdate, { updateId }),
    ).rejects.toThrow("Only a hidden update");
  });

  it("does not let the author edit or remove a hidden update", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await s.mod.mutation(api.fundraiserUpdates.hideUpdate, {
      updateId,
      reason: "Hidden while we look into it",
    });
    await expect(
      s.owner.mutation(api.fundraiserUpdates.editUpdate, {
        updateId,
        body: "An edit made to get around the hiding.",
      }),
    ).rejects.toThrow("can't be edited");
    await expect(
      s.owner.mutation(api.fundraiserUpdates.removeUpdate, { updateId }),
    ).rejects.toThrow("can't be removed");
  });

  it("keeps the count right through posts, hides, restores and removals", async () => {
    const s = await setup();
    const a = (await post(s, "First update, long enough to post.")).updateId;
    const b = (await post(s, "Second update, long enough to post.")).updateId;
    const c = (await post(s, "Third update, long enough to post.")).updateId;
    await s.mod.mutation(api.fundraiserUpdates.hideUpdate, {
      updateId: a,
      reason: "Hidden for a test of the count",
    });
    await s.owner.mutation(api.fundraiserUpdates.removeUpdate, { updateId: b });
    expect(await count(s)).toBe(1);
    await s.mod.mutation(api.fundraiserUpdates.restoreUpdate, { updateId: a });
    expect(await count(s)).toBe(2);

    const published = await s.t.run(async (ctx) =>
      (
        await ctx.db
          .query("fundraiserUpdates")
          .withIndex("by_fundraiserId_and_status_and_createdAt", (q) =>
            q.eq("fundraiserId", s.ids.fundraiserId).eq("status", "PUBLISHED"),
          )
          .collect()
      ).map((row) => row._id),
    );
    expect(new Set(published)).toEqual(new Set([a, c]));
  });
});

describe("reading updates", () => {
  it("lists newest first, and pages through them", async () => {
    const s = await setup();
    for (const n of [1, 2, 3, 4, 5]) {
      await post(s, `Update number ${n} for the donors.`);
      vi.advanceTimersByTime(1000);
    }

    const first = await s.t.query(api.fundraiserUpdates.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(2),
    });
    expect(first.page.map((row) => row.body)).toEqual([
      "Update number 5 for the donors.",
      "Update number 4 for the donors.",
    ]);
    expect(first.isDone).toBe(false);

    const second = await s.t.query(api.fundraiserUpdates.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(2, first.continueCursor),
    });
    expect(second.page.map((row) => row.body)).toEqual([
      "Update number 3 for the donors.",
      "Update number 2 for the donors.",
    ]);

    const last = await s.t.query(api.fundraiserUpdates.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(2, second.continueCursor),
    });
    expect(last.page.map((row) => row.body)).toEqual([
      "Update number 1 for the donors.",
    ]);
    expect(last.isDone).toBe(true);
  });

  it("gives the fields the page needs and nothing about who hid it", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    const [row] = (
      await s.t.query(api.fundraiserUpdates.list, {
        fundraiserId: s.ids.fundraiserId,
        paginationOpts: page(),
      })
    ).page;
    expect(row).toEqual({
      _id: updateId,
      body: GOOD,
      createdAt: Date.now(),
      editedAt: null,
    });
  });

  it("caps how many come back in one page", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("fundraiserUpdates", {
          fundraiserId: s.ids.fundraiserId,
          authorUserId: s.ids.owner,
          body: `Update number ${i} for the donors.`,
          status: "PUBLISHED",
          createdAt: Date.now() + i,
        });
      }
    });
    const result = await s.t.query(api.fundraiserUpdates.list, {
      fundraiserId: s.ids.fundraiserId,
      paginationOpts: page(1000),
    });
    expect(result.page).toHaveLength(50);
    expect(result.isDone).toBe(false);
  });

  it("shows a private or unapproved fundraiser's updates only to its creator and staff", async () => {
    const s = await setup();
    const hidden = [
      s.ids.privateId,
      s.ids.pendingId,
      s.ids.draftId,
      s.ids.rejectedId,
    ];
    await s.t.run(async (ctx) => {
      for (const fundraiserId of hidden) {
        await ctx.db.insert("fundraiserUpdates", {
          fundraiserId,
          authorUserId: s.ids.owner,
          body: GOOD,
          status: "PUBLISHED",
          createdAt: Date.now(),
        });
      }
    });

    for (const fundraiserId of hidden) {
      expect(await listBodies(s.t, fundraiserId)).toEqual([]);
      expect(await listBodies(s.other, fundraiserId)).toEqual([]);
      expect(await listBodies(s.owner, fundraiserId)).toEqual([GOOD]);
      expect(await listBodies(s.mod, fundraiserId)).toEqual([GOOD]);
      expect(await listBodies(s.admin, fundraiserId)).toEqual([GOOD]);
    }
  });

  it("gives an empty answer for a fundraiser that does not exist", async () => {
    const s = await setup();
    const gone = s.ids.pausedId;
    await s.t.run((ctx) => ctx.db.delete(gone));
    expect(await listBodies(s.t, gone)).toEqual([]);
  });

  it("shows the hidden ones to staff with the reason, to the author without it, and to nobody else", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await s.mod.mutation(api.fundraiserUpdates.hideUpdate, {
      updateId,
      reason: "Asks donors to pay a phone number",
    });
    const args = { fundraiserId: s.ids.fundraiserId };

    expect(await s.mod.query(api.fundraiserUpdates.listHidden, args)).toEqual([
      {
        _id: updateId,
        body: GOOD,
        createdAt: Date.now(),
        hiddenAt: expect.any(Number),
        reason: "Asks donors to pay a phone number",
      },
    ]);
    expect(await s.owner.query(api.fundraiserUpdates.listHidden, args)).toEqual(
      [
        {
          _id: updateId,
          body: GOOD,
          createdAt: Date.now(),
          hiddenAt: expect.any(Number),
          reason: null,
        },
      ],
    );
    expect(await s.other.query(api.fundraiserUpdates.listHidden, args)).toEqual(
      [],
    );
    expect(await s.t.query(api.fundraiserUpdates.listHidden, args)).toEqual([]);
  });

  it("does not list removed updates as hidden", async () => {
    const s = await setup();
    const { updateId } = await post(s);
    await s.owner.mutation(api.fundraiserUpdates.removeUpdate, { updateId });
    expect(
      await s.mod.query(api.fundraiserUpdates.listHidden, {
        fundraiserId: s.ids.fundraiserId,
      }),
    ).toEqual([]);
  });
});

describe("asking for donors to be emailed", () => {
  const setDonors = (
    s: S,
    fundraiserId: Id<"fundraisers">,
    donorCount: number,
  ) => s.t.run((ctx) => ctx.db.patch(fundraiserId, { donorCount }));

  const postWithEmail = (
    s: S,
    emailDonors: boolean | undefined,
    fundraiserId = s.ids.fundraiserId,
  ) =>
    s.owner.mutation(api.fundraiserUpdates.postUpdate, {
      fundraiserId,
      body: GOOD,
      emailDonors,
    });

  const emailJobs = async (s: S) =>
    (
      await s.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter((job) => job.name.includes("fanOut"));

  it("does not email anyone unless the creator asks", async () => {
    const s = await setup();
    await setDonors(s, s.ids.fundraiserId, 5);

    for (const asked of [undefined, false]) {
      const { updateId, email } = await postWithEmail(s, asked);
      expect(email).toBe("not_requested");
      const row = await s.t.run((ctx) => ctx.db.get(updateId));
      expect(row?.notifiedAt).toBeUndefined();
    }
    expect(await emailJobs(s)).toHaveLength(0);
  });

  it("starts emailing the donors when asked", async () => {
    const s = await setup();
    await setDonors(s, s.ids.fundraiserId, 5);

    const before = Date.now();
    const { updateId, email } = await postWithEmail(s, true);

    expect(email).toBe("queued");
    const row = await s.t.run((ctx) => ctx.db.get(updateId));
    expect(Math.abs((row?.notifiedAt ?? 0) - before)).toBeLessThan(1000);
    const jobs = await emailJobs(s);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args).toEqual([{ updateId, cursor: null }]);
  });

  it("emails donors about one update a day: the next is posted, not emailed", async () => {
    const s = await setup();
    await setDonors(s, s.ids.fundraiserId, 5);

    expect((await postWithEmail(s, true)).email).toBe("queued");
    const second = await postWithEmail(s, true);

    expect(second.email).toBe("throttled");
    expect(await listBodies(s.owner, s.ids.fundraiserId)).toHaveLength(2);
    expect(await count(s)).toBe(2);
    expect(await emailJobs(s)).toHaveLength(1);

    // Tomorrow it is allowed again.
    vi.setSystemTime(Date.now() + DAY_MS + 1000);
    expect((await postWithEmail(s, true)).email).toBe("queued");
    expect(await emailJobs(s)).toHaveLength(2);
  });

  it("does not use up the day's email on a post that wasn't emailed", async () => {
    const s = await setup();
    await setDonors(s, s.ids.fundraiserId, 5);

    await postWithEmail(s, false);

    expect((await postWithEmail(s, true)).email).toBe("queued");
  });

  it("says there is nobody to email yet, and saves the day's email for later", async () => {
    const s = await setup();

    const first = await postWithEmail(s, true);
    expect(first.email).toBe("no_donors");
    expect(await listBodies(s.owner, s.ids.fundraiserId)).toHaveLength(1);
    expect(await emailJobs(s)).toHaveLength(0);

    await setDonors(s, s.ids.fundraiserId, 1);
    expect((await postWithEmail(s, true)).email).toBe("queued");
  });

  it("posts the update but doesn't email for a private or flagged fundraiser", async () => {
    const s = await setup();
    await setDonors(s, s.ids.privateId, 5);
    await setDonors(s, s.ids.fundraiserId, 5);
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { isFlagged: true }),
    );

    for (const fundraiserId of [s.ids.privateId, s.ids.fundraiserId]) {
      const { email } = await postWithEmail(s, true, fundraiserId);
      expect(email).toBe("unavailable");
      expect(await count(s, fundraiserId)).toBe(1);
    }
    expect(await emailJobs(s)).toHaveLength(0);

    // Once the flag is lifted the allowance is still there.
    await s.t.run((ctx) =>
      ctx.db.patch(s.ids.fundraiserId, { isFlagged: false }),
    );
    expect((await postWithEmail(s, true)).email).toBe("queued");
  });

  it("keeps the email allowance per fundraiser", async () => {
    const s = await setup();
    await setDonors(s, s.ids.fundraiserId, 5);
    await setDonors(s, s.ids.pausedId, 5);

    expect((await postWithEmail(s, true)).email).toBe("queued");
    expect((await postWithEmail(s, true, s.ids.pausedId)).email).toBe("queued");
  });
});
