"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { MAX_RATING, MIN_RATING } from "@/lib/testimonials";
import { cn } from "@/lib/utils";

const STARS = Array.from(
  { length: MAX_RATING - MIN_RATING + 1 },
  (_, index) => MIN_RATING + index,
);

function starLabel(rating: number): string {
  return `${rating} out of ${MAX_RATING} stars`;
}

/** A rating shown as stars, for reading. */
export function StarRating({
  rating,
  className,
  filledClassName = "fill-amber-400 text-amber-500",
}: {
  rating: number;
  className?: string;
  /** The colours of a filled star. Amber unless a page wants its own. */
  filledClassName?: string;
}) {
  return (
    <span
      role="img"
      aria-label={starLabel(rating)}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {STARS.map((star) => (
        <Star
          key={star}
          aria-hidden
          className={cn(
            "size-4",
            star <= rating ? filledClassName : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

/**
 * A rating to choose, as one group of radio buttons so it works with a
 * keyboard (arrow keys) and a screen reader without anything extra. Nothing is
 * chosen to start with, so a rating is never given by accident.
 */
export function StarRatingInput({
  value,
  onChange,
  legend,
  disabled,
  invalid,
  describedBy,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  legend: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const name = React.useId();
  const [hovered, setHovered] = React.useState<number | null>(null);
  const shown = hovered ?? value ?? 0;

  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend
        className={cn("text-sm font-medium", invalid && "text-destructive")}
      >
        {legend}
      </legend>
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHovered(null)}
      >
        {STARS.map((star) => (
          <label
            key={star}
            onMouseEnter={() => setHovered(star)}
            className={cn(
              "cursor-pointer rounded-md p-1 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              aria-describedby={describedBy}
              className="sr-only"
            />
            <Star
              aria-hidden
              className={cn(
                "size-7",
                star <= shown
                  ? "fill-amber-400 text-amber-500"
                  : "text-muted-foreground/50",
              )}
            />
            <span className="sr-only">{starLabel(star)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
