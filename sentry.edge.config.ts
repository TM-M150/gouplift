// Starts Sentry for edge features (middleware and edge routes; see
// instrumentation.ts). Nothing here uses the edge today, but Sentry needs the
// file. The settings are shared and are in lib/sentry.ts.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry";

Sentry.init(sentryOptions);
