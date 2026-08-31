import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import type { Metadata } from "next";
import { FundraiserSearch } from "@/components/web/fundraiser/fundraiser-search";
import { FundraiserCard } from "@/components/web/fundraiser/fundraiser-card";

export const dynamic = "force-static";
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Browse Fundraisers",
  description: "Explore fundraisers by category.",
};

function formatType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function FundraisersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-24 py-12">
      <div className="pb-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Browse Fundraisers
        </h1>
        <p className="pt-2 text-lg text-muted-foreground">
          Explore fundraisers by category, or search by name.
        </p>
      </div>

      <FundraiserSearch>
        <Suspense fallback={<GroupedSkeleton />}>
          <FundraiserGroups />
        </Suspense>
      </FundraiserSearch>
    </div>
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
