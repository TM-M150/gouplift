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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { ReviewFileCard } from "@/components/web/admin/review-file-card";
import { formatDate, formatDateTime } from "@/components/web/admin/utils";
import {
  PAYOUT_ACCOUNT_REVIEW_CHECK_LABELS,
  PAYOUT_HOLDER_LABELS,
  PAYOUT_METHOD_LABELS,
  PAYOUT_PROOF_SLOT,
  type PayoutAccountReviewCheck,
} from "@/lib/payout-accounts";

type ReviewData = NonNullable<
  FunctionReturnType<typeof api.payoutAccountReview.getPayoutAccountForReview>
>;
type HistoryEntry = ReviewData["history"][number];

const STATUS_DISPLAY: Record<
  ReviewData["status"],
  { label: string; variant: "secondary" | "default" | "destructive" | "outline" }
> = {
  PENDING_REVIEW: { label: "Waiting for review", variant: "secondary" },
  VERIFIED: { label: "Verified", variant: "default" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  CLOSED: { label: "Removed by the owner", variant: "outline" },
};

function describeHistory(entry: HistoryEntry): string {
  const actor = entry.actorName ?? "Someone";
  switch (entry.action) {
    case "PAYOUT_ACCOUNT_APPROVED":
      return entry.note?.startsWith("Automatic")
        ? "Approved automatically"
        : `${actor} approved the account`;
    case "PAYOUT_ACCOUNT_REJECTED":
      return `${actor} rejected the account`;
    case "PAYOUT_ACCOUNT_CHANGED":
      return `${actor} chose this account for a fundraiser, replacing another`;
    default:
      return `${actor} recorded an action`;
  }
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
      <dd className="text-sm break-words whitespace-pre-line">{value}</dd>
    </div>
  );
}

export function PayoutAccountReview({
  payoutAccountId,
}: {
  payoutAccountId: string;
}) {
  const data = useQuery(api.payoutAccountReview.getPayoutAccountForReview, {
    payoutAccountId,
  });
  const approve = useMutation(api.payoutAccountReview.approvePayoutAccount);
  const reject = useMutation(api.payoutAccountReview.rejectPayoutAccount);

  const [confirmed, setConfirmed] = React.useState<
    ReadonlySet<PayoutAccountReviewCheck>
  >(new Set());
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

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
          That payout account couldn&apos;t be found.
        </p>
        <Link
          href="/admin/payout-accounts"
          className="text-sm underline underline-offset-4"
        >
          Back to the queue
        </Link>
      </div>
    );
  }

  const status = STATUS_DISPLAY[data.status];
  const isPending = data.status === "PENDING_REVIEW";
  const allConfirmed = data.requiredChecks.every((check) =>
    confirmed.has(check),
  );
  const ownerLabel = data.organization?.name ?? data.owner?.name ?? "this owner";
  const accountLabel =
    data.method === "MPESA"
      ? `M-Pesa ${data.mpesaNumber ?? ""}`
      : `${data.bankName ?? "Bank"} account`;

  function toggle(check: PayoutAccountReviewCheck, checked: boolean) {
    setConfirmed((previous) => {
      const next = new Set(previous);
      if (checked) next.add(check);
      else next.delete(check);
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href="/admin/payout-accounts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to the queue
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{ownerLabel}</h1>
          <Badge variant="secondary">{PAYOUT_METHOD_LABELS[data.method]}</Badge>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Added {formatDate(data.createdAt)}
        </p>
      </div>

      {data.sharedAccounts.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive/50 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            The same account is registered by someone else
          </p>
          <ul className="space-y-1">
            {data.sharedAccounts.map((match) => (
              <li key={match.payoutAccountId}>
                Also added by{" "}
                <Link
                  href={`/admin/payout-accounts/${match.payoutAccountId}`}
                  className="underline underline-offset-4"
                >
                  {match.ownerName ?? "an unknown owner"}
                </Link>{" "}
                ({STATUS_DISPLAY[match.status].label.toLowerCase()},{" "}
                {formatDate(match.createdAt)})
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Don&apos;t tell the owner about this. If it looks wrong, raise it
            with the compliance officer.
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The account</CardTitle>
            <CardDescription>Compare these with the proof.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Detail label="Name on the account" value={data.accountName} />
              <Detail label="Whose account" value={PAYOUT_HOLDER_LABELS[data.holder]} />
              <Detail label="M-Pesa number" value={data.mpesaNumber} />
              <Detail label="Bank" value={data.bankName} />
              <Detail label="Account number" value={data.bankAccountNumber} />
              <Detail label="Why money goes here" value={data.justification} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
            <CardDescription>
              {data.organization
                ? "The organization, and the person who added the account."
                : "The name on the account has to match this person."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {data.organization && (
                <>
                  <Detail label="Organization" value={data.organization.name} />
                  <Detail
                    label="Organization status"
                    value={data.organization.verificationStatus
                      .toLowerCase()
                      .replace("_", " ")}
                  />
                </>
              )}
              <Detail label="Added by" value={data.owner?.name} />
              <Detail label="Email" value={data.owner?.email} />
              {!data.organization && (
                <>
                  <Detail
                    label="Name on verified ID"
                    value={data.identityOnFile?.legalName}
                  />
                  <Detail
                    label="Verified mobile number"
                    value={data.identityOnFile?.phoneNumber}
                  />
                  <Detail
                    label="Verification level"
                    value={data.ownerTier > 0 ? `Level ${data.ownerTier}` : "Not verified"}
                  />
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Proof</h2>
          <p className="text-sm text-muted-foreground">
            {PAYOUT_PROOF_SLOT.description}
          </p>
        </div>
        {data.proof ? (
          <div className="max-w-md">
            <ReviewFileCard file={data.proof} label={PAYOUT_PROOF_SLOT.label} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.verifiedVia === "KYC_PHONE"
              ? "No proof: this is the mobile number verified at Level 1."
              : "No proof was uploaded."}
          </p>
        )}
      </section>

      {data.fundraisersUsing.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Fundraisers paid to this account</h2>
          <ul className="space-y-1 text-sm">
            {data.fundraisersUsing.map((fundraiser) => (
              <li key={fundraiser.fundraiserId}>{fundraiser.title}</li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          {isPending && data.canDecide && (
            <CardDescription>
              Confirm each check you have done against the proof, then approve.
              Money can only be sent to a verified account.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          {isPending && data.decisionBlocked && (
            <p role="alert" className="text-destructive">
              {data.decisionBlocked}
            </p>
          )}

          {isPending && data.canDecide && (
            <ul className="space-y-3">
              {data.requiredChecks.map((check) => {
                const id = `payout-check-${check}`;
                return (
                  <li key={check} className="flex items-start gap-3">
                    <Checkbox
                      id={id}
                      checked={confirmed.has(check)}
                      onCheckedChange={(checked) => toggle(check, checked)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="font-normal leading-snug">
                      {PAYOUT_ACCOUNT_REVIEW_CHECK_LABELS[check]}
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}

          {isPending && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!data.canDecide || !allConfirmed}
                onClick={() => setApproveOpen(true)}
              >
                Approve account
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!data.canDecide}
                onClick={() => setRejectOpen(true)}
              >
                Reject
              </Button>
            </div>
          )}

          {data.status === "VERIFIED" && (
            <div className="space-y-2">
              <p>
                {data.verifiedVia === "KYC_PHONE"
                  ? "Approved automatically: this is the mobile number verified at Level 1."
                  : `Approved${data.reviewedByName ? ` by ${data.reviewedByName}` : ""}${data.reviewedAt ? ` on ${formatDate(data.reviewedAt)}` : ""}.`}
              </p>
              {data.confirmedChecks.length > 0 && (
                <>
                  <p className="text-muted-foreground">Checks confirmed:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {data.confirmedChecks.map((check) => (
                      <li key={check}>
                        {PAYOUT_ACCOUNT_REVIEW_CHECK_LABELS[check]}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {data.status === "REJECTED" && (
            <div className="space-y-1">
              <p>
                Rejected
                {data.reviewedByName && ` by ${data.reviewedByName}`}
                {data.reviewedAt && ` on ${formatDate(data.reviewedAt)}`}. The
                owner sees this reason:
              </p>
              <p className="text-muted-foreground">
                {data.rejectionReason ?? "No reason recorded."}
              </p>
            </div>
          )}

          {data.status === "CLOSED" && (
            <p className="text-muted-foreground">
              The owner removed this account. It can no longer be used.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No decisions have been made yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {data.history.map((entry) => (
              <li key={entry._id} className="text-sm">
                <p>{describeHistory(entry)}</p>
                {entry.note && entry.action === "PAYOUT_ACCOUNT_REJECTED" && (
                  <p className="text-muted-foreground">{entry.note}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <DecisionDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`Approve ${accountLabel} for ${ownerLabel}?`}
        description="Once approved, money can be sent to this account for the fundraisers that use it. There is no way to undo this from the admin page yet."
        confirmLabel="Approve"
        onConfirm={async () => {
          await approve({
            payoutAccountId: data._id,
            confirmedChecks: [...confirmed],
          });
          toast.success("The account is verified.");
        }}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${accountLabel}?`}
        description="The owner will see your reason and can add the account again. Say only what they need to fix. Never mention suspicion, checks or compliance concerns."
        confirmLabel="Reject"
        destructive
        noteLabel="Reason for the owner"
        notePlaceholder="e.g. The statement is cut off and doesn't show the account name. Please upload the full page."
        minNoteLength={10}
        onConfirm={async (reason) => {
          await reject({ payoutAccountId: data._id, reason });
          toast.success("The account was rejected.");
        }}
      />
    </div>
  );
}
