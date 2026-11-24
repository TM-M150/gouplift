// How Sentry is set up, shared by the browser (instrumentation-client.ts), the
// server (sentry.server.config.ts) and the edge (sentry.edge.config.ts), so all
// three agree on what is sent and when.
//
// Sentry is for finding out that something broke, not for watching people. It
// sends errors only, and the data collection settings below turn off
// everything that could carry what a visitor typed or who they are. lib/sentry.test.ts
// pins these choices, so changing one is a decision, not an accident.

import type { init } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";

// A DSN only lets people send errors in, not read them, so it is safe in the
// code. Set NEXT_PUBLIC_SENTRY_DSN to report to a different project.
const DEFAULT_DSN =
  "https://5d656b84d5974e679d22c4499764186b@o4512481302151168.ingest.us.sentry.io/4512483835445248";

// "production", "preview" or "development", from Vercel's VERCEL_ENV (see
// next.config.ts). Anywhere else, such as a laptop, it is "development".
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? "development";

// Names of the integrations Sentry adds on its own that report sessions.
const VISIT_REPORTING = new Set(["BrowserSession", "ProcessSession"]);

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || DEFAULT_DSN;

// On the live site only. Preview deployments and laptops stay quiet so they
// don't use up the monthly allowance of errors, unless a DSN is set on purpose
// (to try Sentry out, say).
export const SENTRY_ENABLED =
  APP_ENV === "production" || Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

export const sentryOptions: SentryOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: APP_ENV,

  // Errors only: no performance traces and no session replay. Vercel Speed
  // Insights already measures speed, and a replay records what is on a
  // visitor's screen, which on a site for donations is a lot.

  // This version of the SDK collects almost everything unless told not to
  // (cookies, request bodies, the visitor's IP address, local variables in the
  // code), so each one is switched off here.
  dataCollection: {
    userInfo: false,
    cookies: false,
    // The browser and device type helps find a bug that only one phone has.
    httpHeaders: { request: { allow: ["user-agent"] }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    stackFrameVariables: false,
    databaseQueryData: false,
    queues: false,
  },

  // Sentry also reports on visits, not only on errors: once the live site has
  // a release name, the browser pings Sentry on every page view with the
  // visitor's browser type. Those two are switched off.
  integrations: (defaults) =>
    defaults.filter(({ name }) => !VISIT_REPORTING.has(name)),
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,

  // Harmless browser noise that says nothing about our code.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
  ],
};
