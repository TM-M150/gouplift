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
  EddFields,
  EMPTY_EDD,
  RateCustomerCard,
  RiskPreview,
  RiskProfileCard,
  ScreeningFields,
  eddArgs,
  eddDraftProblem,
  type EddDraft,
  type Screening,
} from "@/components/web/admin/risk-panels";
import { formatKes } from "@/components/web/kyc/format";
import { countryName } from "@/lib/countries";
import {
  EDD_REASON_LABELS,
  EXPECTED_TIMELINE_LABELS,
  assessRisk,
  type PepOutcome,
} from "@/lib/risk";
import {
  KYC_DOCUMENT_TYPES,
  KYC_ID_TYPE_LABELS,
  KYC_REVIEW_CHECK_LABELS,
  getKycDocumentSlots,
  tierPayoutLimitKes,
  type KycDocumentType,
  type KycReviewCheck,
} from "@/lib/kyc";

type ReviewData = NonNullable<
  FunctionReturnType<typeof api.kycReview.getKycForReview>
>;
type HistoryEntry = ReviewData["history"][number];

const STATUS_DISPLAY: Record<
  ReviewData["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  PENDING_REVIEW: { label: "Waiting for review", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "default" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

// Names for the files in the review. A passport's "front" is its photo page,
// so the label depends on the ID type the applicant chose.
function documentLabels(idType: ReviewData["details"]["idType"]) {
  const labels = new Map<KycDocumentType, string>();
  for (const type of KYC_DOCUMENT_TYPES) labels.set(type, type);
  const slots = [
    ...getKycDocumentSlots(1, idType ?? "NATIONAL_ID"),
    ...getKycDocumentSlots(2),
  ];
  for (const slot of slots) labels.set(slot.documentType, slot.label);
  return labels;
}

function describeHistory(entry: HistoryEntry, tier: number): string {
  const actor = entry.actorName ?? "Someone";
  switch (entry.action) {
    case "KYC_APPROVED":
      return `${actor} approved Level ${tier}`;
    case "KYC_REJECTED":
      return `${actor} rejected the application`;
    case "KYC_ESCALATED":
      return `${actor} passed it to the MLRO`;
    case "RISK_RATED":
      return `${actor} rated the risk`;
    case "RISK_OVERRIDDEN":
      return `${actor} changed the risk rating`;
    case "EDD_FLAGGED":
      return `${actor} required enhanced due diligence`;
    case "EDD_RECORDED":
      return `${actor} recorded enhanced due diligence`;
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

export function KycReview({ submissionId }: { submissionId: string }) {
  const data = useQuery(api.kycReview.getKycForReview, { submissionId });
  const approveKyc = useMutation(api.kycReview.approveKyc);
  const rejectKyc = useMutation(api.kycReview.rejectKyc);
  const escalateKyc = useMutation(api.kycReview.escalateKyc);

  const [confirmed, setConfirmed] = React.useState<
    ReadonlySet<KycReviewCheck>
  >(new Set());
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [escalateOpen, setEscalateOpen] = React.useState(false);
  // What the reviewer picked. Anything not picked yet falls back to the
  // defaults below, which depend on what the applicant declared.
  const [picked, setPicked] = React.useState<Partial<Screening>>({});
  const [eddDraft, setEddDraft] = React.useState<EddDraft>(EMPTY_EDD);

  if (data === undefined) return <ReviewSkeleton />;

  if (data === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          That application couldn&apos;t be found.
        </p>
        <Link
          href="/admin/verification"
          className="text-sm underline underline-offset-4"
        >
          Back to the queue
        </Link>
      </div>
    );
  }

  const labels = documentLabels(data.details.idType);
  const documents = [...data.documents].sort(
    (a, b) =>
      KYC_DOCUMENT_TYPES.indexOf(a.documentType) -
      KYC_DOCUMENT_TYPES.indexOf(b.documentType),
  );

  const status = STATUS_DISPLAY[data.status];
  const isPending = data.status === "PENDING_REVIEW";
  const allConfirmed = data.requiredChecks.every((check) =>
    confirmed.has(check),
  );
  const applicantName =
    data.details.legalName ?? data.applicant?.name ?? "this applicant";

  // The rating the server will arrive at, from what the applicant declared and
  // what the reviewer found. Same rules, same file (lib/risk.ts).
  const declared = data.declarations;
  const declaredPep = declared?.pepDeclared ?? false;
  const screening: Screening = {
    pepOutcome: (declaredPep ? "PEP" : (picked.pepOutcome ?? "NOT_PEP")) as PepOutcome,
    behaviour: picked.behaviour ?? "LOW",
  };
  const assessment =
    isPending && data.requestedTier === 1 && declared
      ? assessRisk({
          expectedAmountKes: declared.expectedAmountKes,
          residenceCountry: declared.residenceCountry,
          pepOutcome: screening.pepOutcome,
          behaviour: screening.behaviour,
          tier: 1,
        })
      : null;
  const needsMlro = assessment?.requiresEdd === true && !data.viewerIsMlro;
  const eddProblem =
    assessment?.requiresEdd && data.viewerIsMlro
      ? eddDraftProblem(eddDraft, assessment.isPep)
      : null;
  const canApprove =
    data.canDecide &&
    !data.approveBlocked &&
    allConfirmed &&
    !needsMlro &&
    !eddProblem;

  function toggle(check: KycReviewCheck, checked: boolean) {
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
          href="/admin/verification"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to the queue
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{applicantName}</h1>
          <Badge variant="secondary">Level {data.requestedTier}</Badge>
          <Badge variant={status.variant}>{status.label}</Badge>
          {isPending && data.escalatedAt && (
            <Badge variant="outline">With the MLRO</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Submitted {formatDate(data.submittedAt)}
        </p>
      </div>

      {data.sharedIdentifiers.length > 0 && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive/50 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            The same ID or phone number is on another account
          </p>
          <ul className="space-y-1">
            {data.sharedIdentifiers.map((match) => (
              <li key={`${match.submissionId}-${match.matchedOn}`}>
                {match.matchedOn === "ID_NUMBER" ? "ID number" : "Phone number"}{" "}
                also used by{" "}
                <Link
                  href={`/admin/verification/${match.submissionId}`}
                  className="underline underline-offset-4"
                >
                  {match.userName ?? "an unknown account"}
                </Link>{" "}
                (Level {match.requestedTier},{" "}
                {STATUS_DISPLAY[match.status].label.toLowerCase()},{" "}
                {formatDate(match.submittedAt)})
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Don&apos;t tell the applicant about this. If it looks wrong, raise
            it with the compliance officer.
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details entered</CardTitle>
            <CardDescription>Compare these with the documents.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Detail label="Full name" value={data.details.legalName} />
              <Detail
                label="ID type"
                value={
                  data.details.idType
                    ? KYC_ID_TYPE_LABELS[data.details.idType]
                    : null
                }
              />
              <Detail label="ID number" value={data.details.idNumber} />
              <Detail label="Mobile number" value={data.details.phoneNumber} />
              <Detail
                label="What the money is for"
                value={data.details.campaignPurpose}
              />
              <Detail label="KRA PIN" value={data.details.kraPin} />
              {declared && (
                <>
                  <Detail
                    label="Lives in"
                    value={countryName(declared.residenceCountry)}
                  />
                  <Detail
                    label="Expects to raise"
                    value={`${formatKes(declared.expectedAmountKes)}${declared.expectedTimeline ? `, ${EXPECTED_TIMELINE_LABELS[declared.expectedTimeline].toLowerCase()}` : ""}`}
                  />
                  <Detail
                    label="Senior public position (PEP)"
                    value={
                      declared.pepDeclared
                        ? `Yes. ${declared.pepDetails ?? ""}`.trim()
                        : "No"
                    }
                  />
                  <Detail
                    label="Confirmed the money isn't for a prohibited purpose"
                    value={
                      declared.prohibitedActivitiesAcknowledged ? "Yes" : "No"
                    }
                  />
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              {data.identityOnFile
                ? "The identity this application builds on."
                : "The GoUplift account that applied."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Detail label="Account name" value={data.applicant?.name} />
              <Detail label="Email" value={data.applicant?.email} />
              {data.identityOnFile && (
                <>
                  <Detail
                    label="Name on verified ID"
                    value={data.identityOnFile.legalName}
                  />
                  <Detail
                    label="Verified ID number"
                    value={data.identityOnFile.idNumber}
                  />
                  <Detail
                    label="Verified mobile number"
                    value={data.identityOnFile.phoneNumber}
                  />
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">
            Open each file and check it against the details above.
          </p>
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents were uploaded.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {documents.map((doc) => (
              <ReviewFileCard
                key={doc._id}
                file={doc}
                label={labels.get(doc.documentType) ?? doc.documentType}
              />
            ))}
          </div>
        )}
      </section>

      {isPending && data.canDecide && assessment && (
        <Card>
          <CardHeader>
            <CardTitle>Risk check</CardTitle>
            <CardDescription>
              Screen the applicant, then say what you found. The rating comes
              from this and from what they declared. Staff only: never tell the
              applicant about it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ScreeningFields
              declaredPep={declaredPep}
              value={screening}
              onChange={setPicked}
            />
            <RiskPreview assessment={assessment} />

            {needsMlro && (
              <p role="alert" className="text-sm text-destructive">
                Only the MLRO can approve this one (
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
                  idPrefix="approve-edd"
                />
                {eddProblem && (
                  <p className="text-xs text-muted-foreground">{eddProblem}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
          {isPending && data.canDecide && (
            <CardDescription>
              Confirm each check you have done, then approve. Approving Level{" "}
              {data.requestedTier} allows payouts up to{" "}
              {formatKes(tierPayoutLimitKes(data.requestedTier))} in total.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          {isPending && data.decisionBlocked && (
            <p role="alert" className="text-destructive">
              {data.decisionBlocked}
            </p>
          )}
          {isPending && !data.decisionBlocked && data.approveBlocked && (
            <p role="alert" className="text-destructive">
              {data.approveBlocked}
            </p>
          )}

          {isPending && data.canDecide && (
            <ul className="space-y-3">
              {data.requiredChecks.map((check) => {
                const id = `kyc-check-${check}`;
                return (
                  <li key={check} className="flex items-start gap-3">
                    <Checkbox
                      id={id}
                      checked={confirmed.has(check)}
                      onCheckedChange={(checked) => toggle(check, checked)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="font-normal leading-snug">
                      {KYC_REVIEW_CHECK_LABELS[check]}
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
                disabled={!canApprove}
                onClick={() => setApproveOpen(true)}
              >
                Approve Level {data.requestedTier}
              </Button>
              {!data.viewerIsMlro && !data.escalatedAt && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!data.canDecide}
                  onClick={() => setEscalateOpen(true)}
                >
                  Pass to the MLRO
                </Button>
              )}
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

          {data.status === "APPROVED" && (
            <div className="space-y-2">
              <p>
                Approved
                {data.reviewedByName && ` by ${data.reviewedByName}`}
                {data.reviewedAt && ` on ${formatDate(data.reviewedAt)}`}.
              </p>
              {data.confirmedChecks.length > 0 && (
                <>
                  <p className="text-muted-foreground">Checks confirmed:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {data.confirmedChecks.map((check) => (
                      <li key={check}>{KYC_REVIEW_CHECK_LABELS[check]}</li>
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
                applicant sees this reason:
              </p>
              <p className="text-muted-foreground">
                {data.rejectionReason ?? "No reason recorded."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {data.riskProfile && (
        <RiskProfileCard
          submissionId={data._id}
          profile={data.riskProfile}
          canManage={data.canManageRisk}
        />
      )}
      {data.canRate && (
        <RateCustomerCard submissionId={data._id} kycTier={data.kycTier} />
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
                <p>{describeHistory(entry, data.requestedTier)}</p>
                {entry.note && entry.action !== "KYC_APPROVED" && (
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
        title={`Approve Level ${data.requestedTier} for ${applicantName}?`}
        description={`They can then be paid out up to ${formatKes(tierPayoutLimitKes(data.requestedTier))} in total. There is no way to undo this from the admin page yet.`}
        confirmLabel="Approve"
        onConfirm={async () => {
          await approveKyc({
            submissionId: data._id,
            confirmedChecks: [...confirmed],
            ...(assessment
              ? {
                  pepOutcome: screening.pepOutcome,
                  behaviour: screening.behaviour,
                  ...(assessment.requiresEdd
                    ? { edd: eddArgs(eddDraft, assessment.isPep) }
                    : {}),
                }
              : {}),
          });
          toast.success(`${applicantName} is verified to Level ${data.requestedTier}.`);
        }}
      />

      <DecisionDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        title={`Pass ${applicantName}'s application to the MLRO?`}
        description="It stays in the queue, marked for the MLRO. The applicant still sees it as being reviewed. Say what you want the MLRO to look at."
        confirmLabel="Pass it on"
        noteLabel="For the MLRO"
        notePlaceholder="e.g. Lives in the UK and the campaign is for a relative in Mombasa."
        minNoteLength={10}
        onConfirm={async (note) => {
          await escalateKyc({ submissionId: data._id, note });
          toast.success("Passed to the MLRO.");
        }}
      />

      <DecisionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${applicantName}'s application?`}
        description="The applicant will see your reason and can apply again. Say only what they need to fix. Never mention suspicion, checks or compliance concerns."
        confirmLabel="Reject"
        destructive
        noteLabel="Reason for the applicant"
        notePlaceholder="e.g. The photo of your ID is too blurry to read. Please upload a clearer one."
        minNoteLength={10}
        onConfirm={async (reason) => {
          await rejectKyc({ submissionId: data._id, reason });
          toast.success("The application was rejected.");
        }}
      />
    </div>
  );
}
