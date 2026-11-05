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

type QueueStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

const TABS: Array<{ value: QueueStatus; label: string; empty: string }> = [
  {
    value: "PENDING_REVIEW",
    label: "Pending",
    empty: "Nothing is waiting for review.",
  },
  { value: "APPROVED", label: "Approved", empty: "No approved applications yet." },
  { value: "REJECTED", label: "Rejected", empty: "No rejected applications." },
];

function KycQueue({ status, empty }: { status: QueueStatus; empty: string }) {
  const submissions = useQuery(api.kycReview.listKycForReview, { status });

  if (submissions === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (submissions.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">{empty}</p>;
  }

  const decided = status !== "PENDING_REVIEW";

  return (
    <div className="rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead>Level</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Documents</TableHead>
            {decided && <TableHead>Decided</TableHead>}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((submission) => (
            <TableRow key={submission._id}>
              <TableCell className="font-medium">
                {submission.applicantName}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">Level {submission.requestedTier}</Badge>
              </TableCell>
              <TableCell>{formatDate(submission.submittedAt)}</TableCell>
              <TableCell>{submission.documentCount}</TableCell>
              {decided && (
                <TableCell>
                  {submission.reviewedAt ? formatDate(submission.reviewedAt) : "—"}
                </TableCell>
              )}
              <TableCell className="text-right">
                <Link
                  href={`/admin/verification/${submission._id}`}
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

export default function AdminVerificationPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Fundraiser verification</h1>
        <p className="text-sm text-muted-foreground">
          Check each fundraiser&apos;s ID and documents, then approve their
          level or send it back.
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
            <KycQueue status={tab.value} empty={tab.empty} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
