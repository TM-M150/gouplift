"use client";

import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { formatKesWhole, fundraiserProgress } from "@/lib/fundraiser-progress";
import {
  useFundraiserActivity,
  type FundraiserActivity,
} from "./use-fundraiser-activity";

/**
 * The bar, the amount raised and the donation count in the donate card. They
 * start as the server drew them and then follow the database, so a donor
 * watching the page sees the total go up the moment a payment is recorded,
 * without reloading.
 */
export function LiveFundraiserStats({
  fundraiserId,
  initial,
  children,
}: {
  fundraiserId: Id<"fundraisers">;
  initial: FundraiserActivity;
  /** What goes under the figures (the end date), drawn by the server. */
  children?: ReactNode;
}) {
  const { amountRaised, goalAmount, donorCount } = useFundraiserActivity(
    fundraiserId,
    initial,
  );
  const progress = fundraiserProgress(amountRaised, goalAmount);

  return (
    <div className="space-y-1.5">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Amount raised"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-semibold">
          {formatKesWhole(amountRaised)}
        </span>
        <span className="text-sm text-muted-foreground">
          of {formatKesWhole(goalAmount)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {donorCount} {donorCount === 1 ? "donation" : "donations"} · {progress}%
        funded
      </p>
      {children}
    </div>
  );
}
