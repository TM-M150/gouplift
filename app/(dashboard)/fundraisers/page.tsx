import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Browse Fundraisers",
  description: "Explore fundraisers by category.",
};

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function formatType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function FundraisersPage() {
  return (
    <main className="min-h-screen max-w-6xl mx-auto w-full pt-24 px-4 pb-16">
      <div className="pb-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Browse Fundraisers
        </h1>
        <p className="pt-2 text-lg text-muted-foreground">
          Explore fundraisers by category.
        </p>
      </div>

      <Suspense fallback={<GroupedSkeleton />}>
        <FundraiserGroups />
      </Suspense>
    </main>
  );
}

async function FundraiserGroups() {
  const groups = await fetchQuery(api.fundraiser.listFundraisersByType, {});

  if (groups.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No fundraisers yet — check back soon.
      </p>
    );
  }

  return (
    <div className="space-y-12">
      {groups.map((group) => (
        <section key={group.type}>
          <h2 className="mb-4 text-2xl font-semibold">
            {formatType(group.type)}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {group.fundraisers.map((fundraiser) => (
              <FundraiserCard key={fundraiser._id} fundraiser={fundraiser} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface FundraiserCardData {
  _id: string;
  title: string;
  goalAmount: number;
  amountRaised: number;
  donorCount: number;
  location?: string;
  coverImageUrl: string | null;
}

function FundraiserCard({ fundraiser }: { fundraiser: FundraiserCardData }) {
  const progress =
    fundraiser.goalAmount > 0
      ? Math.min(
          100,
          Math.round((fundraiser.amountRaised / fundraiser.goalAmount) * 100),
        )
      : 0;

  return (
    <Link
      href={`/fundraiser/${fundraiser._id}`}
      className="block h-full"
    >
      <Card className="h-full overflow-hidden p-0 transition-shadow hover:shadow-md">
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {fundraiser.coverImageUrl ? (
            <Image
              src={fundraiser.coverImageUrl}
              alt={fundraiser.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10 text-sm text-muted-foreground">
              No photo
            </div>
          )}
        </div>

        <CardContent className="space-y-3 p-5">
          <div>
            <h3 className="line-clamp-1 text-lg font-semibold">
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
}

function GroupedSkeleton() {
  return (
    <div className="space-y-12">
      {[...Array(3)].map((_, groupIndex) => (
        <div key={groupIndex}>
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, cardIndex) => (
              <div className="space-y-3" key={cardIndex}>
                <Skeleton className="aspect-video w-full rounded-xl" />
                <div className="space-y-2 px-1">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-2 w-full rounded-full" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}