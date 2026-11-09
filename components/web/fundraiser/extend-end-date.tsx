"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addDays,
  describeTimeLeft,
  endDateStringProblem,
  endOfNairobiDay,
  formatEndDate,
  hasEnded,
  maxEndDateString,
  minEndDateString,
  nairobiDateString,
} from "@/lib/fundraiser-dates";

interface ExtendEndDateProps {
  fundraiserId: Id<"fundraisers">;
  status: Doc<"fundraisers">["status"];
  endDate: number | undefined;
}

// Saved on its own, apart from the edit form below it: moving the end date
// is a separate decision from rewording the story.
export function ExtendEndDate({
  fundraiserId,
  status,
  endDate,
}: ExtendEndDateProps) {
  const extendEndDate = useMutation(api.fundraiser.extendEndDate);

  const [now] = React.useState(() => Date.now());
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Only a running fundraiser has an end date to move.
  if (status !== "ACTIVE") return null;

  if (endDate !== undefined && hasEnded(endDate, now)) {
    return (
      <section className="mb-8 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">End date</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {`This fundraiser ended on ${formatEndDate(endDate)} and is no longer taking donations. An ended fundraiser can't be reopened. Start a new one if you need more time.`}
        </p>
      </section>
    );
  }

  // The new date has to be after the current one, so start the picker a day
  // later. Whatever is already past the furthest allowed day can't be chosen.
  const earliest =
    endDate === undefined
      ? minEndDateString(now)
      : addDays(nairobiDateString(endDate), 1);
  const latest = maxEndDateString(now);
  const atLimit = earliest > latest;

  async function handleSave() {
    setError(null);

    const problem = endDateStringProblem(value, now);
    const newEnd = endOfNairobiDay(value);
    if (problem || newEnd === null) {
      setError(problem ?? "Choose an end date.");
      return;
    }
    if (endDate !== undefined && newEnd <= endDate) {
      setError("Choose a date after the current end date.");
      return;
    }

    setSubmitting(true);
    try {
      await extendEndDate({ fundraiserId, endDate: newEnd });
      toast.success(
        endDate === undefined ? "End date set." : "End date extended.",
        { description: `Donations are open until the end of ${formatEndDate(newEnd)}.` },
      );
      setValue("");
    } catch (caught) {
      const message =
        caught instanceof ConvexError
          ? String(caught.data)
          : caught instanceof Error
            ? caught.message
            : "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-8 space-y-3 rounded-xl border p-5">
      <div>
        <h2 className="text-lg font-semibold">
          {endDate === undefined ? "Set an end date" : "Extend the end date"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {endDate === undefined
            ? "This fundraiser has no end date."
            : `Ends ${formatEndDate(endDate)} (${describeTimeLeft(endDate, now).toLowerCase()}). Donations stop at the end of that day.`}
        </p>
      </div>

      {atLimit ? (
        <p className="text-sm text-muted-foreground">
          That&apos;s already the furthest a fundraiser can run from today.
          Come back later to extend it again.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="newEndDate">
              {endDate === undefined ? "End date" : "New end date"}
            </Label>
            <Input
              id="newEndDate"
              type="date"
              value={value}
              min={earliest}
              max={latest}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleSave}
            disabled={submitting || value === ""}
          >
            {submitting
              ? "Saving..."
              : endDate === undefined
                ? "Set end date"
                : "Extend end date"}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
