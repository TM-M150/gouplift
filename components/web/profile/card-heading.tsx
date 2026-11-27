import type { LucideIcon } from "lucide-react";

import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Text fields on the profile page: pale green instead of grey. */
export const FIELD_CLASS = "border-primary/10 bg-mint";

/**
 * The round-cornered icon the profile page puts beside a heading: the logo's
 * deep green with the bright green on top (7.2:1), the same chip the homepage
 * uses.
 */
export function IconChip({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-secondary",
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** The top of a card on the profile page: an icon, a title and a line under it. */
export function CardHeading({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <CardHeader className="gap-0">
      <div className="flex items-start gap-4">
        <IconChip icon={icon} />
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight text-primary">
            {title}
          </CardTitle>
          <CardDescription className="text-primary/70">
            {description}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  );
}
