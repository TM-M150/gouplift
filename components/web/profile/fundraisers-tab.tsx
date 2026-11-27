"use client";

import Link from "next/link";
import Image from "next/image";
import { HandHeart } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Logo from "@/components/icons/logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { IconChip } from "./card-heading";

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

// Live and finished fundraisers wear the brand greens (dark green on the
// bright green, white on the dark green, both above 7:1). The states that
// need attention keep amber, orange and red so they are not missed. A draft is
// white with an outline so it can still be seen on a fundraiser's photo.
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-white text-primary ring-1 ring-primary/20",
  PENDING_REVIEW:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-400",
  ACTIVE: "bg-secondary text-primary",
  PAUSED:
    "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-400",
  COMPLETED: "bg-primary text-primary-foreground",
  CANCELLED: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-400",
  REJECTED: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-400",
  EXPIRED: "bg-mint text-primary",
};

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const PRIMARY_PILL = cn(
  buttonVariants({ variant: "default" }),
  "h-11 rounded-full px-6",
);
const OUTLINE_PILL = cn(
  buttonVariants({ variant: "outline" }),
  "h-11 rounded-full border-primary/25 bg-white px-6 text-primary hover:bg-mint hover:text-primary",
);

export function FundraisersTab() {
  const fundraisers = useQuery(api.fundraiser.listMyFundraisers);

  // undefined while the query is still loading, [] once it resolves with no results
  if (fundraisers === undefined) {
    return (
      <div role="status" aria-busy className="space-y-6">
        <span className="sr-only">Loading your fundraisers…</span>
        <Skeleton className="h-16 w-full max-w-sm rounded-2xl bg-primary/10" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton
              key={index}
              className="h-[300px] rounded-3xl bg-primary/10"
            />
          ))}
        </div>
      </div>
    );
  }

  if (fundraisers.length === 0) {
    return (
      <Card className="items-center gap-5 px-6 py-14 text-center">
        <IconChip
          icon={HandHeart}
          className="size-14 rounded-2xl [&_svg]:size-7"
        />
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            Start your first fundraiser
          </h2>
          <p className="mx-auto max-w-md text-pretty text-base text-primary/70">
            You haven&apos;t created a fundraiser yet. Tell your story, set a
            goal in Kenyan shillings and share the link. It goes live as soon as
            you publish it.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/fundraiser-form" className={PRIMARY_PILL}>
            Start a fundraiser
          </Link>
          <Link href="/how-it-works" className={OUTLINE_PILL}>
            See how it works
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            Your fundraisers
          </h2>
          <p className="mt-1 text-base text-primary/70">
            {fundraisers.length}{" "}
            {fundraisers.length === 1 ? "fundraiser" : "fundraisers"}
          </p>
        </div>
        <Link href="/fundraiser-form" className={PRIMARY_PILL}>
          Start a fundraiser
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
            <Link
              key={fundraiser._id}
              href={`/fundraiser/${fundraiser._id}`}
              className="group block rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Card className="h-full gap-0 p-0 ring-primary/10 transition-shadow group-hover:shadow-lg">
                <div className="relative aspect-video bg-mint">
                  {fundraiser.coverImageUrl ? (
                    <Image
                      src={fundraiser.coverImageUrl}
                      alt={fundraiser.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Logo size={56} />
                    </div>
                  )}
                  {/* A suspended fundraiser says so here, whatever its status,
                      so the organizer isn't left guessing why it stopped. */}
                  <Badge
                    className={cn(
                      "absolute left-3 top-3 h-6 border-0 px-2.5 shadow-sm",
                      fundraiser.suspended
                        ? STATUS_STYLES.REJECTED
                        : (STATUS_STYLES[fundraiser.status] ??
                            "bg-mint text-primary"),
                    )}
                  >
                    {fundraiser.suspended
                      ? "Under review"
                      : (STATUS_LABELS[fundraiser.status] ?? fundraiser.status)}
                  </Badge>
                </div>

                <CardContent className="space-y-4 p-5">
                  <div>
                    <h3 className="line-clamp-1 text-lg font-semibold tracking-tight text-primary">
                      {fundraiser.title}
                    </h3>
                    {fundraiser.location && (
                      <p className="text-sm text-primary/70">
                        {fundraiser.location}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div
                      role="progressbar"
                      aria-label={`Progress toward the goal for ${fundraiser.title}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      className="h-2.5 w-full overflow-hidden rounded-full bg-mint ring-1 ring-primary/10"
                    >
                      <div
                        className="h-full origin-left rounded-full bg-primary motion-safe:animate-grow-x"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-semibold tabular-nums text-primary">
                        {currencyFormatter.format(fundraiser.amountRaised)}
                      </span>
                      <span className="text-primary/70">
                        of {currencyFormatter.format(fundraiser.goalAmount)}
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-primary/70">
                    {fundraiser.donorCount}{" "}
                    {fundraiser.donorCount === 1 ? "donation" : "donations"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
