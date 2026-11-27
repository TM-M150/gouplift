"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquareQuote } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { errorMessage, formatDate } from "@/components/web/admin/utils";
import {
  StarRating,
  StarRatingInput,
} from "@/components/web/testimonials/star-rating";
import {
  checkTestimonial,
  MAX_RECOMMENDATION_LENGTH,
  MAX_TESTIMONIAL_LENGTH,
  MIN_TESTIMONIAL_LENGTH,
  type TestimonialField,
} from "@/lib/testimonials";
import { cn } from "@/lib/utils";
import { FIELD_CLASS, IconChip } from "./card-heading";

// The section sits in a white card on the profile's light green page.
const SECTION_CARD =
  "mt-5 w-full rounded-3xl bg-card p-6 shadow-sm ring-1 ring-primary/10 sm:p-8";

export type MyTestimonialRow = FunctionReturnType<
  typeof api.testimonials.listMine
>[number];
type TestimonialId = MyTestimonialRow["_id"];

export interface MyTestimonialActions {
  save: (input: {
    rating: number;
    message: string;
    recommendation: string;
  }) => Promise<unknown>;
  withdraw: (testimonialId: TestimonialId) => Promise<unknown>;
}

type Status = MyTestimonialRow["status"];

/** What the person is told about where their testimonial stands. */
function describeStatus(row: MyTestimonialRow): {
  label: string;
  variant: "secondary" | "default" | "outline";
  detail: string | null;
  needsVerification?: boolean;
} {
  const byStatus: Record<Status, ReturnType<typeof describeStatus>> = {
    PENDING: {
      label: "Waiting for review",
      variant: "secondary",
      detail: "Our team reads every testimonial before it can be shown.",
    },
    APPROVED: {
      label: "Showing on the homepage",
      variant: "default",
      detail: null,
    },
    REJECTED: {
      label: "Not published",
      variant: "outline",
      detail:
        "Our team didn't publish this one. You can change it and send it in again.",
    },
    WITHDRAWN: {
      label: "Withdrawn",
      variant: "outline",
      detail: "It isn't shown anywhere. You can send it in again any time.",
    },
  };
  if (row.status === "APPROVED" && row.awaitingVerification) {
    return {
      label: "Approved, waiting for verification",
      variant: "secondary",
      detail:
        "Our team approved it. It will show on the homepage once your identity has been verified.",
      needsVerification: true,
    };
  }
  return byStatus[row.status];
}

function TestimonialForm({
  row,
  onSave,
}: {
  row: MyTestimonialRow | null;
  onSave: MyTestimonialActions["save"];
}) {
  const ids = React.useId();
  const ratingErrorId = `${ids}-rating-error`;
  const messageId = `${ids}-message`;
  const recommendationId = `${ids}-recommendation`;

  const [rating, setRating] = React.useState<number | null>(
    row?.rating ?? null,
  );
  const [message, setMessage] = React.useState(row?.message ?? "");
  const [recommendation, setRecommendation] = React.useState(
    row?.recommendation ?? "",
  );
  const [errors, setErrors] = React.useState<
    Partial<Record<TestimonialField | "form", string>>
  >({});
  const [submitting, setSubmitting] = React.useState(false);

  // What would be saved, tidied the way the server tidies it, to see whether it
  // differs from what is saved.
  const current = checkTestimonial({
    rating: rating ?? Number.NaN,
    message,
    recommendation,
  });
  const wordsChanged =
    row === null ||
    !current.ok ||
    current.value.rating !== row.rating ||
    current.value.message !== row.message;
  const suggestionChanged =
    row !== null &&
    (!current.ok ||
      current.value.recommendation !== (row.recommendation ?? null));
  const returning = row?.status === "WITHDRAWN";
  const nothingToSave =
    row !== null && !wordsChanged && !suggestionChanged && !returning;
  // Saving puts it in front of our team again, unless only the suggestion moved.
  const sendsForReview = row === null || wordsChanged || returning;
  // The button says so when saving puts something that was withdrawn, approved
  // or turned down back in front of our team.
  const sendsAgain =
    row !== null &&
    row.status !== "PENDING" &&
    (sendsForReview || (row.status === "REJECTED" && nothingToSave));

  function clear(field: TestimonialField) {
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
      form: undefined,
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (rating === null) {
      setErrors({ rating: "Choose a star rating from 1 to 5." });
      return;
    }
    const checked = checkTestimonial({ rating, message, recommendation });
    if (!checked.ok) {
      setErrors({ [checked.field]: checked.problem });
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await onSave({ rating, message, recommendation });
      toast.success(
        sendsForReview
          ? "Thank you. Your testimonial is with our team for review."
          : "Your suggestion was saved.",
      );
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const messageLength = message.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-1">
        <StarRatingInput
          legend="Your rating"
          value={rating}
          onChange={(next) => {
            setRating(next);
            clear("rating");
          }}
          disabled={submitting}
          invalid={Boolean(errors.rating)}
          describedBy={errors.rating ? ratingErrorId : undefined}
        />
        {errors.rating && (
          <p
            id={ratingErrorId}
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.rating}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={messageId}>Your testimonial</Label>
        <Textarea
          id={messageId}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            clear("message");
          }}
          placeholder="What has GoUplift been like for you?"
          className={cn(FIELD_CLASS, "min-h-28")}
          maxLength={MAX_TESTIMONIAL_LENGTH + 100}
          disabled={submitting}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? `${messageId}-error` : undefined}
        />
        <p
          className={cn(
            "text-xs",
            messageLength > MAX_TESTIMONIAL_LENGTH
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {`${messageLength} / ${MAX_TESTIMONIAL_LENGTH} (at least ${MIN_TESTIMONIAL_LENGTH})`}
        </p>
        {errors.message && (
          <p
            id={`${messageId}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={recommendationId}>
          Suggestions for the GoUplift team (optional)
        </Label>
        <Textarea
          id={recommendationId}
          value={recommendation}
          onChange={(event) => {
            setRecommendation(event.target.value);
            clear("recommendation");
          }}
          placeholder="Something we should do better, or add."
          className={cn(FIELD_CLASS, "min-h-24")}
          maxLength={MAX_RECOMMENDATION_LENGTH + 100}
          disabled={submitting}
          aria-invalid={errors.recommendation ? true : undefined}
          aria-describedby={`${recommendationId}-help${
            errors.recommendation ? ` ${recommendationId}-error` : ""
          }`}
        />
        <p
          id={`${recommendationId}-help`}
          className="text-xs text-muted-foreground"
        >
          Only our team can see this. It is never shown on the website.
        </p>
        {errors.recommendation && (
          <p
            id={`${recommendationId}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.recommendation}
          </p>
        )}
      </div>

      {row?.status === "APPROVED" && wordsChanged && (
        <p role="status" className="text-sm text-muted-foreground">
          Changing your rating or your words sends it back to our team and takes
          it off the homepage until they approve it again.
        </p>
      )}

      {errors.form && (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={submitting || nothingToSave}>
          {submitting
            ? "Working…"
            : row === null
              ? "Send for review"
              : sendsAgain
                ? "Send for review again"
                : "Save changes"}
        </Button>
        {row?.status === "REJECTED" && nothingToSave && (
          <p className="text-sm text-muted-foreground">
            Change something to send it in again.
          </p>
        )}
      </div>
    </form>
  );
}

function OlderTestimonial({
  row,
  onWithdraw,
}: {
  row: MyTestimonialRow;
  onWithdraw: MyTestimonialActions["withdraw"];
}) {
  const [open, setOpen] = React.useState(false);
  const status = describeStatus(row);
  const canWithdraw = row.status === "PENDING" || row.status === "APPROVED";

  return (
    <li className="space-y-2 rounded-2xl border border-primary/15 p-4">
      <p className="text-sm whitespace-pre-line break-words">“{row.message}”</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span>
            {row.fundraiserTitle} · {formatDate(row.createdAt)}
          </span>
        </div>
        {canWithdraw && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Withdraw
          </Button>
        )}
      </div>

      <DecisionDialog
        open={open}
        onOpenChange={setOpen}
        title="Withdraw this message?"
        description="It comes off the homepage straight away and won't be shown again. Your donation isn't affected."
        confirmLabel="Withdraw"
        destructive
        onConfirm={async () => {
          await onWithdraw(row._id);
          toast.success("Your message was withdrawn.");
        }}
      />
    </li>
  );
}

export interface MyTestimonialViewProps {
  /** Undefined while loading. */
  rows: MyTestimonialRow[] | undefined;
  actions: MyTestimonialActions;
}

/** The section and its form, apart from Convex. */
export function MyTestimonialView({ rows, actions }: MyTestimonialViewProps) {
  const [withdrawOpen, setWithdrawOpen] = React.useState(false);

  if (rows === undefined) {
    return (
      <section className={cn(SECTION_CARD, "space-y-3")}>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
      </section>
    );
  }

  const mine = rows.find((row) => row.source === "PROFILE") ?? null;
  const older = rows.filter((row) => row.source === "DONATION");
  const status = mine ? describeStatus(mine) : null;
  const canWithdraw = mine?.status === "PENDING" || mine?.status === "APPROVED";

  return (
    <section
      aria-labelledby="my-testimonial"
      className={cn(SECTION_CARD, "space-y-5")}
    >
      <div className="flex items-start gap-4">
        <IconChip icon={MessageSquareQuote} />
        <div className="min-w-0 space-y-1">
          <h2
            id="my-testimonial"
            className="text-lg font-semibold tracking-tight text-primary"
          >
            Your testimonial
          </h2>
          <p className="text-sm text-primary/70">
            Tell us what GoUplift has been like for you. Our team reads every
            testimonial before it can appear on our homepage, under your first
            name and the initial of your last name. It is only shown for
            accounts with approved identity verification, such as people
            approved to receive payouts. Everyone&apos;s suggestions help us,
            whether it is shown or not.
          </p>
        </div>
      </div>

      {mine && status && (
        <div className="space-y-2 rounded-2xl border border-primary/15 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.variant}>{status.label}</Badge>
              <span className="text-xs text-muted-foreground">
                {mine.editedAt
                  ? `Changed ${formatDate(mine.editedAt)}`
                  : `Sent ${formatDate(mine.createdAt)}`}
              </span>
            </div>
            {canWithdraw && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWithdrawOpen(true)}
              >
                Withdraw
              </Button>
            )}
          </div>
          {mine.rating !== null && <StarRating rating={mine.rating} />}
          {status.detail && (
            <p className="text-sm text-muted-foreground">{status.detail}</p>
          )}
          {status.needsVerification && (
            <Link
              href="/verification"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Verify your identity
            </Link>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-primary/15 p-4 sm:p-5">
        <TestimonialForm row={mine} onSave={actions.save} />
      </div>

      {older.length > 0 && (
        <div className="space-y-3 pt-2">
          <h3 className="text-base font-semibold text-primary">
            Messages you offered when you donated
          </h3>
          <ul className="space-y-3">
            {older.map((row) => (
              <OlderTestimonial
                key={row._id}
                row={row}
                onWithdraw={actions.withdraw}
              />
            ))}
          </ul>
        </div>
      )}

      {mine && (
        <DecisionDialog
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          title="Withdraw your testimonial?"
          description="It comes off the homepage straight away. You can send it in again later."
          confirmLabel="Withdraw"
          destructive
          onConfirm={async () => {
            await actions.withdraw(mine._id);
            toast.success("Your testimonial was withdrawn.");
          }}
        />
      )}
    </section>
  );
}

/** The signed-in person's testimonial, wired to Convex. */
export function MyTestimonials() {
  const rows = useQuery(api.testimonials.listMine);
  const save = useMutation(api.testimonials.saveMine);
  const withdraw = useMutation(api.testimonials.withdrawTestimonial);

  const actions = React.useMemo<MyTestimonialActions>(
    () => ({
      save: ({ rating, message, recommendation }) =>
        save({ rating, message, recommendation }),
      withdraw: (testimonialId) => withdraw({ testimonialId }),
    }),
    [save, withdraw],
  );

  return <MyTestimonialView rows={rows} actions={actions} />;
}
