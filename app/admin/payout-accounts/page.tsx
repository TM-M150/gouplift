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
import { PAYOUT_HOLDER_LABELS, PAYOUT_METHOD_LABELS } from "@/lib/payout-accounts";

type QueueStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED";

const TABS: Array<{ value: QueueStatus; label: string; empty: string }> = [
  {
    value: "PENDING_REVIEW",
    label: "Pending",
    empty: "No payout accounts are waiting for review.",
  },
  { value: "VERIFIED", label: "Verified", empty: "No verified accounts yet." },
  { value: "REJECTED", label: "Rejected", empty: "No rejected accounts." },
];

function Queue({ status, empty }: { status: QueueStatus; empty: string }) {
  const accounts = useQuery(api.payoutAccountReview.listPayoutAccountsForReview, {
    status,
  });

  if (accounts === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">{empty}</p>;
  }

  const decided = status !== "PENDING_REVIEW";

  return (
    <div className="rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Owner</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Held by</TableHead>
            <TableHead>Added</TableHead>
            {decided && <TableHead>Decided</TableHead>}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account._id}>
              <TableCell className="font-medium">
                {account.ownerName}
                {account.isOrganization && (
                  <Badge variant="outline" className="ml-2">
                    Organization
                  </Badge>
                )}
              </TableCell>
              <TableCell>{PAYOUT_METHOD_LABELS[account.method]}</TableCell>
              <TableCell>{PAYOUT_HOLDER_LABELS[account.holder]}</TableCell>
              <TableCell>{formatDate(account.createdAt)}</TableCell>
              {decided && (
                <TableCell>
                  {account.reviewedAt ? formatDate(account.reviewedAt) : "—"}
                </TableCell>
              )}
              <TableCell className="text-right">
                <Link
                  href={`/admin/payout-accounts/${account._id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {decided ? "View" : "Review"}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminPayoutAccountsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Payout accounts</h1>
        <p className="text-sm text-muted-foreground">
          Check that each account belongs to who it should before any money can
          be sent to it. The mobile number verified at Level 1 is approved
          automatically and doesn&apos;t appear here.
        </p>
      </div>

      <Tabs defaultValue="PENDING_REVIEW">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <Queue status={tab.value} empty={tab.empty} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
