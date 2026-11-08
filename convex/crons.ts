import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Homepage totals only need to be roughly current.
crons.interval(
  "refresh platform stats",
  { minutes: 30 },
  internal.platformStats.refresh,
  {},
);

export default crons;
