/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { v, type PropertyValidators } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  SYSTEM_ALERT_KINDS,
  SYSTEM_ALERT_KEEP_RESOLVED_MS,
  SYSTEM_ALERTS,
  type SystemAlertKind,
} from "../lib/system-alerts";
import { guardedJob } from "./lib/systemAlerts";
import { fund, figures, seedPayoutWorld, type T } from "./payouts.fixtures";

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
    registerRoutes: () => {},
  },
  createAuth: () => ({}),
}));

const modules = import.meta.glob("./**/*.ts");
// Every file that is part of the deploy, as text, for the checks that read the
// code itself.
const sources = import.meta.glob(
  [
    "./*.ts",
    "./lib/*.ts",
    "!./**/*.test.ts",
    "!./**/*.fixtures.ts",
    "!./_generated/**",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const NOW = Date.parse("2026-11-24T09:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OPS = "ops@example.test";
const RESEND_URL = "https://api.resend.com/emails";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("ALERT_EMAIL_TO", OPS);
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const allAlerts = (t: T) =>
  t.run((ctx) => ctx.db.query("systemAlerts").collect());

/** Emails sent to the alert address. */
function alertEmails() {
  return fetchMock.mock.calls
    .filter(([url]) => url === RESEND_URL)
    .map(
      ([, init]) =>
        JSON.parse(init.body as string) as { to: string[]; subject: string },
    )
    .filter((body) => body.to.includes(OPS));
}

/**
 * The deployed code with one job swapped for one that always throws, to see
 * what the guard does when the real job fails.
 */
function withBrokenJob(
  file: string,
  job: string,
  args: PropertyValidators = {},
): typeof modules {
  return {
    ...modules,
    [file]: async () => ({
      ...((await modules[file]()) as Record<string, unknown>),
      [job]: internalMutation({
        args,
        handler: async () => {
          throw new Error("Boom: the job fell over");
        },
      }),
    }),
  };
}

// The four crons: how to run each through its guard, and which job it guards.
const JOBS = [
  {
    label: "closing ended fundraisers",
    kind: "JOB_EXPIRE_ENDED_FAILED",
    file: "./fundraiserExpiry.ts",
    job: "expireEnded",
    run: (t: T) => t.action(internal.guardedJobs.expireEnded, {}),
  },
  {
    label: "refreshing the homepage numbers",
    kind: "JOB_PLATFORM_STATS_FAILED",
    file: "./platformStats.ts",
    job: "refresh",
    run: (t: T) => t.action(internal.guardedJobs.refreshPlatformStats, {}),
  },
  {
    label: "deleting abandoned uploads",
    kind: "JOB_UPLOAD_SWEEP_FAILED",
    file: "./documentUploads.ts",
    job: "sweepStaleDocumentUploads",
    run: (t: T) => t.action(internal.guardedJobs.sweepStaleUploads, {}),
  },
  {
    label: "deleting old alerts",
    kind: "JOB_ALERT_PRUNE_FAILED",
    file: "./systemAlerts.ts",
    job: "prune",
    run: (t: T) => t.action(internal.guardedJobs.pruneAlerts, {}),
  },
] as const;

const openAlert = (
  kind: SystemAlertKind,
  overrides: { reference?: string; count?: number; lastSeenAt?: number } = {},
) => ({
  kind,
  status: "OPEN" as const,
  count: overrides.count ?? 1,
  firstSeenAt: NOW - DAY,
  lastSeenAt: overrides.lastSeenAt ?? NOW - HOUR,
  ...(overrides.reference ? { reference: overrides.reference } : {}),
});

// ---- The guard itself ---------------------------------------------------

describe("guardedJob", () => {
  it("runs the job and records nothing when it works", async () => {
    const runMutation = vi.fn();
    const job = vi.fn().mockResolvedValue("done");

    const result = await guardedJob(
      { runMutation },
      { kind: "JOB_EXPIRE_ENDED_FAILED" },
      job,
    );

    expect(job).toHaveBeenCalledTimes(1);
    expect(runMutation).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("records the problem, then throws the same error again", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const failure = new Error("Boom");

    await expect(
      guardedJob(
        { runMutation },
        { kind: "JOB_SETTLE_DONATION_FAILED", reference: "d-1" },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toEqual({
      kind: "JOB_SETTLE_DONATION_FAILED",
      reference: "d-1",
      detail: "Boom",
    });
  });

  it("still throws the job's own error when the alert can't be recorded", async () => {
    const runMutation = vi
      .fn()
      .mockRejectedValue(new Error("Database is down"));
    const failure = new Error("Boom");

    await expect(
      guardedJob(
        { runMutation },
        { kind: "JOB_ALERT_PRUNE_FAILED" },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });
});

// ---- A job that fails ----------------------------------------------------

describe("a job that throws", () => {
  it.each(JOBS)(
    "raises an alert when $label fails, and the run still counts as failed",
    async ({ kind, file, job, run }) => {
      const t = convexTest(schema, withBrokenJob(file, job));

      await expect(run(t)).rejects.toThrow("Boom: the job fell over");

      const alerts = await allAlerts(t);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ kind, status: "OPEN", count: 1 });
      expect(alerts[0].detail).toContain("Boom: the job fell over");
      expect(alerts[0].reference).toBeUndefined();
    },
  );

  it.each(JOBS)(
    "emails the serious ones and only those ($label)",
    async ({ kind, file, job, run }) => {
      const t = convexTest(schema, withBrokenJob(file, job));
      await expect(run(t)).rejects.toThrow();
      await settle(t);

      if (SYSTEM_ALERTS[kind].severity === "ERROR") {
        const emails = alertEmails();
        expect(emails).toHaveLength(1);
        expect(emails[0].subject).toBe(
          `[GoUplift] ${SYSTEM_ALERTS[kind].title}`,
        );
      } else {
        expect(alertEmails()).toHaveLength(0);
      }
    },
  );

  it("counts a failure that repeats instead of adding a row", async () => {
    const t = convexTest(
      schema,
      withBrokenJob("./fundraiserExpiry.ts", "expireEnded"),
    );
    await t.run((ctx) =>
      ctx.db.insert(
        "systemAlerts",
        openAlert("JOB_EXPIRE_ENDED_FAILED", { count: 4 }),
      ),
    );

    await expect(
      t.action(internal.guardedJobs.expireEnded, {}),
    ).rejects.toThrow();

    const alerts = await allAlerts(t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: "OPEN", count: 5 });
  });

  it("names the donation when settling a PayPal donation fails", async () => {
    const broken = withBrokenJob("./payoutBalances.ts", "settleDonation", {
      donationId: v.id("donations"),
    });
    const { t, ids } = await seedPayoutWorld(convexTest(schema, broken));
    const donationId = await fund(t, ids.fundraiser, 800, {
      provider: "PAYPAL",
    });

    await expect(
      t.action(internal.guardedJobs.settleDonation, { donationId }),
    ).rejects.toThrow("Boom");

    const alerts = await allAlerts(t);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "JOB_SETTLE_DONATION_FAILED",
      status: "OPEN",
      reference: donationId,
    });
    // The organizer's balance is still missing it: that is what the alert is for.
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 0,
      pendingNet: 800,
    });
    // Let the email go out, without running the settling job that `fund`
    // scheduled for three days from now (it would fail again, and that would
    // be a second email).
    await vi.advanceTimersByTimeAsync(1000);
    await t.finishInProgressScheduledFunctions();
    expect(alertEmails()).toHaveLength(1);
  });

  it("keeps a separate alert for each donation that fails", async () => {
    const broken = withBrokenJob("./payoutBalances.ts", "settleDonation", {
      donationId: v.id("donations"),
    });
    const { t, ids } = await seedPayoutWorld(convexTest(schema, broken));
    const first = await fund(t, ids.fundraiser, 100, { provider: "PAYPAL" });
    const second = await fund(t, ids.fundraiser, 200, { provider: "PAYPAL" });

    await expect(
      t.action(internal.guardedJobs.settleDonation, { donationId: first }),
    ).rejects.toThrow();
    await expect(
      t.action(internal.guardedJobs.settleDonation, { donationId: second }),
    ).rejects.toThrow();

    const alerts = await allAlerts(t);
    expect(alerts.map((alert) => alert.reference).sort()).toEqual(
      [first, second].sort(),
    );
  });
});

// ---- A job that works ----------------------------------------------------

describe("a job that finishes", () => {
  it.each(JOBS)(
    "closes the open alert for $label, and only that one",
    async ({ kind, run }) => {
      const t = convexTest(schema, modules);
      const ids = await t.run(async (ctx) => ({
        mine: await ctx.db.insert("systemAlerts", openAlert(kind)),
        other: await ctx.db.insert(
          "systemAlerts",
          openAlert("PAYPAL_REFUND_UNMATCHED", { reference: "R-1" }),
        ),
        otherJob: await ctx.db.insert(
          "systemAlerts",
          openAlert(
            kind === "JOB_EXPIRE_ENDED_FAILED"
              ? "JOB_PLATFORM_STATS_FAILED"
              : "JOB_EXPIRE_ENDED_FAILED",
          ),
        ),
        // Already dealt with by hand: keeps what the person wrote.
        handled: await ctx.db.insert("systemAlerts", {
          ...openAlert(kind),
          status: "RESOLVED",
          resolvedAt: NOW - HOUR,
          resolveNote: "Fixed by hand",
        }),
      }));

      await run(t);

      const get = (id: (typeof ids)["mine"]) => t.run((ctx) => ctx.db.get(id));
      const mine = await get(ids.mine);
      expect(mine).toMatchObject({
        status: "RESOLVED",
        resolveNote: "Ran again without a problem.",
      });
      expect(mine?.resolvedAt).toBeGreaterThanOrEqual(NOW);
      expect(mine?.resolvedBy).toBeUndefined();
      expect((await get(ids.other))?.status).toBe("OPEN");
      expect((await get(ids.otherJob))?.status).toBe("OPEN");
      expect(await get(ids.handled)).toMatchObject({
        status: "RESOLVED",
        resolvedAt: NOW - HOUR,
        resolveNote: "Fixed by hand",
      });
    },
  );

  // The homepage numbers are added up a page of fundraisers at a time. Each
  // page's guarded run has to carry the running totals to the next, or the
  // job starts over from the first page for ever.
  it("passes the running totals on when the stats job carries on", async () => {
    const t = convexTest(schema, modules);

    await t.action(internal.guardedJobs.refreshPlatformStats, {
      cursor: null,
      accumulator: {
        totalRaisedKes: 500,
        totalDonations: 3,
        fundraisersLaunched: 2,
        activeFundraisers: 1,
        categoryCounts: { MEDICAL: 1 },
      },
    });

    const stats = await t.run((ctx) => ctx.db.query("platformStats").unique());
    expect(stats).toMatchObject({
      totalRaisedKes: 500,
      totalDonations: 3,
      fundraisersLaunched: 2,
      activeFundraisers: 1,
      categories: [{ type: "MEDICAL", count: 1 }],
    });
  });

  it("leaves the alert open when the run fails", async () => {
    const t = convexTest(
      schema,
      withBrokenJob("./platformStats.ts", "refresh"),
    );
    await t.run((ctx) =>
      ctx.db.insert("systemAlerts", openAlert("JOB_PLATFORM_STATS_FAILED")),
    );

    await expect(
      t.action(internal.guardedJobs.refreshPlatformStats, {}),
    ).rejects.toThrow();

    expect((await allAlerts(t))[0].status).toBe("OPEN");
  });

  it("waits for the last run when the work is split across several", async () => {
    const t = convexTest(schema, modules);
    const old = NOW - SYSTEM_ALERT_KEEP_RESOLVED_MS - DAY;
    const alertId = await t.run(async (ctx) => {
      // More than one batch of old resolved alerts for the clean-up to delete.
      for (let i = 0; i < 230; i++) {
        await ctx.db.insert("systemAlerts", {
          kind: "PAYPAL_REFUND_UNMATCHED",
          reference: `r-${i}`,
          status: "RESOLVED",
          count: 1,
          firstSeenAt: old,
          lastSeenAt: old,
        });
      }
      return await ctx.db.insert(
        "systemAlerts",
        openAlert("JOB_ALERT_PRUNE_FAILED"),
      );
    });

    // The first run hands the rest to the next one, so it hasn't finished.
    await t.action(internal.guardedJobs.pruneAlerts, {});
    expect((await t.run((ctx) => ctx.db.get(alertId)))?.status).toBe("OPEN");

    // The next one is the guarded job too, and the last one closes the alert.
    await settle(t);
    expect((await t.run((ctx) => ctx.db.get(alertId)))?.status).toBe(
      "RESOLVED",
    );
  });

  it("settles a PayPal donation", async () => {
    const { t, ids } = await seedPayoutWorld(convexTest(schema, modules));
    const donationId = await fund(t, ids.fundraiser, 800, {
      provider: "PAYPAL",
    });
    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 0,
      pendingNet: 800,
    });

    await t.action(internal.guardedJobs.settleDonation, { donationId });

    expect(await figures(t, ids.fundraiser)).toMatchObject({
      settledNet: 800,
      pendingNet: 0,
    });
  });

  it("doesn't close another donation's alert", async () => {
    const { t, ids } = await seedPayoutWorld(convexTest(schema, modules));
    const donationId = await fund(t, ids.fundraiser, 800, {
      provider: "PAYPAL",
    });
    const alertId = await t.run((ctx) =>
      ctx.db.insert(
        "systemAlerts",
        openAlert("JOB_SETTLE_DONATION_FAILED", { reference: "someone-else" }),
      ),
    );

    await t.action(internal.guardedJobs.settleDonation, { donationId });

    // Someone still has to fix that one, and mark it resolved.
    expect((await t.run((ctx) => ctx.db.get(alertId)))?.status).toBe("OPEN");
  });
});

// ---- Nothing on a timer skips the guard -----------------------------------

describe("everything that runs on a timer goes through the guard", () => {
  it("points every cron at a guarded job", async () => {
    const crons = (await import("./crons")).default;
    const jobs = Object.entries(crons.crons);
    expect(jobs.length).toBeGreaterThanOrEqual(JOBS.length);
    for (const [name, job] of jobs) {
      expect(job.name, `the cron "${name}"`).toMatch(/^guardedJobs:/);
    }
  });

  it("never schedules one of the guarded jobs directly", () => {
    const unguarded =
      /internal\.(fundraiserExpiry\.expireEnded|platformStats\.refresh|documentUploads\.sweepStaleDocumentUploads|systemAlerts\.prune|payoutBalances\.settleDonation)\b/;
    const offenders = Object.entries(sources)
      .filter(([file]) => file !== "./guardedJobs.ts")
      .filter(([, text]) => unguarded.test(text))
      .map(([file]) => file);
    // guardedJobs.ts is the one place that may call them.
    expect(offenders).toEqual([]);
    expect(unguarded.test(sources["./guardedJobs.ts"])).toBe(true);
  });

  it("raises each job alert from exactly one guarded job", () => {
    const text = sources["./guardedJobs.ts"];
    const jobKinds = SYSTEM_ALERT_KINDS.filter((kind) =>
      kind.startsWith("JOB_"),
    );
    expect(jobKinds.length).toBe(JOBS.length + 1);
    for (const kind of jobKinds) {
      expect(text.split(`kind: "${kind}"`).length - 1, kind).toBe(1);
    }
    expect(text.match(/= internalAction\(/g)).toHaveLength(jobKinds.length);
  });

  it("closes each job's alerts in the job itself, once", () => {
    const places = {
      JOB_EXPIRE_ENDED_FAILED: "./fundraiserExpiry.ts",
      JOB_PLATFORM_STATS_FAILED: "./platformStats.ts",
      JOB_UPLOAD_SWEEP_FAILED: "./documentUploads.ts",
      JOB_ALERT_PRUNE_FAILED: "./systemAlerts.ts",
    } as const;
    for (const [kind, file] of Object.entries(places)) {
      const calls = sources[file].split(`clearJobAlerts(ctx, "${kind}")`);
      expect(calls.length - 1, `${file} ${kind}`).toBe(1);
    }
  });

  // Who gets an email is decided here, so a change is a decision, not an accident.
  it("emails for the jobs people depend on, not for the ones that can wait", () => {
    const severities = Object.fromEntries(
      SYSTEM_ALERT_KINDS.filter((kind) => kind.startsWith("JOB_")).map(
        (kind) => [kind, SYSTEM_ALERTS[kind].severity],
      ),
    );
    expect(severities).toEqual({
      JOB_EXPIRE_ENDED_FAILED: "ERROR",
      JOB_PLATFORM_STATS_FAILED: "WARNING",
      JOB_UPLOAD_SWEEP_FAILED: "WARNING",
      JOB_ALERT_PRUNE_FAILED: "WARNING",
      JOB_SETTLE_DONATION_FAILED: "ERROR",
    });
  });

  it("explains every job alert in plain words", () => {
    for (const kind of SYSTEM_ALERT_KINDS.filter((k) => k.startsWith("JOB_"))) {
      expect(SYSTEM_ALERTS[kind].title.length).toBeGreaterThan(10);
      expect(SYSTEM_ALERTS[kind].help.length).toBeGreaterThan(40);
    }
  });
});
