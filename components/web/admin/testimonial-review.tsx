"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { formatDateTime } from "@/components/web/admin/utils";

type QueueStatus = "PENDING" | "APPROVED" | "REJECTED";
type Row = FunctionReturnType<typeof api.testimonials.listForReview>[number];

export const TESTIMONIAL_TABS: Array<{
  value: QueueStatus;
  label: string;
  empty: string;
}> = [
  {
    value: "PENDING",
    label: "Pending",
    empty: "No testimonials are waiting for review.",
  },
  { value: "APPROVED", label: "Showing", empty: "Nothing is on the homepage." },
  { value: "REJECTED", label: "Rejected", empty: "No rejected testimonials." },
];

function TestimonialCard({ row, status }: { row: Row; status: QueueStatus }) {
  const approve = useMutation(api.testimonials.approveTestimonial);
  const reject = useMutation(api.testimonials.rejectTestimonial);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  return (
    <article className="space-y-3 rounded-xl border bg-background p-4">
      <blockquote className="text-sm whitespace-pre-line break-words">
        “{row.message}”
      </blockquote>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{row.authorName}</span>
        <span>
          on{" "}
          <Link
            href={`/fundraiser/${row.fundraiserId}`}
            className="underline underline-offset-2"
          >
            {row.fundraiserTitle}
          </Link>
        </span>
        <span>{formatDateTime(row.createdAt)}</span>
      </div>

      {row.blocker && status !== "REJECTED" && (
        <p role="status" className="text-sm text-destructive">
          {status === "APPROVED"
            ? `Not being shown: ${row.blocker}`
            : `Can't be approved: ${row.blocker}`}
        </p>
      )}

      {status === "REJECTED" && row.reviewNote && (
        <p className="text-sm text-muted-foreground">
          Rejected: {row.reviewNote}
        </p>
      )}

      {status !== "REJECTED" && (
        <div className="flex flex-wrap gap-2">
          {status === "PENDING" && (
            <Button
              size="sm"
              disabled={row.blocker !== null}
              onClick={() => setApproveOpen(true)}
            >
              Approve
            </Button>
          )}
          <Button
            size="sm"
            variant={status === "PENDING" ? "outline" : "destructive"}
            onClick={() => setRejectOpen(true)}
          >
            {status === "PENDING" ? "Reject" : "Take down"}
          </Button>
        </div>
      )}

      <DecisionDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Show this on the homepage?"
        description="Anyone can read it, under the author's first name and last initial. The author can withdraw it at any time, and it comes down by itself if their donation is refunded."
        confirmLabel="Approve"
        onConfirm={async () => {
          await approve({ testimonialId: row._id });
          toast.success("The testimonial is now showing.");
        }}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={status === "PENDING" ? "Reject this testimonial?" : "Take it down?"}
        description="The author isn't told your reason. It is kept in the audit log."
        confirmLabel={status === "PENDING" ? "Reject" : "Take down"}
        destructive
        noteLabel="Reason (for the audit log)"
        notePlaceholder="e.g. Contains a phone number"
        minNoteLength={10}
        onConfirm={async (reason) => {
          await reject({ testimonialId: row._id, reason });
          toast.success("Done.");
        }}
      />
    </article>
  );
}

export function TestimonialQueue({
  status,
  empty,
}: {
  status: QueueStatus;
  empty: string;
}) {
  const rows = useQuery(api.testimonials.listForReview, { status });

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <div className="space-y-3">
      {status === "PENDING" && (
        <Badge variant="secondary">
          {rows.length} waiting, oldest first
        </Badge>
      )}
      {rows.map((row) => (
        <TestimonialCard key={row._id} row={row} status={status} />
      ))}
    </div>
  );
}
