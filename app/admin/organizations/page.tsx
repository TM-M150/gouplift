"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
import { ORGANIZATION_REQUIREMENTS } from "@/lib/organization-verification";

type QueueStatus = "PENDING_REVIEW" | "VERIFIED" | "REJECTED";

const TABS: Array<{ value: QueueStatus; label: string; empty: string }> = [
  {
    value: "PENDING_REVIEW",
    label: "Pending",
    empty: "Nothing is waiting for review.",
  },
  { value: "VERIFIED", label: "Verified", empty: "No verified organizations yet." },
  { value: "REJECTED", label: "Rejected", empty: "No rejected organizations." },
];

function OrganizationQueue({
  status,
  empty,
}: {
  status: QueueStatus;
  empty: string;
}) {
  const organizations = useQuery(api.admin.listOrganizationsForReview, {
    status,
  });

  if (organizations === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (organizations.length === 0) {
    return <p className="py-8 text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <div className="rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Registration no.</TableHead>
            <TableHead>Registered by</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Documents</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((org) => (
            <TableRow key={org._id}>
              <TableCell className="font-medium">{org.name}</TableCell>
              <TableCell>
                {org.organizationType
                  ? ORGANIZATION_REQUIREMENTS[org.organizationType].label
                  : "—"}
              </TableCell>
              <TableCell>{org.registrationNumber ?? "—"}</TableCell>
              <TableCell>{org.ownerName ?? "—"}</TableCell>
              <TableCell>{formatDate(org.submittedAt)}</TableCell>
              <TableCell>
                {org.approvedCount}/{org.documentCount} approved
                {org.replacementCount > 0 &&
                  ` · ${org.replacementCount} to replace`}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/admin/organizations/${org._id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Review
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminOrganizationsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Organization verification</h1>
        <p className="text-sm text-muted-foreground">
          Review the documents each organization uploaded, then verify or
          reject it.
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
            <OrganizationQueue status={tab.value} empty={tab.empty} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
