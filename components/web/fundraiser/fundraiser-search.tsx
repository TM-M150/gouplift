"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FundraiserCard } from "./fundraiser-card";

export function FundraiserSearch({ children }: { children: React.ReactNode }) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const trimmed = searchTerm.trim();

  const results = useQuery(
    api.fundraiser.searchFundraisers,
    trimmed ? { searchTerm: trimmed } : "skip",
  );

  return (
    <div>
      <Input
        type="search"
        placeholder="Search fundraisers…"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        className="mb-8 max-w-md"
      />

      {trimmed ? (
        results === undefined ? (
          <SearchResultsSkeleton />
        ) : results.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">
            No fundraisers match &quot;{trimmed}&quot;.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((fundraiser) => (
              <FundraiserCard key={fundraiser._id} fundraiser={fundraiser} />
            ))}
          </div>
        )
      ) : (
        children
      )}
    </div>
  );
}

function SearchResultsSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {[...Array(3)].map((_, i) => (
        <div className="space-y-3" key={i}>
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="space-y-2 px-1">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
