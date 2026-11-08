import { v } from "convex/values";

// Where a donation was started. This is attribution for analytics and, later,
// for telling organizations how much came through their embeds or API. It is
// never used to decide what a caller may do.
//
//   WEB   — GoUplift's own pages (also what a missing value means)
//   EMBED — a donate widget on an organization's own website
//   API   — a request authenticated with an organization API key
export const donationSourceValidator = v.union(
  v.literal("WEB"),
  v.literal("EMBED"),
  v.literal("API"),
);

// Public actions can be called by anyone, so a caller may only claim the
// sources a browser can legitimately be in. "API" is set by the server once
// an API key has been verified, never taken from the request.
export const clientDonationSourceValidator = v.union(
  v.literal("WEB"),
  v.literal("EMBED"),
);
