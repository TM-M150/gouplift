"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { formatDate } from "@/components/web/admin/utils";

type Row = FunctionReturnType<typeof api.testimonials.listMine>[number];

const STATUS_LABELS: Record<
  Row["status"],
  { label: string; variant: "secondary" | "default" | "outline" }
> = {
  PENDING: { label: "Waiting for review", variant: "secondary" },
  APPROVED: { label: "Showing on the homepage", variant: "default" },
  REJECTED: { label: "Not published", variant: "outline" },
  WITHDRAWN: { label: "Withdrawn", variant: "outline" },
};

function TestimonialItem({ row }: { row: Row }) {
  const withdraw = useMutation(api.testimonials.withdrawTestimonial);
  const [open, setOpen] = React.useState(false);
  const status = STATUS_LABELS[row.status];
  const canWithdraw = row.status === "PENDING" || row.status === "APPROVED";

  return (
    <li className="space-y-2 rounded-xl border p-4">
      <p className="text-sm whitespace-pre-line break-words">“{row.message}”</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span>
            {row.fundraiserTitle} · {formatDate(row.createdAt)}
          </span>
        </div>
        {canWithdraw && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Withdraw
          </Button>
        )}
      </div>

      <DecisionDialog
        open={open}
        onOpenChange={setOpen}
        title="Withdraw this testimonial?"
        description="It comes off the homepage straight away and won't be shown again. Your donation isn't affected."
        confirmLabel="Withdraw"
        destructive
        onConfirm={async () => {
          await withdraw({ testimonialId: row._id });
          toast.success("Your testimonial was withdrawn.");
        }}
      />
    </li>
  );
}

/**
 * The messages the signed-in person offered as testimonials, with a way to
 * withdraw them. Renders nothing for someone who never offered one.
 */
export function MyTestimonials() {
  const rows = useQuery(api.testimonials.listMine);
  if (!rows || rows.length === 0) return null;

  return (
    <section className="mt-10 w-full space-y-3">
      <h2 className="text-xl font-semibold">Your testimonials</h2>
      <ul className="space-y-3">
        {rows.map((row) => (
          <TestimonialItem key={row._id} row={row} />
        ))}
      </ul>
    </section>
  );
}
