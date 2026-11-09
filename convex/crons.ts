import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Verification documents that were uploaded but never submitted.
crons.interval(
  "delete stale document uploads",
  { hours: 6 },
  internal.documentUploads.sweepStaleDocumentUploads,
  {},
);

// Homepage totals only need to be roughly current.
crons.interval(
  "refresh platform stats",
  { minutes: 30 },
  internal.platformStats.refresh,
  {},
);

// Closes fundraisers whose end date has passed. Donations already stop at the
// end date itself, so this only needs to run now and then.
crons.interval(
  "expire ended fundraisers",
  { hours: 1 },
  internal.fundraiserExpiry.expireEnded,
  {},
);

export default crons;
