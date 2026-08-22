"use client";

import Link from "next/link";
import Image from "next/image";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_REVIEW:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400",
  PAUSED:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-400",
  COMPLETED: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400",
  EXPIRED: "bg-muted text-muted-foreground",
};

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

export function FundraisersTab() {
  const fundraisers = useQuery(api.fundraiser.listMyFundraisers);

  // undefined while the query is still loading, [] once it resolves with no results
  if (fundraisers === undefined) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Loading your fundraisers…
      </div>
    );
  }

  if (fundraisers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <p className="text-muted-foreground">
          You haven&apos;t created a fundraiser yet.
        </p>
        {/* Adjust to your actual "create fundraiser" route */}
        <Link
          href="/fundraise-form"
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          Start a fundraiser
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {fundraisers.map((fundraiser) => {
        const progress =
          fundraiser.goalAmount > 0
            ? Math.min(
                100,
                Math.round(
                  (fundraiser.amountRaised / fundraiser.goalAmount) * 100,
                ),
              )
            : 0;

        return (
          // Adjust to your actual fundraiser detail route
          <Link key={fundraiser._id} href={`/fundraiser/${fundraiser._id}`}>
            <Card className="h-full overflow-hidden p-0 transition-shadow hover:shadow-md">
              <div className="relative aspect-video bg-muted">
                {fundraiser.coverImageUrl ? (
                  <Image
                    src={fundraiser.coverImageUrl}
                    alt={fundraiser.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10 text-sm text-muted-foreground">
                    No photo
                  </div>
                )}
                <Badge
                  className={`absolute left-2 top-2 border-0 ${
                    STATUS_STYLES[fundraiser.status] ??
                    "bg-muted text-muted-foreground"
                  }`}
                >
                  {STATUS_LABELS[fundraiser.status] ?? fundraiser.status}
                </Badge>
              </div>

              <CardContent className="space-y-3 p-4">
                <div>
                  <h3 className="line-clamp-1 font-semibold">
                    {fundraiser.title}
                  </h3>
                  {fundraiser.location && (
                    <p className="text-sm text-muted-foreground">
                      {fundraiser.location}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      {currencyFormatter.format(fundraiser.amountRaised)}
                    </span>
                    <span className="text-muted-foreground">
                      of {currencyFormatter.format(fundraiser.goalAmount)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {fundraiser.donorCount}{" "}
                  {fundraiser.donorCount === 1 ? "donor" : "donors"}
                </p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}