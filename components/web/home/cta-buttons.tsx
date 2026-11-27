import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { StartFundraiserLink } from "@/components/web/home/start-fundraiser-link";
import { cn } from "@/lib/utils";

const BASE = "h-12 rounded-full px-7 text-base font-semibold";

/**
 * The two calls to action on a forest band: the bright green fill for the main
 * one (dark green text, 7.2:1) and an outline for browsing.
 */
export function CtaButtons({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row", className)}>
      <StartFundraiserLink
        className={cn(
          BASE,
          "bg-secondary text-primary hover:bg-secondary/90 focus-visible:border-white focus-visible:ring-white/60",
        )}
      />
      <Link
        href="/fundraisers"
        className={cn(
          buttonVariants({ variant: "outline" }),
          BASE,
          "border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white focus-visible:border-white focus-visible:ring-white/60",
        )}
      >
        Browse fundraisers
      </Link>
    </div>
  );
}
