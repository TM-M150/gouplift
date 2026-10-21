import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OrganizationSearch } from "@/components/web/organization/organization-search";
import {
  OrganizationCard,
  OrganizationCardSkeleton,
} from "@/components/web/organization/organization-card";

export const dynamic = "force-static";
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Browse Organizations",
  description: "Discover organizations raising funds on GoUplift.",
};

export default function OrganizationsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-24 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Organizations</h1>
          <p className="pt-2 text-lg text-muted-foreground">
            Find the groups and nonprofits behind the fundraisers.
          </p>
        </div>
        <Link
          href="/organizations/new"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Create an organization
        </Link>
      </div>

      <OrganizationSearch>
        <Suspense fallback={<ListSkeleton />}>
          <OrganizationList />
        </Suspense>
      </OrganizationSearch>
    </div>
  );
}

async function OrganizationList() {
  const organizations = await fetchQuery(
    api.organizations.listOrganizations,
    {},
  );

  if (organizations.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No organizations yet — check back soon.
      </p>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {organizations.map((organization) => (
        <OrganizationCard key={organization._id} organization={organization} />
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <OrganizationCardSkeleton key={i} />
      ))}
    </div>
  );
}
