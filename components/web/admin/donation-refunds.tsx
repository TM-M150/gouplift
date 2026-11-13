"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { formatDate } from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/payouts/format";

const MIN_REASON_LENGTH = 10;

export function DonationRefunds() {
  const inputId = React.useId();
  const [text, setText] = React.useState("");
  const [searched, setSearched] = React.useState("");
  const [target, setTarget] = React.useState<Id<"donations"> | null>(null);
  const refund = useMutation(api.refunds.refundDonation);

  const result = useQuery(
    api.refunds.listDonationsForRefund,
    searched ? { fundraiser: searched } : "skip",
  );
  const chosen =
    result?.donations.find((donation) => donation._id === target) ?? null;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearched(text.trim());
        }}
      >
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor={inputId}>Fundraiser link or ID</Label>
          <Input
            id={inputId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste the fundraiser's page address"
          />
        </div>
        <Button type="submit" disabled={text.trim().length === 0}>
          Find donations
        </Button>
      </form>

      {searched && result === undefined && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {searched && result === null && (
        <p className="text-sm text-muted-foreground">
          No fundraiser matches that link or ID.
        </p>
      )}

      {result && <RefundResults result={result} onRecord={setTarget} />}

      <DecisionDialog
        open={chosen !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title={
          chosen
            ? `Record the refund of ${formatKes(chosen.grossAmount)}?`
            : "Record this refund?"
        }
        description="This doesn't send any money: do that first. It takes the donation off the fundraiser's total and its withdrawable balance. If the money was already paid out, the fundraiser's next withdrawals are held until later donations cover it. It can't be undone."
        confirmLabel="Record refund"
        destructive
        noteLabel="Why is it being refunded?"
        notePlaceholder="For example: donor paid twice and asked for the second payment back."
        minNoteLength={MIN_REASON_LENGTH}
        onConfirm={async (reason) => {
          if (!chosen) return;
          await refund({ donationId: chosen._id, reason });
          toast.success("The refund is recorded.");
        }}
      />
    </div>
  );
}

export type RefundSearchResult = NonNullable<
  FunctionReturnType<typeof api.refunds.listDonationsForRefund>
>;

/** What a search found: the fundraiser, and a row per donation to act on. */
export function RefundResults({
  result,
  onRecord,
}: {
  result: RefundSearchResult;
  onRecord: (donationId: Id<"donations">) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          {result.fundraiser.title}
          {result.fundraiser.organizationName && (
            <Badge variant="outline" className="ml-2">
              {result.fundraiser.organizationName}
            </Badge>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {formatKes(result.fundraiser.amountRaised)} raised from{" "}
          {result.fundraiser.donorCount} donation
          {result.fundraiser.donorCount === 1 ? "" : "s"}.
        </p>
      </div>

      {result.shortfall > 0 && (
        <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm">
          This fundraiser is {formatKes(result.shortfall)} short: money was
          refunded after it had been paid out. Its owner cannot withdraw until
          later donations cover it.
        </p>
      )}

      {result.donations.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          This fundraiser has no completed donations.
        </p>
      ) : (
        <div className="rounded-xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Donor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Paid with</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.donations.map((donation) => (
                <TableRow key={donation._id}>
                  <TableCell>
                    <div className="font-medium">
                      {donation.donorName ?? "No name given"}
                      {donation.isAnonymous && (
                        <Badge variant="outline" className="ml-2">
                          Anonymous
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {donation.donorPhone ?? donation.donorEmail ?? ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKes(donation.grossAmount)}
                    {donation.originalCurrency === "USD" &&
                      donation.originalAmount !== null && (
                        <div className="text-xs text-muted-foreground">
                          USD {donation.originalAmount.toFixed(2)}
                        </div>
                      )}
                  </TableCell>
                  <TableCell>
                    {donation.provider === "PAYPAL" ? "PayPal" : "SasaPay"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {donation.reference ?? "—"}
                  </TableCell>
                  <TableCell>{formatDate(donation.completedAt)}</TableCell>
                  <TableCell className="text-right">
                    {donation.status === "REFUNDED" ? (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <Badge variant="outline">Refunded</Badge>
                        <div>
                          {donation.refundedAt !== null
                            ? formatDate(donation.refundedAt)
                            : ""}
                          {donation.refundSource === "PAYPAL"
                            ? " · by PayPal"
                            : ""}
                        </div>
                        {donation.refundReason && (
                          <div className="max-w-56 whitespace-normal">
                            {donation.refundReason}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onRecord(donation._id)}
                      >
                        Record refund
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {result.donations.length >= result.limit && (
        <p className="text-xs text-muted-foreground">
          Showing the latest {result.limit} completed and the latest{" "}
          {result.limit} refunded donations. Older ones are not listed.
        </p>
      )}
    </div>
  );
}
