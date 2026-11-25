"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { formatKesWhole } from "@/lib/fundraiser-progress";
import { timeAgo } from "@/lib/donation-activity";
import {
  useFundraiserActivity,
  type FundraiserActivity,
} from "./use-fundraiser-activity";
import { useNow } from "./use-now";

/**
 * The latest few donations, in the donate card, so someone arriving later sees
 * the same people the pop-up showed. Each is a name, an amount and how long
 * ago; see lib/donation-activity.ts for how a donor is named.
 */
export function RecentDonations({
  fundraiserId,
  initial,
}: {
  fundraiserId: Id<"fundraisers">;
  initial: FundraiserActivity;
}) {
  const { recent } = useFundraiserActivity(fundraiserId, initial);
  const now = useNow();

  if (recent.length === 0) return null;

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">Recent donations</p>
      <ul className="space-y-1.5">
        {recent.map((donation) => (
          <li
            key={donation.id}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="min-w-0 truncate">
              {donation.name}
              {now !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  · {timeAgo(donation.at, now)}
                </span>
              )}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatKesWhole(donation.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
