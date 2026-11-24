import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every job here runs through the guards in guardedJobs.ts, so a run that
// throws raises an alert instead of only a line in the dashboard's logs. Don't
// point a cron at a job directly: guardedJobs.test.ts fails if you do.

// Verification documents that were uploaded but never submitted.
crons.interval(
  "delete stale document uploads",
  { hours: 6 },
  internal.guardedJobs.sweepStaleUploads,
  {},
);

// Homepage totals only need to be roughly current.
crons.interval(
  "refresh platform stats",
  { minutes: 30 },
  internal.guardedJobs.refreshPlatformStats,
  {},
);

// Closes fundraisers whose end date has passed. Donations already stop at the
// end date itself, so this only needs to run now and then.
crons.interval(
  "expire ended fundraisers",
  { hours: 1 },
  internal.guardedJobs.expireEnded,
  {},
);

// Resolved payment-problem alerts are only kept for a while.
crons.interval(
  "delete old resolved system alerts",
  { hours: 24 },
  internal.guardedJobs.pruneAlerts,
  {},
);

export default crons;
