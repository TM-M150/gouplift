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
import { REPORT_REASON_LABELS } from "@/lib/comments";

type Row = FunctionReturnType<
  typeof api.fundraiserComments.listReported
>[number];

function ReportedComment({ row }: { row: Row }) {
  const hide = useMutation(api.fundraiserComments.hideComment);
  const dismiss = useMutation(api.fundraiserComments.dismissReports);
  const [hideOpen, setHideOpen] = React.useState(false);
  const [dismissOpen, setDismissOpen] = React.useState(false);

  return (
    <article className="space-y-3 rounded-xl border bg-background p-4">
      <blockquote className="text-sm break-words whitespace-pre-line">
        “{row.body}”
      </blockquote>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{row.authorName}</span>
        <span>
          on{" "}
          <Link
            href={`/fundraiser/${row.fundraiserId}#comments`}
            className="underline underline-offset-2"
          >
            {row.fundraiserTitle}
          </Link>
        </span>
        <span>posted {formatDateTime(row.createdAt)}</span>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">
          {row.reportCount === 1 ? "1 report" : `${row.reportCount} reports`},
          first {formatDateTime(row.firstReportedAt)}
        </p>
        <ul className="flex flex-wrap gap-2">
          {row.reasons.map(({ reason, count }) => (
            <li key={reason}>
              <Badge variant="secondary">
                {REPORT_REASON_LABELS[reason]}
                {count > 1 && ` ×${count}`}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setHideOpen(true)}
        >
          Hide comment
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDismissOpen(true)}
        >
          Keep it up
        </Button>
      </div>

      <DecisionDialog
        open={hideOpen}
        onOpenChange={setHideOpen}
        title="Hide this comment?"
        description="It comes off the page, and the reports on it are closed. The person who wrote it and the fundraiser's organizer can still see it, but not your reason. It goes in the audit log."
        confirmLabel="Hide"
        destructive
        noteLabel="Reason (for the audit log)"
        notePlaceholder="e.g. Asks donors to send money to a phone number"
        minNoteLength={10}
        onConfirm={async (reason) => {
          await hide({ commentId: row.commentId, reason });
          toast.success("Comment hidden.");
        }}
      />

      <DecisionDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title="Keep this comment up?"
        description="The reports on it are closed and the comment stays. If someone reports it again, it comes back to this list."
        confirmLabel="Keep it up"
        onConfirm={async () => {
          await dismiss({ commentId: row.commentId });
          toast.success("Done.");
        }}
      />
    </article>
  );
}

/** Reported comments that are still up, the one reported longest ago first. */
export function ReportedCommentQueue() {
  const rows = useQuery(api.fundraiserComments.listReported, {});

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
        No reported comments are waiting.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Badge variant="secondary">{rows.length} waiting, oldest first</Badge>
      {rows.map((row) => (
        <ReportedComment key={row.commentId} row={row} />
      ))}
    </div>
  );
}
