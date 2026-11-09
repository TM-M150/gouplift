/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { fundraiserFrontend } from "../lib/validations/fundraiser";
import {
  addDays,
  DEFAULT_CAMPAIGN_DAYS,
  defaultEndDateString,
  describeTimeLeft,
  endDateProblem,
  endDateStringProblem,
  endOfNairobiDay,
  formatDateLabel,
  formatEndDate,
  hasEnded,
  MAX_CAMPAIGN_DAYS,
  maxEndDateString,
  minEndDateString,
  nairobiDateString,
} from "../lib/fundraiser-dates";

// The real auth component needs a running Better Auth deployment, so the
// mutations here read the identity convex-test attaches instead.
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
type Status = Doc<"fundraisers">["status"];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// 2026-11-09 10:00 in Nairobi (07:00 UTC).
const NOW = Date.UTC(2026, 10, 9, 7, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// ---- The date rules ---------------------------------------------------

describe("Nairobi dates", () => {
  it("names the calendar day in Nairobi, not in UTC", () => {
    // 22:30 UTC on the 9th is already 01:30 on the 10th in Nairobi.
    expect(nairobiDateString(Date.UTC(2026, 10, 9, 22, 30))).toBe("2026-11-10");
    expect(nairobiDateString(Date.UTC(2026, 10, 9, 20, 59, 59))).toBe("2026-11-09");
    expect(nairobiDateString(Date.UTC(2026, 10, 9, 21, 0, 0))).toBe("2026-11-10");
  });

  it("an end date is the last millisecond of that day in Nairobi", () => {
    const end = endOfNairobiDay("2026-11-09");
    expect(end).toBe(Date.UTC(2026, 10, 9, 20, 59, 59, 999));
    expect(nairobiDateString(end!)).toBe("2026-11-09");
    expect(nairobiDateString(end! + 1)).toBe("2026-11-10");
  });

  it("rejects text that isn't a real date", () => {
    for (const bad of ["", "tomorrow", "2026-13-01", "2026-02-31", "2026-1-5", "26-11-09"]) {
      expect(endOfNairobiDay(bad)).toBeNull();
    }
  });

  it("adds days across month and year ends, and leap days", () => {
    expect(addDays("2026-11-09", 1)).toBe("2026-11-10");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-11-09", 90)).toBe("2027-02-07");
  });

  it("throws for a date it can't read", () => {
    expect(() => addDays("nope", 1)).toThrow();
  });
});

describe("the allowed range", () => {
  it("starts today, defaults to 90 days out and stops at 365", () => {
    expect(DEFAULT_CAMPAIGN_DAYS).toBe(90);
    expect(MAX_CAMPAIGN_DAYS).toBe(365);
    expect(minEndDateString(NOW)).toBe("2026-11-09");
    expect(defaultEndDateString(NOW)).toBe("2027-02-07");
    expect(maxEndDateString(NOW)).toBe("2027-11-09");
  });

  it("counts today in Nairobi, so a late-evening UTC clock is already tomorrow", () => {
    const lateUtc = Date.UTC(2026, 10, 9, 22, 0);
    expect(minEndDateString(lateUtc)).toBe("2026-11-10");
  });

  it("accepts today's date: the fundraiser runs until midnight", () => {
    expect(endDateStringProblem("2026-11-09", NOW)).toBeNull();
  });

  it("rejects yesterday", () => {
    expect(endDateStringProblem("2026-11-08", NOW)).toBe(
      "The end date must be in the future.",
    );
  });

  it("accepts the last allowed day and rejects the one after", () => {
    expect(endDateStringProblem("2027-11-09", NOW)).toBeNull();
    expect(endDateStringProblem("2027-11-10", NOW)).toMatch(/up to 365 days/);
  });

  it("asks for a date when the text isn't one", () => {
    expect(endDateStringProblem("", NOW)).toBe("Choose an end date.");
  });

  it("checks a stored timestamp the same way", () => {
    expect(endDateProblem(NOW, NOW)).toBe("The end date must be in the future.");
    expect(endDateProblem(NOW + 1, NOW)).toBeNull();
    expect(endDateProblem(NOW + 400 * DAY, NOW)).toMatch(/up to 365 days/);
    expect(endDateProblem(Number.NaN, NOW)).toBe("Choose a valid end date.");
    expect(endDateProblem(Number.POSITIVE_INFINITY, NOW)).toBe(
      "Choose a valid end date.",
    );
  });
});

describe("hasEnded and describeTimeLeft", () => {
  it("no end date never ends; the end date itself counts as ended", () => {
    expect(hasEnded(undefined, NOW)).toBe(false);
    expect(hasEnded(NOW + 1, NOW)).toBe(false);
    expect(hasEnded(NOW, NOW)).toBe(true);
    expect(hasEnded(NOW - 1, NOW)).toBe(true);
  });

  it("counts calendar days in Nairobi", () => {
    const at = (date: string) => endOfNairobiDay(date)!;
    expect(describeTimeLeft(at("2026-11-09"), NOW)).toBe("Ends today");
    expect(describeTimeLeft(at("2026-11-10"), NOW)).toBe("1 day left");
    expect(describeTimeLeft(at("2026-11-19"), NOW)).toBe("10 days left");
    expect(describeTimeLeft(NOW - 1, NOW)).toBe("Ended");
    expect(describeTimeLeft(NOW, NOW)).toBe("Ended");
  });

  it("an hour before midnight still says it ends today", () => {
    const evening = Date.UTC(2026, 10, 9, 19, 0); // 22:00 Nairobi
    expect(describeTimeLeft(endOfNairobiDay("2026-11-09")!, evening)).toBe(
      "Ends today",
    );
    expect(describeTimeLeft(endOfNairobiDay("2026-11-10")!, evening)).toBe(
      "1 day left",
    );
  });
});

describe("date labels", () => {
  it("writes a date the way the page shows it", () => {
    expect(formatDateLabel("2026-11-09")).toBe("9 Nov 2026");
    expect(formatDateLabel("2027-02-07")).toBe("7 Feb 2027");
    expect(formatDateLabel("2026-12-31")).toBe("31 Dec 2026");
  });

  it("leaves text that isn't a date as it was", () => {
    expect(formatDateLabel("soon")).toBe("soon");
  });

  it("an end date is labelled by its Nairobi day, not the UTC one", () => {
    // The stored value is 23:59:59.999 in Nairobi, which is 20:59 UTC.
    expect(formatEndDate(endOfNairobiDay("2026-11-09")!)).toBe("9 Nov 2026");
    expect(formatEndDate(endOfNairobiDay("2027-01-01")!)).toBe("1 Jan 2027");
  });
});

// The create form checks the date with this schema before it sends anything.
describe("the create form's end date", () => {
  const answers = (endDate: string) => ({
    title: "Water for Kajiado",
    story: "A story that is long enough to be a story, with plenty of detail.",
    type: "COMMUNITY_HARAMBEE",
    beneficiaryType: "SELF",
    goalAmount: 100000,
    currency: "KES" as const,
    country: "Kenya",
    endDate,
  });
  const messageFor = (endDate: string) => {
    const result = fundraiserFrontend.safeParse(answers(endDate));
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("accepts a day inside the range", () => {
    expect(messageFor(defaultEndDateString(Date.now()))).toBeNull();
    expect(messageFor(minEndDateString(Date.now()))).toBeNull();
    expect(messageFor(maxEndDateString(Date.now()))).toBeNull();
  });

  it("turns away a missing, past or too-distant date with a plain message", () => {
    expect(messageFor("")).toBe("Choose an end date.");
    expect(messageFor("2026-11-08")).toBe("The end date must be in the future.");
    expect(messageFor("2028-01-01")).toMatch(/up to 365 days/);
  });
});

// ---- The sweep --------------------------------------------------------

async function setup() {
  const t = convexTest(schema, modules);
  const make = (authUserId: string, role: "USER" | "ADMIN" = "USER") =>
    t.run((ctx) =>
      ctx.db.insert("users", {
        authUserId,
        email: `${authUserId}@example.test`,
        displayName: authUserId,
        role,
        isPrivate: false,
        isVerified: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  const creator = await make("auth_creator");
  const other = await make("auth_other");
  const admin = await make("auth_admin", "ADMIN");
  return {
    t,
    creator,
    other,
    admin,
    asCreator: t.withIdentity({ subject: "auth_creator" }),
    asOther: t.withIdentity({ subject: "auth_other" }),
    asAdmin: t.withIdentity({ subject: "auth_admin" }),
  };
}

function makeFundraiser(
  t: T,
  creator: Id<"users">,
  status: Status,
  endDate?: number,
) {
  return t.run((ctx) =>
    ctx.db.insert("fundraisers", {
      creatorId: creator,
      beneficiaryType: "SELF",
      title: "Water for Kajiado",
      story: "A story that is long enough to be a story.",
      type: "COMMUNITY_HARAMBEE",
      goalAmount: 100000,
      currency: "KES",
      amountRaised: 0,
      donorCount: 0,
      status,
      isPrivate: false,
      isVerified: false,
      endDate,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

const get = (t: T, id: Id<"fundraisers">) => t.run((ctx) => ctx.db.get(id));
const sweep = (t: T) => t.mutation(internal.fundraiserExpiry.expireEnded, {});

describe("the expiry sweep", () => {
  it("expires an ACTIVE fundraiser whose end date has passed", async () => {
    const { t, creator } = await setup();
    const endDate = NOW - 3 * HOUR;
    const id = await makeFundraiser(t, creator, "ACTIVE", endDate);

    await sweep(t);

    const after = await get(t, id);
    expect(after?.status).toBe("EXPIRED");
    // Closed when it stopped taking donations, not when the sweep ran.
    expect(after?.closedAt).toBe(endDate);
    // Stamped when the sweep ran. The clock can tick a millisecond between
    // setting it and the mutation reading it, so don't pin the exact value.
    expect(after?.updatedAt).toBeGreaterThanOrEqual(NOW);
    expect(after?.updatedAt).toBeLessThan(NOW + HOUR);
  });

  it("expires one that ended a moment ago", async () => {
    const { t, creator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW - 1);
    await sweep(t);
    expect((await get(t, id))?.status).toBe("EXPIRED");
  });

  it("leaves a fundraiser that is still running", async () => {
    const { t, creator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW + HOUR);
    await sweep(t);
    expect((await get(t, id))?.status).toBe("ACTIVE");
  });

  it("leaves a fundraiser with no end date open", async () => {
    const { t, creator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE");
    await sweep(t);
    const after = await get(t, id);
    expect(after?.status).toBe("ACTIVE");
    expect(after?.closedAt).toBeUndefined();
  });

  it.each<Status>([
    "DRAFT",
    "PENDING_REVIEW",
    "PAUSED",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "EXPIRED",
  ])("leaves a %s fundraiser's status and dates alone", async (status) => {
    const { t, creator } = await setup();
    const id = await makeFundraiser(t, creator, status, NOW - DAY);
    const before = await get(t, id);

    await sweep(t);

    expect(await get(t, id)).toEqual(before);
  });

  it("doesn't touch money or counts", async () => {
    const { t, creator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW - HOUR);
    await t.run((ctx) => ctx.db.patch(id, { amountRaised: 42000, donorCount: 9 }));

    await sweep(t);

    const after = await get(t, id);
    expect(after).toMatchObject({
      status: "EXPIRED",
      amountRaised: 42000,
      donorCount: 9,
      goalAmount: 100000,
    });
  });

  it("is safe to run again", async () => {
    const { t, creator } = await setup();
    const endDate = NOW - HOUR;
    const id = await makeFundraiser(t, creator, "ACTIVE", endDate);

    await sweep(t);
    vi.setSystemTime(NOW + 5 * HOUR);
    await sweep(t);

    const after = await get(t, id);
    expect(after?.status).toBe("EXPIRED");
    expect(after?.closedAt).toBe(endDate);
  });

  it("works through a backlog bigger than one batch", async () => {
    const { t, creator } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i++) {
        await ctx.db.insert("fundraisers", {
          creatorId: creator,
          beneficiaryType: "SELF",
          title: `Ended ${i}`,
          story: "A story that is long enough to be a story.",
          type: "OTHER",
          goalAmount: 1000,
          currency: "KES",
          amountRaised: 0,
          donorCount: 0,
          status: "ACTIVE",
          isPrivate: false,
          isVerified: false,
          endDate: NOW - (i + 1) * 1000,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    const live = await makeFundraiser(t, creator, "ACTIVE", NOW + DAY);

    // One run does one batch and queues the rest.
    await sweep(t);
    const afterOne = await t.run(async (ctx) =>
      (await ctx.db.query("fundraisers").collect()).filter(
        (f) => f.status === "EXPIRED",
      ).length,
    );
    expect(afterOne).toBe(100);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const all = await t.run((ctx) => ctx.db.query("fundraisers").collect());
    expect(all.filter((f) => f.status === "EXPIRED")).toHaveLength(105);
    expect((await get(t, live))?.status).toBe("ACTIVE");
  });

  it("does nothing when there is nothing to expire", async () => {
    const { t } = await setup();
    await expect(sweep(t)).resolves.toBeNull();
  });
});

// ---- Setting an end date ----------------------------------------------

const newFundraiser = (overrides: Record<string, unknown> = {}) => ({
  title: "Water for Kajiado",
  type: "COMMUNITY_HARAMBEE",
  story: "A story that is long enough to be a story, with plenty of detail.",
  beneficiaryType: "SELF",
  goalAmount: 100000,
  currency: "KES",
  endDate: NOW + 30 * DAY,
  ...overrides,
});

describe("creating a fundraiser", () => {
  it("stores the end date", async () => {
    const { t, asCreator } = await setup();
    const endDate = endOfNairobiDay("2027-01-31")!;

    const id = await asCreator.mutation(
      api.fundraiser.createFundraiser,
      newFundraiser({ endDate }),
    );

    const row = await get(t, id);
    expect(row).toMatchObject({ status: "ACTIVE", endDate });
  });

  it("requires an end date", async () => {
    const { t, asCreator } = await setup();
    const withoutEndDate = Object.fromEntries(
      Object.entries(newFundraiser()).filter(([key]) => key !== "endDate"),
    ) as Omit<ReturnType<typeof newFundraiser>, "endDate">;

    await expect(
      asCreator.mutation(api.fundraiser.createFundraiser, withoutEndDate),
    ).rejects.toThrow("Choose when your fundraiser ends.");
    expect(
      await t.run((ctx) => ctx.db.query("fundraisers").collect()),
    ).toHaveLength(0);
  });

  it("refuses an end date that has already passed", async () => {
    const { t, asCreator } = await setup();
    await expect(
      asCreator.mutation(
        api.fundraiser.createFundraiser,
        newFundraiser({ endDate: NOW - 1 }),
      ),
    ).rejects.toThrow("The end date must be in the future.");
    expect(
      await t.run((ctx) => ctx.db.query("fundraisers").collect()),
    ).toHaveLength(0);
  });

  it("refuses an end date more than a year out", async () => {
    const { asCreator } = await setup();
    await expect(
      asCreator.mutation(
        api.fundraiser.createFundraiser,
        newFundraiser({ endDate: NOW + 400 * DAY }),
      ),
    ).rejects.toThrow(/up to 365 days/);
  });

  it("accepts the furthest allowed day", async () => {
    const { t, asCreator } = await setup();
    const endDate = endOfNairobiDay(maxEndDateString(NOW))!;
    const id = await asCreator.mutation(
      api.fundraiser.createFundraiser,
      newFundraiser({ endDate }),
    );
    expect((await get(t, id))?.endDate).toBe(endDate);
  });
});

// ---- Extending --------------------------------------------------------

describe("extending an end date", () => {
  const extend = (
    as: Awaited<ReturnType<typeof setup>>["asCreator"],
    fundraiserId: Id<"fundraisers">,
    endDate: number,
  ) => as.mutation(api.fundraiser.extendEndDate, { fundraiserId, endDate });

  it("moves the end date later", async () => {
    const { t, creator, asCreator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW + 10 * DAY);
    const later = endOfNairobiDay("2027-03-31")!;

    await extend(asCreator, id, later);

    expect(await get(t, id)).toMatchObject({ endDate: later, status: "ACTIVE" });
  });

  it("lets an admin extend someone else's fundraiser, like editing it", async () => {
    const { t, creator, asAdmin } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW + 10 * DAY);
    await extend(asAdmin, id, NOW + 20 * DAY);
    expect((await get(t, id))?.endDate).toBe(NOW + 20 * DAY);
  });

  it("gives an end date to a fundraiser that has none", async () => {
    const { t, creator, asCreator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE");
    await extend(asCreator, id, NOW + 30 * DAY);
    expect((await get(t, id))?.endDate).toBe(NOW + 30 * DAY);
  });

  it("is refused for someone who isn't the owner", async () => {
    const { t, creator, asOther } = await setup();
    const endDate = NOW + 10 * DAY;
    const id = await makeFundraiser(t, creator, "ACTIVE", endDate);

    await expect(extend(asOther, id, NOW + 20 * DAY)).rejects.toThrow(
      "You don't have permission to modify this fundraiser.",
    );
    expect((await get(t, id))?.endDate).toBe(endDate);
  });

  it("is refused when signed out", async () => {
    const { t, creator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW + DAY);
    await expect(
      t.mutation(api.fundraiser.extendEndDate, {
        fundraiserId: id,
        endDate: NOW + 5 * DAY,
      }),
    ).rejects.toThrow("You must be signed in");
  });

  it("can't shorten the end date or leave it where it is", async () => {
    const { t, creator, asCreator } = await setup();
    const endDate = NOW + 20 * DAY;
    const id = await makeFundraiser(t, creator, "ACTIVE", endDate);

    await expect(extend(asCreator, id, NOW + 10 * DAY)).rejects.toThrow(
      "Choose a date after the current end date.",
    );
    await expect(extend(asCreator, id, endDate)).rejects.toThrow(
      "Choose a date after the current end date.",
    );
    expect((await get(t, id))?.endDate).toBe(endDate);
  });

  it("can't go more than a year out", async () => {
    const { t, creator, asCreator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW + DAY);
    await expect(extend(asCreator, id, NOW + 400 * DAY)).rejects.toThrow(
      /up to 365 days/,
    );
  });

  it("can't bring back a fundraiser whose end date has passed, even before the sweep", async () => {
    const { t, creator, asCreator } = await setup();
    const endDate = NOW - HOUR;
    const id = await makeFundraiser(t, creator, "ACTIVE", endDate);

    await expect(extend(asCreator, id, NOW + 10 * DAY)).rejects.toThrow(
      "Only a running fundraiser can be extended",
    );
    expect((await get(t, id))?.endDate).toBe(endDate);
  });

  it.each<Status>([
    "DRAFT",
    "PENDING_REVIEW",
    "PAUSED",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "EXPIRED",
  ])("is refused when the fundraiser is %s", async (status) => {
    const { t, creator, asCreator } = await setup();
    const id = await makeFundraiser(t, creator, status, NOW + 10 * DAY);
    await expect(extend(asCreator, id, NOW + 20 * DAY)).rejects.toThrow(
      "Only a running fundraiser can be extended",
    );
  });

  it("an extended fundraiser survives the sweep, then expires at the new date", async () => {
    const { t, creator, asCreator } = await setup();
    const id = await makeFundraiser(t, creator, "ACTIVE", NOW + 2 * HOUR);
    await extend(asCreator, id, NOW + 3 * DAY);

    vi.setSystemTime(NOW + DAY);
    await sweep(t);
    expect((await get(t, id))?.status).toBe("ACTIVE");

    vi.setSystemTime(NOW + 4 * DAY);
    await sweep(t);
    expect((await get(t, id))?.status).toBe("EXPIRED");
  });
});
