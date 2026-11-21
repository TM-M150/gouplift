"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Flag } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/web/admin/utils";
import {
  checkReportDetails,
  FUNDRAISER_REPORT_REASON_LABELS,
  FUNDRAISER_REPORT_REASONS,
  MAX_REPORT_DETAILS_LENGTH,
  type FundraiserReportReason,
} from "@/lib/fundraiser-reports";
import { signInHref } from "@/lib/safe-redirect";

/**
 * Who is looking. "loading" also covers a signed-in person whose account can't
 * be found, so nothing is drawn rather than a button that can't work.
 */
export type ReportViewer =
  "loading" | "signedOut" | "signedIn" | "owner" | "staff";

function ReportDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    reason: FundraiserReportReason,
    details: string | undefined,
  ) => Promise<void>;
}) {
  const detailsId = React.useId();
  const [reason, setReason] = React.useState<FundraiserReportReason | null>(
    null,
  );
  const [details, setDetails] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tooLong = details.length > MAX_REPORT_DETAILS_LENGTH;

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) {
      setReason(null);
      setDetails("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      setError("Choose what's wrong with it.");
      return;
    }
    const checked = checkReportDetails(reason, details);
    if (!checked.ok) {
      setError(checked.problem);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(reason, checked.details);
      setReason(null);
      setDetails("");
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report this fundraiser</DialogTitle>
          <DialogDescription>
            GoUplift staff will take a look. The organizer isn&apos;t told who
            reported it, and nothing happens to a fundraiser just because it was
            reported.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <RadioGroup
            value={reason ?? ""}
            onValueChange={(value) => {
              setReason(value as FundraiserReportReason);
              // The message was about the choice as it was.
              if (error) setError(null);
            }}
            aria-label="What's wrong with this fundraiser?"
            disabled={submitting}
          >
            {FUNDRAISER_REPORT_REASONS.map((value) => (
              <Label
                key={value}
                className="flex items-center gap-3 rounded-lg border p-3 font-normal"
              >
                <RadioGroupItem value={value} />
                {FUNDRAISER_REPORT_REASON_LABELS[value]}
              </Label>
            ))}
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor={detailsId}>
              {reason === "OTHER"
                ? "What is wrong?"
                : "Anything else we should know? (optional)"}
            </Label>
            <Textarea
              id={detailsId}
              value={details}
              onChange={(event) => {
                setDetails(event.target.value);
                if (error) setError(null);
              }}
              placeholder="For example: the number in the story isn't the one on the organizer's page."
              className="min-h-24"
              maxLength={MAX_REPORT_DETAILS_LENGTH + 200}
              disabled={submitting}
              aria-invalid={tooLong ? true : undefined}
            />
            <p
              className={
                tooLong
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {details.length.toLocaleString("en-US")} /{" "}
              {MAX_REPORT_DETAILS_LENGTH.toLocaleString("en-US")}
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Working…" : "Send report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ReportFundraiserViewProps {
  viewer: ReportViewer;
  fundraiserId: string;
  /** Where signing in leads back to this page. */
  signInLink: string;
  onReport: (
    reason: FundraiserReportReason,
    details: string | undefined,
  ) => Promise<void>;
}

const LINK_CLASS =
  "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/**
 * The small "Report" control under the donate card. It only draws what it is
 * given, so it can be previewed without a backend.
 */
export function ReportFundraiserView({
  viewer,
  fundraiserId,
  signInLink,
  onReport,
}: ReportFundraiserViewProps) {
  const [open, setOpen] = React.useState(false);
  const [reported, setReported] = React.useState(false);

  // The organizer has nothing to report, and nothing is drawn until we know
  // who is looking.
  if (viewer === "loading" || viewer === "owner") return null;

  if (viewer === "staff") {
    return (
      <Link href={`/admin/fundraisers/${fundraiserId}`} className={LINK_CLASS}>
        <Flag className="size-4" aria-hidden />
        Review in admin
      </Link>
    );
  }

  if (viewer === "signedOut") {
    return (
      <Link href={signInLink} className={LINK_CLASS}>
        <Flag className="size-4" aria-hidden />
        Sign in to report this fundraiser
      </Link>
    );
  }

  if (reported) {
    // The same words whether or not this was the first report, so nobody can
    // tell from here what staff already have.
    return (
      <p
        role="status"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Check className="size-4" aria-hidden />
        Thanks. We&apos;ll take a look.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={LINK_CLASS}
      >
        <Flag className="size-4" aria-hidden />
        Report this fundraiser
      </button>

      <ReportDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={async (reason, details) => {
          await onReport(reason, details);
          setReported(true);
        }}
      />
    </>
  );
}

/** The control on the fundraiser page, wired to the backend. */
export function ReportFundraiser({
  fundraiserId,
  creatorId,
}: {
  fundraiserId: Id<"fundraisers">;
  creatorId: Id<"users">;
}) {
  const pathname = usePathname();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
  const report = useMutation(api.fundraiserReports.report);

  let viewer: ReportViewer;
  if (isLoading) viewer = "loading";
  else if (!isAuthenticated) viewer = "signedOut";
  else if (!me) viewer = "loading";
  else if (me.role === "ADMIN" || me.role === "MODERATOR") viewer = "staff";
  else if (me._id === creatorId) viewer = "owner";
  else viewer = "signedIn";

  return (
    <ReportFundraiserView
      viewer={viewer}
      fundraiserId={fundraiserId}
      signInLink={signInHref(pathname)}
      onReport={async (reason, details) => {
        await report({ fundraiserId, reason, details });
      }}
    />
  );
}
