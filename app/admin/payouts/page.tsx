"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/payouts/format";
import type { PayoutStatus } from "@/lib/payouts";

const TABS: Array<{ value: PayoutStatus; label: string; empty: string }> = [
  {
    value: "REQUESTED",
    label: "Waiting for review",
    empty: "No withdrawals are waiting for review.",
  },
  {
    value: "APPROVED",
    label: "To send",
    empty: "Nothing is approved and waiting to be sent.",
  },
  { value: "PAID", label: "Paid", empty: "Nothing has been paid yet." },
  { value: "REJECTED", label: "Rejected", empty: "No rejected withdrawals." },
  { value: "FAILED", label: "Failed", empty: "No failed transfers." },
  { value: "CANCELLED", label: "Cancelled", empty: "No cancelled requests." },
];

function Queue({ status, empty }: { status: PayoutStatus; empty: string }) {
  const payouts = useQuery(api.payouts.listPayoutsForStaff, { status });

  if (payouts === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (payouts.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">{empty}</p>;
  }

  const open = status === "REQUESTED" || status === "APPROVED";
  const when = status === "PAID" ? "Paid" : "Asked";

  return (
    <div className="rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Owner</TableHead>
            <TableHead>Fundraiser</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Pay to</TableHead>
            <TableHead>{when}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {payouts.map((payout) => (
            <TableRow key={payout._id}>
              <TableCell className="font-medium">
                {payout.ownerName}
                {payout.isOrganization && (
                  <Badge variant="outline" className="ml-2">
                    Organization
                  </Badge>
                )}
                {payout.needsEnhancedApproval && (
                  <Badge variant="destructive" className="ml-2">
                    MLRO
                  </Badge>
                )}
              </TableCell>
              <TableCell className="max-w-56 truncate">
                {payout.fundraiserTitle}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKes(payout.amount)}
              </TableCell>
              <TableCell>{payout.destination}</TableCell>
              <TableCell>
                {formatDate(
                  status === "PAID" && payout.paidAt !== null
                    ? payout.paidAt
                    : payout.requestedAt,
                )}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/admin/payouts/${payout._id}`}
                  className={buttonVariants({
                    variant: open ? "default" : "outline",
                    size: "sm",
                  })}
                >
                  {status === "REQUESTED"
                    ? "Review"
                    : status === "APPROVED"
                      ? "Send"
                      : "View"}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminPayoutsPage() {
  const me = useQuery(api.users.getCurrentUser);

  if (me === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }
  // The queue is empty for anyone who isn't an admin, which would read as
  // "nothing to do". Say why instead.
  if (me?.role !== "ADMIN") {
    return (
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Only admins can see and decide withdrawals.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Review each withdrawal, send the money from the SasaPay or bank
          dashboard, then record it here. Waiting and approved requests are
          listed oldest first.
        </p>
      </div>

      <Tabs defaultValue="REQUESTED">
        <div className="overflow-x-auto">
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <Queue status={tab.value} empty={tab.empty} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
