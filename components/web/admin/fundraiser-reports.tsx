"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/components/web/admin/utils";
import {
  FUNDRAISER_REPORT_REASON_LABELS,
  fundraiserIdFromInput,
} from "@/lib/fundraiser-reports";

type ReportedRow = FunctionReturnType<
  typeof api.fundraiserReports.listReported
>[number];
type SuspendedRow = FunctionReturnType<
  typeof api.fundraiserReports.listSuspended
>[number];

/** Money in the currency the fundraiser was raised in. */
export function formatMoney(amount: number, currency: "KES" | "USD"): string {
  return new Intl.NumberFormat(currency === "KES" ? "en-KE" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

/**
 * For a badge that holds a sentence (a report reason): the usual badge never
 * wraps, so the longest reason runs off a phone screen.
 */
export const WRAPPING_BADGE =
  "h-auto min-h-5 max-w-full whitespace-normal text-left";

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function reviewHref(fundraiserId: string): string {
  return `/admin/fundraisers/${fundraiserId}`;
}

/** A box to open any fundraiser by its address or id, reported or not. */
export function FundraiserLookup() {
  const router = useRouter();
  const inputId = React.useId();
  const [value, setValue] = React.useState("");

  function open(event: React.FormEvent) {
    event.preventDefault();
    const id = fundraiserIdFromInput(value);
    if (id) router.push(reviewHref(id));
  }

  return (
    <form onSubmit={open} className="space-y-2" noValidate>
      <Label htmlFor={inputId}>Open a fundraiser</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste its address or id"
          autoComplete="off"
          className="max-w-md"
        />
        <Button type="submit" variant="outline" disabled={!value.trim()}>
          Open
        </Button>
      </div>
    </form>
  );
}

export function ReportedFundraiser({ row }: { row: ReportedRow }) {
  return (
    <article className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-medium break-words">{row.title}</h2>
          <p className="text-sm text-muted-foreground">
            By {row.ownerName} · {formatMoney(row.amountRaised, row.currency)}{" "}
            raised from{" "}
            {row.donorCount === 1
              ? "1 donation"
              : `${row.donorCount} donations`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.suspended && <Badge variant="destructive">Suspended</Badge>}
          <Badge variant="outline">{statusLabel(row.status)}</Badge>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">
          {row.reportCount === 1 ? "1 report" : `${row.reportCount} reports`},
          first {formatDateTime(row.firstReportedAt)}
        </p>
        <ul className="flex flex-wrap gap-2">
          {row.reasons.map(({ reason, count }) => (
            <li key={reason}>
              <Badge variant="secondary" className={WRAPPING_BADGE}>
                {FUNDRAISER_REPORT_REASON_LABELS[reason]}
                {count > 1 && ` ×${count}`}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <Link
        href={reviewHref(row.fundraiserId)}
        className={buttonVariants({ size: "sm" })}
      >
        Review
      </Link>
    </article>
  );
}

/**
 * Fundraisers with reports waiting: the most reported first, and among those
 * the one reported longest ago.
 */
export function ReportedFundraiserQueue() {
  const rows = useQuery(api.fundraiserReports.listReported, {});

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No reported fundraisers are waiting.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Badge variant="secondary">
        {rows.length} waiting, most reported first
      </Badge>
      {rows.map((row) => (
        <ReportedFundraiser key={row.fundraiserId} row={row} />
      ))}
    </div>
  );
}

export function SuspendedFundraiser({ row }: { row: SuspendedRow }) {
  return (
    <article className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-medium break-words">{row.title}</h2>
          <p className="text-sm text-muted-foreground">
            By {row.ownerName} · {formatMoney(row.amountRaised, row.currency)}{" "}
            raised
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.payoutsOnHold ? (
            <Badge variant="secondary">Payouts on hold</Badge>
          ) : (
            <Badge variant="destructive">Payouts not on hold</Badge>
          )}
          <Badge variant="outline">{statusLabel(row.status)}</Badge>
        </div>
      </div>

      <div className="space-y-1 text-sm">
        <p className="text-xs text-muted-foreground">Told to the organizer</p>
        <p className="break-words whitespace-pre-line">{row.reason}</p>
        <p className="text-xs text-muted-foreground">
          Suspended by {row.placedByName}, {formatDateTime(row.placedAt)}
        </p>
      </div>

      <Link
        href={reviewHref(row.fundraiserId)}
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        Open
      </Link>
    </article>
  );
}

/** Fundraisers that are suspended now, the one suspended longest first. */
export function SuspendedFundraiserList() {
  const rows = useQuery(api.fundraiserReports.listSuspended, {});

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No fundraisers are suspended.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Badge variant="secondary">{rows.length} suspended, longest first</Badge>
      {rows.map((row) => (
        <SuspendedFundraiser key={row.fundraiserId} row={row} />
      ))}
    </div>
  );
}
