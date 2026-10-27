"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { DocumentReviewCard } from "@/components/web/admin/document-review-card";
import {
  formatDate,
  formatDateTime,
  safeHttpUrl,
} from "@/components/web/admin/utils";
import { VerificationBadge } from "@/components/web/organization/verification-badge";
import {
  ORGANIZATION_REQUIREMENTS,
  getDocumentSlots,
} from "@/lib/organization-verification";

type ReviewData = NonNullable<
  FunctionReturnType<typeof api.admin.getOrganizationForReview>
>;
type HistoryEntry = ReviewData["history"][number];

const CROSS_CHECKS = [
  "The name on the certificate matches the organization name and the payout account name.",
  "The KRA PIN belongs to the organization, not to a person.",
  "The CR12, where required, is recent (ideally under 3 months old).",
  "The registration number matches the public register for that regulator.",
  "The authorising resolution is signed and stamped, and names the person who registered.",
];

function describeHistory(
  entry: HistoryEntry,
  documentLabels: Map<string, string>,
): string {
  const actor = entry.actorName ?? "Someone";
  switch (entry.action) {
    case "DOCUMENT_REVIEWED": {
      const doc =
        (entry.documentId && documentLabels.get(entry.documentId)) ||
        "a document";
      if (entry.statusAfter === "APPROVED") return `${actor} approved ${doc}`;
      if (entry.statusAfter === "REJECTED") {
        return `${actor} requested a replacement for ${doc}`;
      }
      return `${actor} reset the review of ${doc}`;
    }
    case "ORGANIZATION_VERIFIED":
      return `${actor} verified the organization`;
    case "ORGANIZATION_REJECTED":
      return `${actor} rejected the organization`;
  }
}

function ReviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function OrganizationReview({
  organizationId,
}: {
  organizationId: string;
}) {
  const data = useQuery(api.admin.getOrganizationForReview, {
    organizationId,
  });
  const verifyOrganization = useMutation(api.admin.verifyOrganization);
  const rejectOrganization = useMutation(api.admin.rejectOrganization);
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  if (data === undefined) return <ReviewSkeleton />;

  if (data === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          That organization couldn&apos;t be found.
        </p>
        <Link
          href="/admin/organizations"
          className="text-sm underline underline-offset-4"
        >
          Back to the queue
        </Link>
      </div>
    );
  }

  const slots = data.organizationType
    ? getDocumentSlots(data.organizationType)
    : [];
  const slotOrder = new Map(slots.map((slot, index) => [slot.documentType, index]));
  const slotLabels = new Map(slots.map((slot) => [slot.documentType, slot.label]));
  const labelFor = (documentType: string) =>
    slotLabels.get(documentType as (typeof slots)[number]["documentType"]) ??
    documentType.replaceAll("_", " ").toLowerCase();

  const documents = [...data.documents].sort(
    (a, b) =>
      (slotOrder.get(a.documentType) ?? 99) -
      (slotOrder.get(b.documentType) ?? 99),
  );
  const documentLabels = new Map(
    data.documents.map((doc) => [doc._id as string, labelFor(doc.documentType)]),
  );

  const isPending = data.verificationStatus === "PENDING_REVIEW";
  const website = safeHttpUrl(data.website);
  const typeLabel = data.organizationType
    ? ORGANIZATION_REQUIREMENTS[data.organizationType].label
    : "Type not set";

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href="/admin/organizations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to the queue
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <VerificationBadge status={data.verificationStatus} />
        </div>
        <p className="text-sm text-muted-foreground">
          {typeLabel}
          {data.registrationNumber && ` · Reg. no. ${data.registrationNumber}`}
          {` · Submitted ${formatDate(data.submittedAt)}`}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="whitespace-pre-line">
              {data.description ?? (
                <span className="text-muted-foreground">No description.</span>
              )}
            </p>
            {website && (
              <p>
                <span className="text-muted-foreground">Website: </span>
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {website}
                </a>
              </p>
            )}
            {data.contactEmail && (
              <p>
                <span className="text-muted-foreground">Contact email: </span>
                {data.contactEmail}
              </p>
            )}
            {data.contactPhone && (
              <p>
                <span className="text-muted-foreground">Contact phone: </span>
                {data.contactPhone}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registered by</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.owner ? (
              <>
                <p className="font-medium">{data.owner.name}</p>
                <p>
                  <a
                    href={`mailto:${data.owner.email}`}
                    className="underline underline-offset-4"
                  >
                    {data.owner.email}
                  </a>
                </p>
                {data.owner.phone && <p>{data.owner.phone}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">Account not found.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">
            Open each file and approve it, or ask for a replacement with a note
            for the owner.
          </p>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents were uploaded.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {documents.map((doc) => (
              <DocumentReviewCard
                key={doc._id}
                document={doc}
                label={labelFor(doc.documentType)}
                canReview={isPending}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Before you verify</CardTitle>
            <CardDescription>Cross-check across the documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {CROSS_CHECKS.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {isPending && (
              <>
                {data.blockers.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      Every required document must be approved before you can
                      verify. Still needed:
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      {data.blockers.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    All required documents are approved.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!data.canVerify}
                    onClick={() => setVerifyOpen(true)}
                  >
                    Verify organization
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
            {data.verificationStatus === "VERIFIED" && (
              <p>
                Verified
                {data.verifiedAt && ` on ${formatDate(data.verifiedAt)}`}.
              </p>
            )}
            {data.verificationStatus === "REJECTED" && (
              <div className="space-y-1">
                <p>Rejected. The owner sees this reason:</p>
                <p className="text-muted-foreground">
                  {data.rejectionReason ?? "No reason recorded."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                <p>{describeHistory(entry, documentLabels)}</p>
                {entry.note && (
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
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        title={`Verify ${data.name}?`}
        description="They will show as verified on GoUplift. There is no way to undo this from the admin page yet."
        confirmLabel="Verify organization"
        onConfirm={async () => {
          await verifyOrganization({ organizationId: data._id });
          toast.success(`${data.name} is now verified.`);
        }}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${data.name}?`}
        description="The owner will see your reason on their dashboard."
        confirmLabel="Reject organization"
        destructive
        noteLabel="Reason for the owner"
        notePlaceholder="e.g. We couldn't match the registration number to the public register."
        minNoteLength={10}
        onConfirm={async (reason) => {
          await rejectOrganization({ organizationId: data._id, reason });
          toast.success(`${data.name} was rejected.`);
        }}
      />
    </div>
  );
}
