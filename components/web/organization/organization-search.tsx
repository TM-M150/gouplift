"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import {
  OrganizationCard,
  OrganizationCardSkeleton,
} from "./organization-card";

export function OrganizationSearch({
  children,
}: {
  children: React.ReactNode;
}) {
  const [searchTerm, setSearchTerm] = React.useState("");
  const trimmed = searchTerm.trim();

  const results = useQuery(
    api.organizations.searchOrganizations,
    trimmed ? { searchTerm: trimmed } : "skip",
  );

  return (
    <div>
      <Input
        type="search"
        placeholder="Search organizations…"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        className="mb-8 max-w-md"
      />

      {trimmed ? (
        results === undefined ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <OrganizationCardSkeleton key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">
            No organizations match &quot;{trimmed}&quot;.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((organization) => (
              <OrganizationCard
                key={organization._id}
                organization={organization}
              />
            ))}
          </div>
        )
      ) : (
        children
      )}
    </div>
  );
}
