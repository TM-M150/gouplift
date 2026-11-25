"use client";

import * as React from "react";
import { HeartHandshake, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { formatKesWhole } from "@/lib/fundraiser-progress";
import { timeAgo, trackNewDonations } from "@/lib/donation-activity";
import {
  useLiveActivity,
  type FundraiserActivity,
} from "./use-fundraiser-activity";
import { useNow } from "./use-now";

type Recent = FundraiserActivity["recent"];

/** How long the pop-up stays before it goes by itself. */
const SHOW_FOR_MS = 10_000;

type Tracking = {
  /** The latest donations last looked at, as one string, to notice a change. */
  signature: string | null;
  /** Every donation already seen on this page, or null before the first look. */
  seen: ReadonlySet<string> | null;
  popup: {
    id: number;
    donations: Recent;
    freshIds: ReadonlySet<string>;
  } | null;
};

/**
 * A small card that appears when a donation is paid while the page is open,
 * showing that donation and the two before it. It does not appear for what was
 * already there when the page opened, and it does not appear for the donation
 * this visitor has just made themselves, which the banner at the top already
 * thanks them for.
 */
export function DonationPopup({
  fundraiserId,
  ownDonationId,
}: {
  fundraiserId: Id<"fundraisers">;
  /** The donation this visitor just made, from the address, if any. */
  ownDonationId?: string;
}) {
  const live = useLiveActivity(fundraiserId);
  const now = useNow();
  const [state, setState] = React.useState<Tracking>({
    signature: null,
    seen: null,
    popup: null,
  });

  // Worked out as the result arrives, not in an effect: when the latest
  // donations change, anything not seen before is new.
  const signature = live ? live.recent.map((d) => d.id).join(",") : null;
  if (live && signature !== state.signature) {
    const { seen, fresh } = trackNewDonations(state.seen, live.recent);
    const announce = fresh.filter((d) => d.id !== ownDonationId);
    setState({
      signature,
      seen,
      popup: announce.length
        ? {
            id: (state.popup?.id ?? 0) + 1,
            donations: live.recent,
            freshIds: new Set(announce.map((d) => d.id)),
          }
        : state.popup,
    });
  }

  const popupId = state.popup?.id;
  React.useEffect(() => {
    if (popupId === undefined) return;
    const timer = window.setTimeout(
      () => setState((current) => ({ ...current, popup: null })),
      SHOW_FOR_MS,
    );
    return () => window.clearTimeout(timer);
  }, [popupId]);

  const popup = state.popup;
  if (!popup) return null;

  return (
    <div
      key={popup.id}
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-40 rounded-2xl border bg-card p-4 text-card-foreground shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none sm:right-auto sm:w-80"
    >
      <button
        type="button"
        onClick={() => setState((current) => ({ ...current, popup: null }))}
        aria-label="Dismiss"
        className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
      <p className="flex items-center gap-2 pr-8 text-sm font-semibold">
        <HeartHandshake className="size-4 text-primary" aria-hidden />
        {popup.freshIds.size > 1 ? "New donations" : "New donation"}
      </p>
      <ul className="mt-3 space-y-2">
        {popup.donations.map((donation) => {
          const isNew = popup.freshIds.has(donation.id);
          return (
            <li
              key={donation.id}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="min-w-0">
                <span className={isNew ? "font-semibold" : undefined}>
                  {donation.name}
                </span>
                {now !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {timeAgo(donation.at, now)}
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 tabular-nums ${isNew ? "font-semibold" : "text-muted-foreground"}`}
              >
                {formatKesWhole(donation.amount)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
