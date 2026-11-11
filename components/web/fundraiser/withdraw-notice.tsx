"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buttonVariants } from "@/components/ui/button";
import { formatKes } from "@/components/web/payouts/format";

interface WithdrawNoticeProps {
  fundraiserId: Id<"fundraisers">;
  creatorId: Id<"users">;
}

// Shown only to the fundraiser's owner: what they can withdraw, with a link to
// do it. Visitors never run the query.
export function WithdrawNotice({ fundraiserId, creatorId }: WithdrawNoticeProps) {
  const currentUser = useQuery(api.users.getCurrentUser);
  const overview = useQuery(
    api.payouts.getMyPayoutOverview,
    currentUser && currentUser._id === creatorId ? { fundraiserId } : "skip",
  );

  if (!overview) return null;

  const open = overview.payouts.find(
    (payout) => payout.status === "REQUESTED" || payout.status === "APPROVED",
  );

  let message: string | null = null;
  if (open) {
    message =
      open.status === "REQUESTED"
        ? `Your withdrawal of ${formatKes(open.amount)} is waiting for review.`
        : `Your withdrawal of ${formatKes(open.amount)} is approved and being sent.`;
  } else if (overview.available >= overview.minPayout) {
    message = `${formatKes(overview.available)} is ready to withdraw.`;
  } else if (overview.pending > 0) {
    message = `${formatKes(overview.pending)} is on its way and will be ready to withdraw soon.`;
  }
  if (!message) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
      <div className="flex items-start gap-3">
        <Wallet
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">{message}</p>
          <p className="text-muted-foreground">Only you can see this.</p>
        </div>
      </div>
      <Link
        href={`/payouts#withdraw-${fundraiserId}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {open ? "View" : "Withdraw"}
      </Link>
    </div>
  );
}
