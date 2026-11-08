"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft } from "lucide-react";
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
import { DocumentReviewCard } from "@/components/web/admin/document-review-card";
import {
  OrganizationFindingsFields,
  OrganizationRiskProfileCard,
  OwnersPanel,
  RateOrganizationCard,
  previewOrganizationRisk,
  type OrganizationFindings,
} from "@/components/web/admin/organization-risk-panels";
import {
  Detail,
  EddFields,
  EMPTY_EDD,
  RiskPreview,
  eddArgs,
  eddDraftProblem,
  type EddDraft,
} from "@/components/web/admin/risk-panels";
import {
  formatDate,
  formatDateTime,
  safeHttpUrl,
} from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/kyc/format";
import { VerificationBadge } from "@/components/web/organization/verification-badge";
import { countryName } from "@/lib/countries";
import {
  ORGANIZATION_REQUIREMENTS,
  ORGANIZATION_REVIEW_CHECK_LABELS,
  getDocumentSlots,
  type OrganizationReviewCheck,
} from "@/lib/organization-verification";
import { EDD_REASON_LABELS, EXPECTED_TIMELINE_LABELS } from "@/lib/risk";

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

// The owner entries keep "Name (BASIS)" as their note; say it in words.
const OWNER_BASIS_WORDS: Record<string, string> = {
  OWNERSHIP: "owns it",
  CONTROL: "controls it",
  SENIOR_MANAGING_OFFICIAL: "senior managing official",
};
function ownerNote(note: string | null): string {
  const match = note?.match(/^(.*) \(([A-Z_]+)\)$/);
  if (!match) return "someone";
  return `${match[1]} (${OWNER_BASIS_WORDS[match[2]] ?? match[2].toLowerCase()})`;
}

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
    case "ORGANIZATION_ESCALATED":
      return `${actor} passed it to the MLRO`;
    case "BENEFICIAL_OWNER_ADDED":
      return `${actor} added ${ownerNote(entry.note)} to the owners`;
    case "BENEFICIAL_OWNER_REMOVED":
      return `${actor} removed ${ownerNote(entry.note)} from the owners`;
    case "RISK_RATED":
      return `${actor} rated the risk`;
    case "RISK_OVERRIDDEN":
      return `${actor} changed the risk rating`;
    case "EDD_FLAGGED":
      return `${actor} required enhanced due diligence`;
    case "EDD_RECORDED":
      return `${actor} recorded enhanced due diligence`;
    // Payout holds belong to a fundraiser, so they are never in an
    // organization's history; this only keeps the switch total.
    default:
      return `${actor} recorded an action`;
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
  const escalateOrganization = useMutation(api.admin.escalateOrganization);
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [escalateOpen, setEscalateOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState<
    ReadonlySet<OrganizationReviewCheck>
  >(new Set());
  // What the reviewer picked. Anything not picked yet falls back to the
  // defaults below, which depend on what the organization declared.
  const [picked, setPicked] = React.useState<Partial<OrganizationFindings>>({});
  const [eddDraft, setEddDraft] = React.useState<EddDraft>(EMPTY_EDD);

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
  const declared = data.declarations;
  const findings: OrganizationFindings = {
    pepOutcome: data.anyPepDeclared ? "PEP" : (picked.pepOutcome ?? "NOT_PEP"),
    behaviour: picked.behaviour ?? "LOW",
    complexStructure: picked.complexStructure ?? false,
    highRiskSector: picked.highRiskSector ?? false,
  };
  // The rating the server will arrive at, from what the organization declared,
  // who it listed and what the reviewer found. Same rules, same file.
  const assessment =
    isPending && declared
      ? previewOrganizationRisk({
          expectedAmountKes: declared.expectedAmountKes,
          registeredCountry: declared.registeredCountry,
          findings,
          owners: data.owners,
        })
      : null;
  const needsMlro = assessment?.requiresEdd === true && !data.viewerIsMlro;
  const eddProblem =
    assessment?.requiresEdd && data.viewerIsMlro
      ? eddDraftProblem(eddDraft, assessment.isPep)
      : null;
  const allConfirmed = data.requiredChecks.every((check) =>
    confirmed.has(check),
  );
  const canVerifyNow =
    data.canVerify &&
    assessment !== null &&
    data.ownersProblem === null &&
    allConfirmed &&
    !needsMlro &&
    !eddProblem;

  function toggle(check: OrganizationReviewCheck, checked: boolean) {
    setConfirmed((previous) => {
      const next = new Set(previous);
      if (checked) next.add(check);
      else next.delete(check);
      return next;
    });
  }

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
          {isPending && data.escalatedAt && (
            <Badge variant="outline">With the MLRO</Badge>
          )}
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

      <Card>
        <CardHeader>
          <CardTitle>What it declared</CardTitle>
          <CardDescription>
            Staff only. Never tell the organization about its rating or any
            checks made because of it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {declared ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail
                  label="Registered in"
                  value={countryName(declared.registeredCountry)}
                />
                <Detail
                  label="Expects to raise"
                  value={formatKes(declared.expectedAmountKes)}
                />
                <Detail
                  label="Over"
                  value={
                    declared.expectedTimeline
                      ? EXPECTED_TIMELINE_LABELS[declared.expectedTimeline]
                      : null
                  }
                />
                <Detail
                  label="Senior public position among its people"
                  value={declared.pepDeclared ? "Yes" : "No"}
                />
                <Detail label="Who and what role" value={declared.pepDetails} />
                <Detail
                  label="Confirmed its purpose isn't a prohibited one"
                  value={declared.prohibitedActivitiesAcknowledged ? "Yes" : "No"}
                />
              </dl>
              {data.anyPepDeclared && (
                <p role="alert" className="text-destructive">
                  Someone who runs, owns or controls this organization says
                  they hold a senior public position, so it is rated High and
                  the MLRO has to approve it.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              This application was made before we asked where the organization
              is registered, what it expects to raise and who owns it.
            </p>
          )}
        </CardContent>
      </Card>

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

      <OwnersPanel
        organizationId={data._id}
        owners={data.owners}
        problem={isPending || data.canRate ? data.ownersProblem : null}
        lockedReason={data.ownersLocked}
      />

      {isPending && !data.verifyBlocked && assessment && (
        <Card>
          <CardHeader>
            <CardTitle>Risk check</CardTitle>
            <CardDescription>
              Screen the organization and the people listed above, then say
              what you found. The rating comes from this and from what it
              declared. Staff only: never tell the organization about it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <OrganizationFindingsFields
              declaredPep={data.anyPepDeclared}
              value={findings}
              onChange={setPicked}
              idPrefix="verify"
            />
            <RiskPreview assessment={assessment} />

            {needsMlro && (
              <p role="alert" className="text-sm text-destructive">
                Only the MLRO can verify this one (
                {assessment.eddReasons
                  .map((reason) => EDD_REASON_LABELS[reason])
                  .join("; ")}
                ). Pass it on, or reject it if it can&apos;t go ahead.
              </p>
            )}

            {assessment.requiresEdd && data.viewerIsMlro && (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  Enhanced due diligence record
                </p>
                <EddFields
                  draft={eddDraft}
                  onChange={setEddDraft}
                  isPep={assessment.isPep}
                  idPrefix="verify-edd"
                />
                {eddProblem && (
                  <p className="text-xs text-muted-foreground">{eddProblem}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
            {isPending && data.verifyBlocked && (
              <p role="alert" className="text-destructive">
                {data.verifyBlocked}
              </p>
            )}
            {isPending && !data.verifyBlocked && data.ownersProblem && (
              <p role="alert" className="text-destructive">
                {data.ownersProblem}
              </p>
            )}
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
                {!data.verifyBlocked && (
                  <ul className="space-y-3">
                    {data.requiredChecks.map((check) => {
                      const id = `org-check-${check}`;
                      return (
                        <li key={check} className="flex items-start gap-3">
                          <Checkbox
                            id={id}
                            checked={confirmed.has(check)}
                            onCheckedChange={(checked) =>
                              toggle(check, checked)
                            }
                            className="mt-0.5"
                          />
                          <Label
                            htmlFor={id}
                            className="font-normal leading-snug"
                          >
                            {ORGANIZATION_REVIEW_CHECK_LABELS[check]}
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!canVerifyNow}
                    onClick={() => setVerifyOpen(true)}
                  >
                    Verify organization
                  </Button>
                  {!data.viewerIsMlro && !data.escalatedAt && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={data.verifyBlocked !== null}
                      onClick={() => setEscalateOpen(true)}
                    >
                      Pass to the MLRO
                    </Button>
                  )}
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
              <div className="space-y-2">
                <p>
                  Verified
                  {data.verifiedAt && ` on ${formatDate(data.verifiedAt)}`}.
                </p>
                {data.confirmedChecks.length > 0 && (
                  <>
                    <p className="text-muted-foreground">Checks confirmed:</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {data.confirmedChecks.map((check) => (
                        <li key={check}>
                          {ORGANIZATION_REVIEW_CHECK_LABELS[check]}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
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

      {data.riskProfile && (
        <OrganizationRiskProfileCard
          organizationId={data._id}
          profile={data.riskProfile}
          canManage={data.canManageRisk}
        />
      )}
      {data.canRate && (
        <RateOrganizationCard
          organizationId={data._id}
          owners={data.owners}
          ownersProblem={data.ownersProblem}
          declaredPep={data.anyPepDeclared}
        />
      )}

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
          await verifyOrganization({
            organizationId: data._id,
            confirmedChecks: [...confirmed],
            pepOutcome: findings.pepOutcome,
            behaviour: findings.behaviour,
            complexStructure: findings.complexStructure,
            highRiskSector: findings.highRiskSector,
            ...(assessment?.requiresEdd
              ? { edd: eddArgs(eddDraft, assessment.isPep) }
              : {}),
          });
          toast.success(`${data.name} is now verified.`);
        }}
      />

      <DecisionDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        title={`Pass ${data.name} to the MLRO?`}
        description="It stays in the queue, marked for the MLRO. The owner still sees it as being reviewed. Say what you want the MLRO to look at."
        confirmLabel="Pass it on"
        noteLabel="For the MLRO"
        notePlaceholder="e.g. One owner lives in the UK and the registry shows a second company holding 40%."
        minNoteLength={10}
        onConfirm={async (note) => {
          await escalateOrganization({ organizationId: data._id, note });
          toast.success("Passed to the MLRO.");
        }}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${data.name}?`}
        description="The owner will see your reason on their dashboard and can apply again. Say only what they need to fix. Never mention suspicion, checks or compliance concerns."
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
