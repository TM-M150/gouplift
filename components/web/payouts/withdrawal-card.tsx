"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  errorMessage,
  formatDate,
  formatDateTime,
} from "@/components/web/admin/utils";
import {
  PAYOUT_STATUS_DISPLAY,
  formatKes,
} from "@/components/web/payouts/format";
import { PAYPAL_SETTLEMENT_DELAY_DAYS, payoutAmountProblem } from "@/lib/payouts";

export type PayoutOverview = NonNullable<
  FunctionReturnType<typeof api.payouts.getMyPayoutOverview>
>;
type OwnerPayout = PayoutOverview["payouts"][number];

/** Whether there is anything to show: money raised, or a withdrawal made. */
export function hasWithdrawalActivity(overview: PayoutOverview): boolean {
  return (
    overview.available + overview.pending + overview.reserved + overview.paid >
      0 || overview.payouts.length > 0
  );
}

function Figure({
  label,
  amount,
  note,
  large,
}: {
  label: string;
  amount: number;
  note?: string;
  large?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          large
            ? "text-2xl font-semibold tabular-nums"
            : "text-lg font-medium tabular-nums"
        }
      >
        {formatKes(amount)}
      </dd>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Notice({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
      <p className="min-w-0">{children}</p>
      {action}
    </div>
  );
}

function WithdrawForm({
  overview,
  largest,
  onRequest,
}: {
  overview: PayoutOverview;
  /** The most that can be asked for now: the balance, or the limit if lower. */
  largest: number;
  onRequest: (amount: number) => Promise<void>;
}) {
  const amountId = React.useId();
  const helpId = React.useId();
  const [amount, setAmount] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const value = Number(amount);
    const problem =
      amount === ""
        ? "Enter how much to withdraw."
        : payoutAmountProblem(value, overview.available);
    if (problem) {
      setError(problem);
      return;
    }
    if (overview.limitRemaining !== null && value > overview.limitRemaining) {
      setError(
        `Your verification level lets you withdraw up to ${formatKes(overview.limitRemaining)} more.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      await onRequest(value);
      setAmount("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <div className="space-y-2">
        <Label htmlFor={amountId}>Amount to withdraw (KES)</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={amountId}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder={String(overview.minPayout)}
            aria-describedby={helpId}
            aria-invalid={error !== null}
            disabled={submitting}
            className="w-40"
          />
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => {
              setAmount(String(largest));
              setError(null);
            }}
          >
            Withdraw all ({formatKes(largest)})
          </Button>
        </div>
        <p id={helpId} className="text-xs text-muted-foreground">
          {overview.destination
            ? `Goes to ${overview.destination}. `
            : ""}
          The smallest withdrawal is {formatKes(overview.minPayout)}. Any
          transfer charge from the mobile network or bank comes off the amount,
          and you&apos;ll see exactly what reached you once it&apos;s paid.
        </p>
        {overview.limitRemaining !== null && (
          <p className="text-xs text-muted-foreground">
            Your verification level lets you withdraw up to{" "}
            {formatKes(overview.limitRemaining)} more in total.{" "}
            <Link href="/verification" className="underline underline-offset-4">
              Raise your limit
            </Link>
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Requesting…" : "Request withdrawal"}
      </Button>
    </form>
  );
}

function OpenRequest({
  payout,
  onCancel,
}: {
  payout: OwnerPayout;
  onCancel: (payoutId: OwnerPayout["_id"]) => Promise<void>;
}) {
  const [cancelling, setCancelling] = React.useState(false);
  const waiting = payout.status === "REQUESTED";

  return (
    <div className="space-y-3 rounded-xl border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Withdrawal of {formatKes(payout.amount)}
        </p>
        <Badge variant={PAYOUT_STATUS_DISPLAY[payout.status].variant}>
          {PAYOUT_STATUS_DISPLAY[payout.status].label}
        </Badge>
      </div>
      <p className="text-muted-foreground">
        {waiting
          ? `We're checking your request. When it's approved we'll send the money to ${payout.destination}.`
          : `Approved. We're sending the money to ${payout.destination}.`}{" "}
        Asked for on {formatDate(payout.requestedAt)}.
      </p>
      {waiting && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cancelling}
          onClick={async () => {
            setCancelling(true);
            try {
              await onCancel(payout._id);
            } finally {
              setCancelling(false);
            }
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel this request"}
        </Button>
      )}
    </div>
  );
}

function historyDetail(payout: OwnerPayout): string | null {
  switch (payout.status) {
    case "PAID": {
      const fee = payout.transferFeeAmount ?? 0;
      return [
        `You received ${formatKes(payout.received ?? payout.amount)}${
          fee > 0 ? ` after a ${formatKes(fee)} transfer charge` : ""
        }`,
        payout.providerReference ? `Reference ${payout.providerReference}` : null,
        payout.paidAt ? `Sent ${formatDate(payout.paidAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "REJECTED":
      return payout.rejectionReason ?? "This request wasn't approved.";
    case "FAILED":
      return "We couldn't send this one. The money is back in your balance, so you can ask again.";
    case "CANCELLED":
      return "You cancelled this request.";
    default:
      return null;
  }
}

function PayoutHistory({ payouts }: { payouts: OwnerPayout[] }) {
  if (payouts.length === 0) return null;
  return (
    <details className="rounded-xl border px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Withdrawal history ({payouts.length})
      </summary>
      <ul className="mt-3 divide-y">
        {payouts.map((payout) => {
          const status = PAYOUT_STATUS_DISPLAY[payout.status];
          const detail = historyDetail(payout);
          return (
            <li key={payout._id} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium tabular-nums">
                  {formatKes(payout.amount)}
                </p>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <p className="text-muted-foreground">
                {formatDate(payout.requestedAt)} · {payout.destination}
              </p>
              {detail && <p className="text-muted-foreground">{detail}</p>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

interface WithdrawalCardViewProps {
  anchorId?: string;
  title: string;
  subtitle?: string | null;
  overview: PayoutOverview;
  now: number;
  onRequest: (amount: number) => Promise<void>;
  onCancel: (payoutId: OwnerPayout["_id"]) => Promise<void>;
}

/** The card itself. It only draws what it is given, so it can be previewed. */
export function WithdrawalCardView({
  anchorId,
  title,
  subtitle,
  overview,
  now,
  onRequest,
  onCancel,
}: WithdrawalCardViewProps) {
  const open =
    overview.payouts.find(
      (payout) => payout.status === "REQUESTED" || payout.status === "APPROVED",
    ) ?? null;
  const held = overview.heldUntil !== null && now < overview.heldUntil;
  const largest = Math.min(
    overview.available,
    overview.limitRemaining ?? Number.POSITIVE_INFINITY,
  );
  const hasEnough = overview.available >= overview.minPayout;
  const atLimit = hasEnough && largest < overview.minPayout;
  const canAsk =
    !overview.blockedReason &&
    !held &&
    !open &&
    !overview.hasOpenRequest &&
    !atLimit &&
    hasEnough;

  return (
    <Card id={anchorId} className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Figure label="Ready to withdraw" amount={overview.available} large />
          <Figure
            label="On its way"
            amount={overview.pending}
            note={
              overview.pending > 0
                ? `PayPal gifts can be withdrawn ${PAYPAL_SETTLEMENT_DELAY_DAYS} days after they arrive.`
                : undefined
            }
          />
          <Figure label="Withdrawn so far" amount={overview.paid} />
        </dl>

        {overview.blockedReason ? (
          <Notice>{overview.blockedReason}</Notice>
        ) : held && overview.heldUntil !== null ? (
          <Notice>
            You changed the payout account recently, so withdrawals are paused
            until {formatDateTime(overview.heldUntil)}.
          </Notice>
        ) : null}

        {overview.shortfall > 0 && (
          <Notice>
            A donation that was already withdrawn has been refunded, so this
            fundraiser is {formatKes(overview.shortfall)} short. You can
            withdraw again once later donations have covered it.
          </Notice>
        )}

        {open && <OpenRequest payout={open} onCancel={onCancel} />}

        {atLimit && (
          <Notice
            action={
              <Link
                href="/verification"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Raise your limit
              </Link>
            }
          >
            You&apos;ve reached the most your verification level lets you
            withdraw. Verify to the next level to withdraw more.
          </Notice>
        )}

        {canAsk && (
          <WithdrawForm
            overview={overview}
            largest={largest}
            onRequest={onRequest}
          />
        )}

        {!hasEnough && !open && !overview.blockedReason && !held && (
          <p className="text-sm text-muted-foreground">
            {overview.available + overview.pending === 0
              ? `Nothing to withdraw yet. You can withdraw once you have at least ${formatKes(overview.minPayout)}.`
              : `You can withdraw once you have at least ${formatKes(overview.minPayout)} ready.`}
          </p>
        )}

        <PayoutHistory payouts={overview.payouts} />
      </CardContent>
    </Card>
  );
}

/** A fundraiser's withdrawal card, loaded for its owner. Nothing for anyone else. */
export function FundraiserWithdrawal({
  fundraiserId,
  title,
  subtitle,
}: {
  fundraiserId: Id<"fundraisers">;
  title: string;
  subtitle?: string | null;
}) {
  const overview = useQuery(api.payouts.getMyPayoutOverview, { fundraiserId });
  const requestPayout = useMutation(api.payouts.requestPayout);
  const cancelPayout = useMutation(api.payouts.cancelPayoutRequest);
  const [now] = React.useState(() => Date.now());

  const shown = overview !== undefined && overview !== null && hasWithdrawalActivity(overview);
  // The card only exists once its data has loaded, so a link to it
  // (/payouts#withdraw-...) can't be scrolled to by the browser on its own.
  React.useEffect(() => {
    if (!shown) return;
    const id = `withdraw-${fundraiserId}`;
    if (window.location.hash === `#${id}`) {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }
  }, [shown, fundraiserId]);

  if (overview === undefined) return <Skeleton className="h-56 w-full" />;
  // Not theirs, or a fundraiser that has never raised anything.
  if (overview === null || !hasWithdrawalActivity(overview)) return null;

  return (
    <WithdrawalCardView
      anchorId={`withdraw-${fundraiserId}`}
      title={title}
      subtitle={subtitle}
      overview={overview}
      now={now}
      onRequest={async (amount) => {
        await requestPayout({ fundraiserId, amount });
        toast.success(
          "Withdrawal requested. We'll review it and send the money.",
        );
      }}
      onCancel={async (payoutId) => {
        try {
          await cancelPayout({ payoutId });
          toast.success("Request cancelled. The money is back in your balance.");
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }}
    />
  );
}
