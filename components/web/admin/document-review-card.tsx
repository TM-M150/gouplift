"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import {
  errorMessage,
  formatDate,
  formatSize,
} from "@/components/web/admin/utils";

type ReviewData = NonNullable<
  FunctionReturnType<typeof api.admin.getOrganizationForReview>
>;
type ReviewDocument = ReviewData["documents"][number];

const STATUS_DISPLAY: Record<
  ReviewDocument["reviewStatus"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  PENDING: { label: "Not reviewed", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "default" },
  REJECTED: { label: "Replacement requested", variant: "destructive" },
};

interface DocumentReviewCardProps {
  document: ReviewDocument;
  label: string;
  /** False once the organization has been verified or rejected. */
  canReview: boolean;
}

export function DocumentReviewCard({
  document,
  label,
  canReview,
}: DocumentReviewCardProps) {
  const reviewDocument = useMutation(api.admin.reviewDocument);
  const [busy, setBusy] = React.useState(false);
  const [replacementOpen, setReplacementOpen] = React.useState(false);

  const status = STATUS_DISPLAY[document.reviewStatus];
  const isImage = document.contentType.startsWith("image/");

  async function setDecision(decision: "PENDING" | "APPROVED") {
    setBusy(true);
    try {
      await reviewDocument({ documentId: document._id, decision });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {document.fileName} · {formatSize(document.size)}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {isImage && document.url && (
        // Plain <img>: a short-lived storage URL, not something to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={document.url}
          alt={`${label}: ${document.fileName}`}
          className="max-h-72 w-full rounded-lg border bg-muted/30 object-contain"
        />
      )}
      {!isImage && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <FileText className="size-4 shrink-0" />
          PDF — open it to read the document.
        </div>
      )}

      {document.reviewStatus === "REJECTED" && document.reviewNote && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Note: </span>
          {document.reviewNote}
        </p>
      )}
      {document.reviewedAt && document.reviewedByName && (
        <p className="text-xs text-muted-foreground">
          Reviewed by {document.reviewedByName} on{" "}
          {formatDate(document.reviewedAt)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {document.url ? (
          <a
            href={document.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink data-icon="inline-start" />
            Open file
          </a>
        ) : (
          <span className="text-xs text-destructive">File unavailable</span>
        )}

        {canReview && (
          <>
            {document.reviewStatus !== "APPROVED" && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => setDecision("APPROVED")}
              >
                Approve
              </Button>
            )}
            {document.reviewStatus !== "REJECTED" && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => setReplacementOpen(true)}
              >
                Request replacement
              </Button>
            )}
            {document.reviewStatus !== "PENDING" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setDecision("PENDING")}
              >
                Undo
              </Button>
            )}
          </>
        )}
      </div>

      <DecisionDialog
        open={replacementOpen}
        onOpenChange={setReplacementOpen}
        title={`Request a replacement for ${label}`}
        description="Say what's wrong with this file so it can be replaced. The organization can't be verified until every required document is approved."
        confirmLabel="Request replacement"
        destructive
        noteLabel="What needs to change?"
        notePlaceholder="e.g. The name on this certificate doesn't match the organization name."
        onConfirm={async (note) => {
          await reviewDocument({
            documentId: document._id,
            decision: "REJECTED",
            note,
          });
        }}
      />
    </div>
  );
}
