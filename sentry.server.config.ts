// Starts Sentry on the server, once, when it starts (see instrumentation.ts).
// The settings are shared with the browser and are in lib/sentry.ts.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry";

Sentry.init(sentryOptions);
