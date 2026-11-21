"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import {
  formatMoney,
  statusLabel,
  WRAPPING_BADGE,
} from "@/components/web/admin/fundraiser-reports";
import {
  errorMessage,
  formatDate,
  formatDateTime,
} from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/payouts/format";
import { FUNDRAISER_REPORT_REASON_LABELS } from "@/lib/fundraiser-reports";

export type FundraiserReviewData = NonNullable<
  FunctionReturnType<typeof api.fundraiserReports.getForStaff>
>;

/** The same floor the server applies to every reason staff write. */
const MIN_NOTE_LENGTH = 10;

/** Everything staff can do here. The real ones call Convex. */
export interface FundraiserReviewActions {
  suspend: (reason: string, holdPayouts: boolean) => Promise<void>;
  reinstate: (note: string) => Promise<void>;
  dismissReports: (note: string) => Promise<void>;
  holdPayouts: (reason: string) => Promise<void>;
  /** Admins only. */
  releaseHold: (note: string) => Promise<void>;
}

const ACTION_LABELS: Record<string, string> = {
  FUNDRAISER_SUSPENDED: "suspended it",
  FUNDRAISER_REINSTATED: "reinstated it",
  FUNDRAISER_REPORTS_DISMISSED: "closed the reports without suspending it",
  PAYOUT_HOLD_PLACED: "put payouts on hold",
  PAYOUT_HOLD_RELEASED: "released the payout hold",
};

/** MEDICAL_EMERGENCY becomes "Medical Emergency", as on the public page. */
function formatType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.toLowerCase().replaceAll("_", " ");
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}

function Alert({
  children,
  tone = "warning",
}: {
  children: React.ReactNode;
  tone?: "warning" | "info";
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={
        tone === "warning"
          ? "space-y-2 rounded-xl border border-destructive/50 p-4 text-sm"
          : "space-y-2 rounded-xl border bg-muted/40 p-4 text-sm"
      }
    >
      {children}
    </div>
  );
}

/**
 * Asks for the reason the organizer will read, and whether to stop payouts at
 * the same time. DecisionDialog only takes a note, so this one is its own.
 */
function SuspendDialog({
  open,
  onOpenChange,
  title,
  alreadyOnHold,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  alreadyOnHold: boolean;
  onConfirm: (reason: string, holdPayouts: boolean) => Promise<void>;
}) {
  const reasonId = React.useId();
  const holdId = React.useId();
  const [reason, setReason] = React.useState("");
  const [hold, setHold] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) {
      setReason("");
      setHold(true);
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_NOTE_LENGTH) {
      setError(`Write at least ${MIN_NOTE_LENGTH} characters.`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(trimmed, hold && !alreadyOnHold);
      setReason("");
      setHold(true);
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            It comes off the public site and stops taking donations straight
            away. The open reports on it are closed. The organizer can still see
            it, and they will read your reason. Say only what they need to know.
            Never mention who reported it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={reasonId}>Reason for the organizer</Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. The story asks donors to send money to a phone number. Please remove it and contact us."
            className="min-h-28"
            disabled={submitting}
          />
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id={holdId}
            checked={hold && !alreadyOnHold}
            onCheckedChange={(checked) => setHold(checked === true)}
            disabled={submitting || alreadyOnHold}
            className="mt-0.5"
          />
          <Label htmlFor={holdId} className="font-normal leading-snug">
            {alreadyOnHold
              ? "Payouts are already on hold."
              : "Also hold payouts, so they can't withdraw while we look into it."}
          </Label>
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
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? "Working…" : "Suspend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FundraiserReviewViewProps {
  data: FundraiserReviewData;
  /** Only an admin can lift a payout hold. */
  isAdmin: boolean;
  actions: FundraiserReviewActions;
}

/** The whole screen. It only draws what it is given, so it can be previewed. */
export function FundraiserReviewView({
  data,
  isAdmin,
  actions,
}: FundraiserReviewViewProps) {
  const [suspendOpen, setSuspendOpen] = React.useState(false);
  const [reinstateOpen, setReinstateOpen] = React.useState(false);
  const [dismissOpen, setDismissOpen] = React.useState(false);
  const [holdOpen, setHoldOpen] = React.useState(false);
  const [releaseOpen, setReleaseOpen] = React.useState(false);

  const { fundraiser, owner, money, payoutHold, reports, history } = data;
  const openReports = reports.filter((report) => report.status === "OPEN");
  const earlierReports = reports.filter((report) => report.status !== "OPEN");
  const activeSuspension = data.suspensions.find(
    (suspension) => suspension.status === "ACTIVE",
  );
  const canStillWithdraw =
    fundraiser.suspended && payoutHold === null && money.available > 0;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href="/admin/fundraisers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to fundraisers
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-words">
            {fundraiser.title}
          </h1>
          {fundraiser.suspended && (
            <Badge variant="destructive">Suspended</Badge>
          )}
          <Badge variant="outline">{statusLabel(fundraiser.status)}</Badge>
          {fundraiser.isPrivate && <Badge variant="outline">Private</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Started {formatDate(fundraiser.createdAt)}.{" "}
          <Link
            href={`/fundraiser/${fundraiser._id}`}
            className="underline underline-offset-4"
          >
            Open its public page
          </Link>
          {fundraiser.suspended
            ? ", which shows only an “under review” notice while it is suspended."
            : "."}
        </p>
      </div>

      {fundraiser.suspended && (
        <Alert tone="info">
          <p className="font-medium">It is suspended</p>
          <p>
            The public sees only an “under review” notice, and it takes no
            donations.
            {activeSuspension
              ? ` Suspended by ${activeSuspension.placedByName}, ${formatDateTime(activeSuspension.placedAt)}.`
              : ""}
          </p>
          {activeSuspension && (
            <p className="break-words whitespace-pre-line text-muted-foreground">
              The organizer was told: {activeSuspension.reason}
            </p>
          )}
        </Alert>
      )}

      {payoutHold && (
        <Alert tone="info">
          <p className="font-medium">Payouts are on hold</p>
          <p className="break-words whitespace-pre-line text-muted-foreground">
            {payoutHold.reason}
          </p>
          <p className="text-xs text-muted-foreground">
            By {payoutHold.placedByName}, {formatDateTime(payoutHold.placedAt)}
          </p>
        </Alert>
      )}

      {canStillWithdraw && (
        <Alert>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            Payouts aren&apos;t on hold
          </p>
          <p>
            It is suspended, but the organizer can still ask to withdraw the{" "}
            {formatKes(money.available)} that is ready. Hold payouts below to
            stop that.
          </p>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The fundraiser</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fundraiser.coverImageUrl && (
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                <Image
                  src={fundraiser.coverImageUrl}
                  alt={fundraiser.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
            )}
            <dl className="space-y-3">
              <Detail label="Type" value={formatType(fundraiser.type)} />
              <Detail
                label="Raised"
                value={`${formatMoney(fundraiser.amountRaised, fundraiser.currency)} of ${formatMoney(fundraiser.goalAmount, fundraiser.currency)}, from ${fundraiser.donorCount === 1 ? "1 donation" : `${fundraiser.donorCount} donations`}`}
              />
              <Detail
                label="Payouts (KES, after fees)"
                value={`${formatKes(money.paidOut)} paid out · ${formatKes(money.available)} ready · ${formatKes(money.pending)} on its way`}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Who is behind it</CardTitle>
            <CardDescription>
              Check whether the story fits the person.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {owner ? (
              <dl className="space-y-3">
                <Detail label="Name" value={owner.name} />
                <Detail label="Email" value={owner.email} />
                <Detail label="Phone" value={owner.phoneNumber} />
                <Detail label="Joined" value={formatDate(owner.joinedAt)} />
                <Detail
                  label="Verification level"
                  value={
                    owner.kycTier > 0
                      ? `Level ${owner.kycTier}`
                      : "Not verified"
                  }
                />
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">
                    Their other fundraisers
                  </dt>
                  <dd>
                    {owner.otherFundraisers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">None.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {owner.otherFundraisers.map((other) => (
                          <li
                            key={other._id}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <Link
                              href={`/admin/fundraisers/${other._id}`}
                              className="underline underline-offset-4 break-words"
                            >
                              {other.title}
                            </Link>
                            {other.suspended && (
                              <Badge variant="destructive">Suspended</Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {statusLabel(other.status)} ·{" "}
                              {formatMoney(other.amountRaised, other.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                The account behind it can no longer be found.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What it says</CardTitle>
          <CardDescription>
            Plain text, so nothing in it can be clicked. Don&apos;t open links
            or call numbers from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fundraiser.tagline && (
            <p className="font-medium break-words">{fundraiser.tagline}</p>
          )}
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {fundraiser.story}
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {openReports.length === 0
            ? "No reports waiting"
            : openReports.length === 1
              ? "1 report waiting"
              : `${openReports.length} reports waiting`}
        </h2>
        {openReports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has an open report on it.
          </p>
        ) : (
          <ul className="space-y-3">
            {openReports.map((report) => (
              <li
                key={report._id}
                className="space-y-2 rounded-xl border bg-background p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className={WRAPPING_BADGE}>
                    {FUNDRAISER_REPORT_REASON_LABELS[report.reason]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(report.createdAt)}
                  </span>
                </div>
                {report.details && (
                  <p className="break-words whitespace-pre-line">
                    {report.details}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  From {report.reporterName} ({report.reporterEmail})
                </p>
              </li>
            ))}
          </ul>
        )}

        {earlierReports.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3 className="text-sm font-medium">Earlier reports</h3>
            <ul className="space-y-2">
              {earlierReports.map((report) => (
                <li
                  key={report._id}
                  className="space-y-1 text-sm text-muted-foreground"
                >
                  <p>
                    {FUNDRAISER_REPORT_REASON_LABELS[report.reason]} ·{" "}
                    {report.status === "ACTIONED"
                      ? "led to a suspension"
                      : "closed without action"}{" "}
                    · {formatDateTime(report.createdAt)}
                  </p>
                  {report.details && (
                    <p className="break-words whitespace-pre-line">
                      {report.details}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          <CardDescription>
            {fundraiser.suspended
              ? "Reinstating puts it back on the public site. If payouts are on hold they stay on hold."
              : "A report only asks staff to look. Nothing happens to a fundraiser until one of you decides."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {fundraiser.suspended ? (
            <Button type="button" onClick={() => setReinstateOpen(true)}>
              Reinstate
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setSuspendOpen(true)}
            >
              Suspend
            </Button>
          )}
          {!fundraiser.suspended && openReports.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDismissOpen(true)}
            >
              Close the reports
            </Button>
          )}
          {payoutHold === null ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setHoldOpen(true)}
            >
              Hold payouts
            </Button>
          ) : (
            isAdmin && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setReleaseOpen(true)}
              >
                Release the payout hold
              </Button>
            )
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Staff haven&apos;t done anything about it yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {history.map((entry, index) => (
              <li
                key={`${entry.action}-${entry.at}-${index}`}
                className="text-sm"
              >
                <p>
                  {entry.actorName} {describeAction(entry.action)}
                </p>
                {entry.note && (
                  <p className="break-words whitespace-pre-line text-muted-foreground">
                    {entry.note}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <SuspendDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={`Suspend “${fundraiser.title}”?`}
        alreadyOnHold={payoutHold !== null}
        onConfirm={actions.suspend}
      />

      <DecisionDialog
        open={reinstateOpen}
        onOpenChange={setReinstateOpen}
        title="Reinstate this fundraiser?"
        description={
          payoutHold
            ? "It goes back on the public site and takes donations again. Payouts stay on hold until an admin releases the hold."
            : "It goes back on the public site and takes donations again."
        }
        confirmLabel="Reinstate"
        noteLabel="Why (for the audit log)"
        notePlaceholder="e.g. The organizer removed the phone number and confirmed their identity."
        minNoteLength={MIN_NOTE_LENGTH}
        onConfirm={actions.reinstate}
      />

      <DecisionDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title="Close the reports without suspending?"
        description="The reports are closed and the fundraiser stays up. If someone reports it again, it comes back to the list."
        confirmLabel="Close the reports"
        noteLabel="Note (optional)"
        notePlaceholder="e.g. Checked the organizer's ID and the hospital letter."
        minNoteLength={0}
        onConfirm={actions.dismissReports}
      />

      <DecisionDialog
        open={holdOpen}
        onOpenChange={setHoldOpen}
        title="Hold payouts?"
        description="The organizer can't withdraw while the hold is on, and isn't told why. Only an admin can lift it. The fundraiser stays up."
        confirmLabel="Hold payouts"
        destructive
        noteLabel="Why (staff only)"
        notePlaceholder="e.g. Waiting for the hospital to confirm the bill."
        minNoteLength={MIN_NOTE_LENGTH}
        onConfirm={actions.holdPayouts}
      />

      <DecisionDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title="Release the payout hold?"
        description="The organizer can ask to withdraw again."
        confirmLabel="Release the hold"
        noteLabel="Why (for the audit log)"
        notePlaceholder="e.g. The hospital confirmed the bill."
        minNoteLength={MIN_NOTE_LENGTH}
        onConfirm={actions.releaseHold}
      />
    </div>
  );
}

/** The review screen, wired to the backend. */
export function FundraiserReview({ fundraiserId }: { fundraiserId: string }) {
  const data = useQuery(api.fundraiserReports.getForStaff, { fundraiserId });
  const me = useQuery(api.users.getCurrentUser);
  const suspend = useMutation(api.fundraiserReports.suspend);
  const reinstate = useMutation(api.fundraiserReports.reinstate);
  const dismissReports = useMutation(api.fundraiserReports.dismissReports);
  const holdPayouts = useMutation(api.admin.placePayoutHold);
  const releaseHold = useMutation(api.admin.releasePayoutHold);

  if (data === undefined || me === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          That fundraiser couldn&apos;t be found, or you don&apos;t have access
          to it.
        </p>
        <Link
          href="/admin/fundraisers"
          className="text-sm underline underline-offset-4"
        >
          Back to fundraisers
        </Link>
      </div>
    );
  }

  const id = data.fundraiser._id;
  return (
    <FundraiserReviewView
      data={data}
      isAdmin={me?.role === "ADMIN"}
      actions={{
        suspend: async (reason, hold) => {
          const result = await suspend({
            fundraiserId: id,
            reason,
            holdPayouts: hold,
          });
          toast.success(
            result.payoutsOnHold
              ? "Suspended, and payouts are on hold."
              : "Suspended.",
          );
        },
        reinstate: async (note) => {
          const result = await reinstate({ fundraiserId: id, note });
          toast.success(
            result.payoutsOnHold
              ? "Reinstated. Payouts are still on hold."
              : "Reinstated.",
          );
        },
        dismissReports: async (note) => {
          await dismissReports({ fundraiserId: id, note: note || undefined });
          toast.success("The reports are closed.");
        },
        holdPayouts: async (reason) => {
          await holdPayouts({ fundraiserId: id, reason });
          toast.success("Payouts are on hold.");
        },
        releaseHold: async (note) => {
          await releaseHold({ fundraiserId: id, note });
          toast.success("The payout hold is released.");
        },
      }}
    />
  );
}
