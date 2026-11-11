"use client";

import * as React from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { formatDate, formatDateTime } from "@/components/web/admin/utils";
import { CopyButton } from "@/components/web/organization/developers/copy-button";
import {
  PAYOUT_STATUS_DISPLAY,
  formatKes,
} from "@/components/web/payouts/format";
import { PAYOUT_HOLDER_LABELS, PAYOUT_METHOD_LABELS } from "@/lib/payout-accounts";
import {
  MAX_PAYOUT_REFERENCE_LENGTH,
  MIN_PAYOUT_REFERENCE_LENGTH,
  roundMoney,
} from "@/lib/payouts";

export type PayoutReviewData = NonNullable<
  FunctionReturnType<typeof api.payouts.getPayoutForStaff>
>;
type TimelineEntry = PayoutReviewData["timeline"][number];

const MIN_REASON_LENGTH = 10;

function describeEvent(entry: TimelineEntry): string {
  const actor = entry.actorName ?? "Someone";
  switch (entry.kind) {
    case "REQUESTED":
      return `${actor} asked for the payout`;
    case "APPROVED":
      return `${actor} approved it`;
    case "REJECTED":
      return `${actor} rejected it`;
    case "CANCELLED":
      return `${actor} cancelled the request`;
    case "PAID":
      return `${actor} recorded it as sent`;
    case "FAILED":
      return `${actor} recorded that it couldn't be sent`;
  }
}

function Detail({
  label,
  value,
  copy,
}: {
  label: string;
  value: string | null | undefined;
  /** Adds a copy button, for the things typed into a bank or M-Pesa screen. */
  copy?: string;
}) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm break-words">
        <span className="whitespace-pre-line">{value}</span>
        {copy && <CopyButton value={copy} />}
      </dd>
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
      role="alert"
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

/** Approved, and now waiting for the money to be sent and recorded. */
function RecordTransfer({
  data,
  onMarkPaid,
  onMarkFailed,
  onReject,
}: {
  data: PayoutReviewData;
  onMarkPaid: (reference: string, transferFee: number) => Promise<void>;
  onMarkFailed: (reason: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}) {
  const referenceId = React.useId();
  const feeId = React.useId();
  const [reference, setReference] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [failedOpen, setFailedOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const cleanReference = reference.trim().toUpperCase();
  const feeValue = fee === "" ? 0 : Number(fee);
  const feeValid =
    Number.isFinite(feeValue) && feeValue >= 0 && feeValue < data.amount;
  const received = roundMoney(data.amount - (feeValid ? feeValue : 0));

  function review(event: React.FormEvent) {
    event.preventDefault();
    if (
      cleanReference.length < MIN_PAYOUT_REFERENCE_LENGTH ||
      cleanReference.length > MAX_PAYOUT_REFERENCE_LENGTH
    ) {
      setProblem(
        `Enter the M-Pesa code or bank reference (${MIN_PAYOUT_REFERENCE_LENGTH} to ${MAX_PAYOUT_REFERENCE_LENGTH} characters).`,
      );
      return;
    }
    if (!feeValid) {
      setProblem(
        "The transfer charge has to be zero or more, and less than the payout.",
      );
      return;
    }
    setProblem(null);
    setConfirmOpen(true);
  }

  return (
    <>
      <form onSubmit={review} className="space-y-4" noValidate>
        <p className="text-sm text-muted-foreground">
          {`Send ${formatKes(data.amount)} to the account above from the SasaPay or bank dashboard, then record it here. Once it's recorded, the fundraiser sees it as paid.`}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={referenceId}>M-Pesa code or bank reference</Label>
            <Input
              id={referenceId}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              autoComplete="off"
              placeholder="e.g. SLK1A2B3C4"
              className="uppercase placeholder:normal-case"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={feeId}>Transfer charge (KES)</Label>
            <Input
              id={feeId}
              value={fee}
              onChange={(event) =>
                setFee(event.target.value.replace(/[^\d.]/g, ""))
              }
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              What the network or bank actually charged. It comes off the
              payout
              {feeValid && fee !== ""
                ? `, so the fundraiser receives ${formatKes(received)}.`
                : "."}
            </p>
          </div>
        </div>

        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit">Mark as paid</Button>
          <Button type="button" variant="outline" onClick={() => setFailedOpen(true)}>
            It didn&apos;t go through
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setRejectOpen(true)}
          >
            Reject
          </Button>
        </div>
      </form>

      <DecisionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm you've sent the money"
        description={`This records ${formatKes(data.amount)} to ${data.destination} as sent, with reference ${cleanReference}. It can't be undone from here.`}
        confirmLabel="Mark as paid"
        onConfirm={() => onMarkPaid(cleanReference, feeValid ? feeValue : 0)}
      />

      <DecisionDialog
        open={failedOpen}
        onOpenChange={setFailedOpen}
        title="Record that the transfer failed?"
        description="Use this when you tried to send the money and it didn't go through. It goes back to the fundraiser's balance and they can ask again. They are only told it couldn't be sent, never why."
        confirmLabel="Record failure"
        destructive
        noteLabel="What went wrong? (staff only)"
        notePlaceholder="e.g. M-Pesa refused the number: it isn't registered for M-Pesa."
        minNoteLength={MIN_REASON_LENGTH}
        onConfirm={onMarkFailed}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject this approved payout?"
        description="Nothing has been sent, so the money goes back to the fundraiser's balance. They will see your reason. Say only what they need to know. Never mention suspicion, checks or compliance concerns."
        confirmLabel="Reject"
        destructive
        noteLabel="Reason for the owner"
        notePlaceholder="e.g. The M-Pesa number is no longer in your name. Please update your payout account."
        minNoteLength={MIN_REASON_LENGTH}
        onConfirm={onReject}
      />
    </>
  );
}

interface PayoutReviewViewProps {
  data: PayoutReviewData;
  onApprove: (note: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onMarkPaid: (reference: string, transferFee: number) => Promise<void>;
  onMarkFailed: (reason: string) => Promise<void>;
}

/** The whole screen. It only draws what it is given, so it can be previewed. */
export function PayoutReviewView({
  data,
  onApprove,
  onReject,
  onMarkPaid,
  onMarkFailed,
}: PayoutReviewViewProps) {
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const status = PAYOUT_STATUS_DISPLAY[data.status];
  const open = data.status === "REQUESTED" || data.status === "APPROVED";
  const account = data.account;
  const received =
    data.status === "PAID"
      ? roundMoney(data.amount - (data.transferFeeAmount ?? 0))
      : null;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href="/admin/payouts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to the queue
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{data.ownerName}</h1>
          {data.isOrganization && <Badge variant="outline">Organization</Badge>}
          <Badge variant={status.variant}>{status.label}</Badge>
          {data.needsEnhancedApproval && (
            <Badge variant="destructive">Above the Level 2 limit</Badge>
          )}
        </div>
        <p className="text-3xl font-semibold tabular-nums">
          {formatKes(data.amount)}
        </p>
        <p className="text-sm text-muted-foreground">
          For{" "}
          <Link
            href={`/fundraiser/${data.fundraiserId}`}
            className="underline underline-offset-4"
          >
            {data.fundraiserTitle}
          </Link>
          . Asked for {formatDateTime(data.requestedAt)}
          {data.requestedByName && data.requestedByName !== data.ownerName
            ? ` by ${data.requestedByName}`
            : ""}
          .
        </p>
      </div>

      {open && data.accountChanged && (
        <Alert>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            The fundraiser is now paid to a different account
          </p>
          <p>
            The account below is the one that was asked for. Don&apos;t send to
            it. Reject this and ask the owner to request again.
          </p>
        </Alert>
      )}

      {open && data.blockers.length > 0 && (
        <Alert>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            This fundraiser can&apos;t be paid out right now
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {data.blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Don&apos;t tell the owner why. If it looks wrong, raise it with the
            compliance officer.
          </p>
        </Alert>
      )}

      {open && data.needsEnhancedApproval && (
        <Alert tone="info">
          <p>
            This payout takes the owner above the Level 2 limit, so the MLRO
            has to approve it and record the reason.
          </p>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Send the money to</CardTitle>
            <CardDescription>
              Copy these into the SasaPay or bank screen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {account ? (
              <dl className="space-y-3">
                <Detail
                  label="Amount"
                  value={formatKes(data.amount)}
                  copy={String(data.amount)}
                />
                <Detail label="Method" value={PAYOUT_METHOD_LABELS[account.method]} />
                <Detail
                  label="Name on the account"
                  value={account.accountName}
                  copy={account.accountName}
                />
                <Detail
                  label="M-Pesa number"
                  value={account.mpesaNumber}
                  copy={account.mpesaNumber ?? undefined}
                />
                <Detail label="Bank" value={account.bankName} />
                <Detail
                  label="Account number"
                  value={account.bankAccountNumber}
                  copy={account.bankAccountNumber ?? undefined}
                />
                <Detail
                  label="Whose account"
                  value={PAYOUT_HOLDER_LABELS[account.holder]}
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                The account this was asked for can no longer be found.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Check it</CardTitle>
            <CardDescription>
              The account should be in the name on the verified ID.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Detail label="Owner" value={data.ownerName} />
              <Detail label="Email" value={data.ownerEmail} />
              <Detail
                label="Name on verified ID"
                value={data.identityOnFile?.legalName}
              />
              <Detail
                label="Verified mobile number"
                value={data.identityOnFile?.phoneNumber}
              />
              {data.ownerTier !== null && (
                <Detail
                  label="Verification level"
                  value={
                    data.ownerTier > 0 ? `Level ${data.ownerTier}` : "Not verified"
                  }
                />
              )}
              {data.ownerLimit !== null &&
                data.ownerCommitted !== null &&
                Number.isFinite(data.ownerLimit) && (
                  <Detail
                    label="Paid or asked for, against the limit"
                    value={`${formatKes(data.ownerCommitted)} of ${formatKes(data.ownerLimit)}`}
                  />
                )}
              <Detail
                label="This fundraiser's balance"
                value={`${formatKes(data.balance.available)} ready · ${formatKes(data.balance.pending)} on its way · ${formatKes(data.balance.reserved)} in withdrawals · ${formatKes(data.balance.paid)} paid`}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {data.status === "REQUESTED"
              ? "Decision"
              : data.status === "APPROVED"
                ? "Send it, then record it"
                : "Outcome"}
          </CardTitle>
          {data.status === "REQUESTED" && (
            <CardDescription>
              Approving doesn&apos;t send any money. It lets staff send it.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {data.status === "REQUESTED" && (
            <>
              {data.approveBlocked && (
                <p role="alert" className="text-destructive">
                  {data.approveBlocked}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={data.approveBlocked !== null}
                  onClick={() => setApproveOpen(true)}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setRejectOpen(true)}
                >
                  Reject
                </Button>
              </div>
            </>
          )}

          {data.status === "APPROVED" && (
            <RecordTransfer
              data={data}
              onMarkPaid={onMarkPaid}
              onMarkFailed={onMarkFailed}
              onReject={onReject}
            />
          )}

          {data.status === "PAID" && (
            <dl className="space-y-3">
              <Detail
                label="M-Pesa code or bank reference"
                value={data.providerReference}
                copy={data.providerReference ?? undefined}
              />
              <Detail
                label="Transfer charge"
                value={formatKes(data.transferFeeAmount ?? 0)}
              />
              <Detail
                label="The fundraiser received"
                value={received === null ? null : formatKes(received)}
              />
            </dl>
          )}

          {data.status === "REJECTED" && (
            <p>
              Rejected. The owner sees this reason:{" "}
              <span className="text-muted-foreground">
                {data.rejectionReason ?? "No reason recorded."}
              </span>
            </p>
          )}

          {data.status === "FAILED" && (
            <p>
              The transfer didn&apos;t go through, and the money is back in the
              fundraiser&apos;s balance. Only staff see why:{" "}
              <span className="text-muted-foreground">
                {data.failureReason ?? "No reason recorded."}
              </span>
            </p>
          )}

          {data.status === "CANCELLED" && (
            <p className="text-muted-foreground">
              The owner cancelled this request before it was reviewed.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        <ol className="space-y-3">
          {data.timeline.map((entry, index) => (
            <li key={`${entry.kind}-${index}`} className="text-sm">
              <p>{describeEvent(entry)}</p>
              {entry.note && (
                <p className="text-muted-foreground">{entry.note}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {formatDateTime(entry.at)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <DecisionDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`Approve ${formatKes(data.amount)} for ${data.ownerName}?`}
        description={`Approving doesn't send any money. After you approve, send it to ${data.destination} from SasaPay or the bank, then record it here.`}
        confirmLabel="Approve"
        noteLabel={
          data.needsEnhancedApproval
            ? "Why you are approving this (recorded)"
            : "Note (optional)"
        }
        notePlaceholder={
          data.needsEnhancedApproval
            ? "e.g. Source of funds confirmed with the owner and the campaign evidence."
            : "Anything the next person should know"
        }
        minNoteLength={data.needsEnhancedApproval ? MIN_REASON_LENGTH : 0}
        onConfirm={onApprove}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${formatKes(data.amount)} for ${data.ownerName}?`}
        description="The money goes back to the fundraiser's balance and they can ask again. They will see your reason. Say only what they need to know. Never mention suspicion, checks or compliance concerns."
        confirmLabel="Reject"
        destructive
        noteLabel="Reason for the owner"
        notePlaceholder="e.g. The name on the M-Pesa number doesn't match your verified ID. Please choose another account."
        minNoteLength={MIN_REASON_LENGTH}
        onConfirm={onReject}
      />

      {data.approvedAt !== null && data.status === "APPROVED" && (
        <p className="text-xs text-muted-foreground">
          Approved {formatDate(data.approvedAt)}.
        </p>
      )}
    </div>
  );
}

export function PayoutReview({ payoutId }: { payoutId: string }) {
  const data = useQuery(api.payouts.getPayoutForStaff, { payoutId });
  const approve = useMutation(api.payouts.approvePayout);
  const reject = useMutation(api.payouts.rejectPayout);
  const markPaid = useMutation(api.payouts.markPayoutPaid);
  const markFailed = useMutation(api.payouts.markPayoutFailed);

  if (data === undefined) {
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
          That payout couldn&apos;t be found, or you don&apos;t have access to it.
        </p>
        <Link
          href="/admin/payouts"
          className="text-sm underline underline-offset-4"
        >
          Back to the queue
        </Link>
      </div>
    );
  }

  const id = data._id;
  return (
    <PayoutReviewView
      data={data}
      onApprove={async (note) => {
        await approve({ payoutId: id, note: note || undefined });
        toast.success("Approved. Now send the money and record it here.");
      }}
      onReject={async (reason) => {
        await reject({ payoutId: id, reason });
        toast.success("The payout was rejected.");
      }}
      onMarkPaid={async (providerReference, transferFeeAmount) => {
        await markPaid({ payoutId: id, providerReference, transferFeeAmount });
        toast.success("Recorded as paid.");
      }}
      onMarkFailed={async (reason) => {
        await markFailed({ payoutId: id, reason });
        toast.success("Recorded as failed. The money is back in the balance.");
      }}
    />
  );
}
