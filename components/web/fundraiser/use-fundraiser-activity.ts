"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type FundraiserActivity = NonNullable<
  FunctionReturnType<typeof api.donationActivity.forFundraiser>
>;

/**
 * The fundraiser's live totals and latest donations, straight from the
 * database: Convex pushes a new result the moment a payment is recorded, so
 * nothing has to be reloaded. Undefined until the first result arrives, and
 * null if the fundraiser can no longer be seen.
 *
 * Every part of the page that calls this with the same fundraiser shares the
 * one connection.
 */
export function useLiveActivity(fundraiserId: Id<"fundraisers">) {
  return useQuery(api.donationActivity.forFundraiser, { fundraiserId });
}

/**
 * The live figures, or what the server drew the page with until the first live
 * result arrives, so the numbers never flash empty.
 */
export function useFundraiserActivity(
  fundraiserId: Id<"fundraisers">,
  initial: FundraiserActivity,
): FundraiserActivity {
  return useLiveActivity(fundraiserId) ?? initial;
}
