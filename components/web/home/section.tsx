import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The homepage is built from bands that alternate between the logo's deep
 * green ("forest"), a light tint of the bright green ("mint") and white, so the
 * brand carries the page instead of grey.
 */
export type SectionTone = "white" | "mint" | "forest";

const TONES: Record<SectionTone, string> = {
  white: "bg-background text-primary",
  mint: "bg-mint text-primary",
  forest: "bg-primary text-primary-foreground",
};

// Two bands of the same tone in a row (which happens when a band in between
// has nothing to show) share one gap instead of doubling it.
const SAME_TONE_NEIGHBOUR: Record<SectionTone, string> = {
  white: "[[data-tone=white]+&]:pt-0",
  mint: "[[data-tone=mint]+&]:pt-0",
  forest: "[[data-tone=forest]+&]:pt-0",
};

/** Body text on each tone. The bright green is never used for text on white. */
export function bodyText(tone: SectionTone) {
  return tone === "forest" ? "text-white/75" : "text-primary/70";
}

export function HomeSection({
  tone = "white",
  labelledBy,
  id,
  className,
  children,
}: {
  tone?: SectionTone;
  /** The id of the section's heading, so the region has a name. */
  labelledBy: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-tone={tone}
      className={cn(
        "py-16 md:py-28",
        TONES[tone],
        SAME_TONE_NEIGHBOUR[tone],
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-6">{children}</div>
    </section>
  );
}

export function SectionHeading({
  id,
  title,
  lead,
  tone = "white",
  className,
}: {
  id: string;
  title: string;
  lead?: string;
  tone?: SectionTone;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <h2
        id={id}
        className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl"
      >
        {title}
      </h2>
      {lead && (
        <p className={cn("mt-5 text-pretty text-lg", bodyText(tone))}>{lead}</p>
      )}
    </div>
  );
}
