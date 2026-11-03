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

export default crons;
