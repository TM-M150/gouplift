import { afterEach, describe, expect, it, vi } from "vitest";

// The Sentry files in the project root, as text.
const rootFiles = import.meta.glob(
  [
    "../instrumentation-client.ts",
    "../sentry.server.config.ts",
    "../sentry.edge.config.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const appFiles = import.meta.glob("../app/**/*.{ts,tsx}");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return await import("./sentry");
}

describe("what Sentry is allowed to collect", () => {
  // Switching one of these on sends visitors' details to a third party. If you
  // mean to, change this test, and the Privacy Policy, with it.
  it("keeps visitors' data out of error reports", async () => {
    const { sentryOptions } = await load();
    expect(sentryOptions.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
    });
    // Only the browser and device type, out of all the headers.
    expect(sentryOptions.dataCollection?.httpHeaders).toEqual({
      request: { allow: ["user-agent"] },
      response: false,
    });
  });

  it("sends errors only: no session replay and no performance traces", async () => {
    const { sentryOptions } = await load();
    expect(sentryOptions.tracesSampleRate).toBeUndefined();
    expect(sentryOptions.tracesSampler).toBeUndefined();
    // Replay options exist only on the browser's own type.
    const options: Record<string, unknown> = { ...sentryOptions };
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
  });

  // With a release name set, which the live site has, Sentry's browser code
  // pings it on every page view with the visitor's browser type.
  it("does not report visits", async () => {
    const { sentryOptions } = await load();
    const integrations = sentryOptions.integrations;
    expect(typeof integrations).toBe("function");
    const names = (list: string[]) =>
      (integrations as (list: { name: string }[]) => { name: string }[])(
        list.map((name) => ({ name })),
      ).map(({ name }) => name);
    expect(
      names(["Dedupe", "BrowserSession", "GlobalHandlers", "ProcessSession"]),
    ).toEqual(["Dedupe", "GlobalHandlers"]);
  });

  it("cleans every event and breadcrumb before it is sent", async () => {
    const { sentryOptions } = await load();
    // The copy of the scrubber that lib/sentry.ts loaded, not another one.
    const { scrubBreadcrumb, scrubEvent } = await import("./sentry-scrub");
    expect(sentryOptions.beforeSend).toBe(scrubEvent);
    expect(sentryOptions.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });
});

describe("where errors are reported from", () => {
  it("reports from the live site", async () => {
    const { sentryOptions, SENTRY_ENABLED } = await load({
      NEXT_PUBLIC_APP_ENV: "production",
    });
    expect(SENTRY_ENABLED).toBe(true);
    expect(sentryOptions.environment).toBe("production");
    expect(sentryOptions.dsn).toContain("ingest.us.sentry.io");
  });

  it.each(["preview", "development", ""])(
    "stays quiet in %j, so it doesn't use up the monthly allowance",
    async (env) => {
      const { SENTRY_ENABLED, sentryOptions } = await load({
        NEXT_PUBLIC_APP_ENV: env,
      });
      expect(SENTRY_ENABLED).toBe(false);
      expect(sentryOptions.enabled).toBe(false);
    },
  );

  it("reports anywhere when a DSN is set on purpose", async () => {
    const { SENTRY_ENABLED, SENTRY_DSN } = await load({
      NEXT_PUBLIC_SENTRY_DSN: "https://key@example.test/1",
    });
    expect(SENTRY_ENABLED).toBe(true);
    expect(SENTRY_DSN).toBe("https://key@example.test/1");
  });
});

describe("the files that start Sentry", () => {
  it("all use the shared settings, and none sets its own", () => {
    expect(Object.keys(rootFiles)).toHaveLength(3);
    for (const [file, text] of Object.entries(rootFiles)) {
      expect(text, file).toContain("Sentry.init(sentryOptions)");
      expect(text, file).not.toMatch(/dsn:|replayIntegration|tracesSampleRate/);
    }
  });

  // Sentry's setup wizard adds a page and a route that throw an error whenever
  // anyone visits them. Left on a live site, they let anyone use up the
  // monthly allowance of errors in a minute. Re-running the wizard brings them
  // back, so this fails if it does.
  it("has no public page or route that raises errors on demand", () => {
    const offenders = Object.keys(appFiles).filter((file) =>
      file.toLowerCase().includes("sentry"),
    );
    expect(offenders).toEqual([]);
  });
});
