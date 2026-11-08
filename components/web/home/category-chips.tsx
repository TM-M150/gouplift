import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { formatFundraiserType, fundraiserTypeAnchor } from "@/lib/fundraiser-type";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 8;

export interface CategoryCount {
  type: string;
  count: number;
}

/**
 * Links into the category sections on /fundraisers. Only categories that
 * currently have an active public fundraiser are passed in, so every chip
 * lands on a section that exists.
 */
export function CategoryChips({ categories }: { categories: CategoryCount[] }) {
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Browse fundraisers by category">
      <ul className="flex flex-wrap gap-2">
        {categories.slice(0, MAX_CHIPS).map((category) => (
          <li key={category.type}>
            <Link
              href={`/fundraisers#${fundraiserTypeAnchor(category.type)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {formatFundraiserType(category.type)}
              <span className="text-muted-foreground">{category.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
