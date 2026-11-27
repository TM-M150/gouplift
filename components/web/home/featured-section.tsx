import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  CategoryChips,
  type CategoryCount,
} from "@/components/web/home/category-chips";
import { FeaturedFundraisers } from "@/components/web/home/featured-fundraisers";
import { HomeSection, SectionHeading } from "@/components/web/home/section";
import type { FundraiserCardData } from "@/components/web/fundraiser/fundraiser-card";
import { cn } from "@/lib/utils";

/**
 * Real fundraisers people can support now. Renders nothing, heading included,
 * until there is something real to show, so a new platform doesn't open with
 * an empty "find a cause".
 */
export function FeaturedSection({
  fundraisers,
  categories,
}: {
  fundraisers: FundraiserCardData[];
  categories: CategoryCount[];
}) {
  if (fundraisers.length === 0 && categories.length === 0) return null;

  return (
    <HomeSection labelledBy="featured-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading id="featured-title" title="Find a cause to support" />
        <Link
          href="/fundraisers"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 rounded-full border-primary/25 px-6 text-primary hover:bg-mint hover:text-primary",
          )}
        >
          Browse fundraisers
        </Link>
      </div>

      <div className="mt-10 space-y-10">
        <CategoryChips categories={categories} />
        <FeaturedFundraisers fundraisers={fundraisers} />
      </div>
    </HomeSection>
  );
}
