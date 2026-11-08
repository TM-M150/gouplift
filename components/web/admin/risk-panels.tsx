"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { errorMessage, formatDate } from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/kyc/format";
import { HOME_COUNTRY, countryName, countryOptions } from "@/lib/countries";
import {
  BEHAVIOUR_LABELS,
  EDD_REASON_LABELS,
  FACTOR_LABELS,
  PEP_OUTCOMES,
  PEP_OUTCOME_LABELS,
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  assessRisk,
  eddRecordProblem,
  type PepOutcome,
  type RiskAssessment,
  type RiskFactors,
  type RiskLevel,
} from "@/lib/risk";
import { MAX_EXPECTED_AMOUNT_KES } from "@/lib/validations/kyc";

// The risk side of reviewing an individual fundraiser (AML policy 4.3, 7, 8):
// what the reviewer decides before approving, what the rating comes to, and the
// MLRO's tools afterwards. The rules themselves are in lib/risk.ts, which the
// server also uses, so what is previewed here is what gets saved.

type ReviewData = NonNullable<
  FunctionReturnType<typeof api.kycReview.getKycForReview>
>;
export type RiskProfileView = NonNullable<ReviewData["riskProfile"]>;

const LEVEL_VARIANT: Record<
  RiskLevel,
  "secondary" | "outline" | "destructive"
> = {
  LOW: "secondary",
  MEDIUM: "outline",
  HIGH: "destructive",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge variant={LEVEL_VARIANT[level]}>
      {RISK_LEVEL_LABELS[level]} risk
    </Badge>
  );
}

function isPepOutcome(value: unknown): value is PepOutcome {
  return (PEP_OUTCOMES as readonly unknown[]).includes(value);
}
function isRiskLevel(value: unknown): value is RiskLevel {
  return (RISK_LEVELS as readonly unknown[]).includes(value);
}

export function FactorList({ factors }: { factors: RiskFactors }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(FACTOR_LABELS) as Array<keyof RiskFactors>).map((key) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <dt className="text-sm text-muted-foreground">
            {FACTOR_LABELS[key]}
          </dt>
          <dd>
            <RiskBadge level={factors[key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Before approving: what the reviewer found ------------------------------

export interface Screening {
  pepOutcome: PepOutcome;
  behaviour: RiskLevel;
}

export function ScreeningFields({
  declaredPep,
  value,
  onChange,
}: {
  declaredPep: boolean;
  value: Screening;
  onChange: (next: Screening) => void;
}) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">PEP screening result</legend>
        {declaredPep && (
          <p className="text-xs text-muted-foreground">
            The applicant said they are a PEP, so this stays as a PEP.
          </p>
        )}
        <RadioGroup
          value={value.pepOutcome}
          onValueChange={(next) =>
            isPepOutcome(next) && onChange({ ...value, pepOutcome: next })
          }
          className="gap-2"
        >
          {PEP_OUTCOMES.map((outcome) => (
            <label
              key={outcome}
              className="flex cursor-pointer items-start gap-3 text-sm"
            >
              <RadioGroupItem
                value={outcome}
                className="mt-0.5"
                disabled={declaredPep && outcome === "NOT_PEP"}
              />
              {PEP_OUTCOME_LABELS[outcome]}
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          What you saw of the applicant
        </legend>
        <RadioGroup
          value={value.behaviour}
          onValueChange={(next) =>
            isRiskLevel(next) && onChange({ ...value, behaviour: next })
          }
          className="gap-2"
        >
          {RISK_LEVELS.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-start gap-3 text-sm"
            >
              <RadioGroupItem value={level} className="mt-0.5" />
              {BEHAVIOUR_LABELS[level]}
            </label>
          ))}
        </RadioGroup>
      </fieldset>
    </div>
  );
}

export function RiskPreview({ assessment }: { assessment: RiskAssessment }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Rating if approved</span>
        <RiskBadge level={assessment.rating} />
      </div>
      <FactorList factors={assessment.factors} />
      {assessment.requiresEdd && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Enhanced due diligence is needed:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {assessment.eddReasons.map((reason) => (
              <li key={reason}>{EDD_REASON_LABELS[reason]}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- The enhanced due diligence record --------------------------------------

export interface EddDraft {
  sourceOfFunds: string;
  sourceOfWealth: string;
  note: string;
}
export const EMPTY_EDD: EddDraft = {
  sourceOfFunds: "",
  sourceOfWealth: "",
  note: "",
};

/** What to tell the MLRO is still missing, or null when the record is enough. */
export function eddDraftProblem(draft: EddDraft, isPep: boolean) {
  return eddRecordProblem({
    sourceOfFunds: draft.sourceOfFunds,
    sourceOfWealth: draft.sourceOfWealth,
    isPep,
  });
}

/** The mutation argument for a draft. Blank optional fields are left out. */
export function eddArgs(draft: EddDraft, isPep: boolean) {
  return {
    sourceOfFunds: draft.sourceOfFunds.trim(),
    ...(isPep && draft.sourceOfWealth.trim()
      ? { sourceOfWealth: draft.sourceOfWealth.trim() }
      : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
}

export function EddFields({
  draft,
  onChange,
  isPep,
  idPrefix,
}: {
  draft: EddDraft;
  onChange: (next: EddDraft) => void;
  isPep: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-funds`}>Source of funds</Label>
        <Textarea
          id={`${idPrefix}-funds`}
          value={draft.sourceOfFunds}
          onChange={(event) =>
            onChange({ ...draft, sourceOfFunds: event.target.value })
          }
          placeholder="Where the money being raised comes from, and how you confirmed it."
          className="min-h-20"
          maxLength={1000}
        />
      </div>
      {isPep && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-wealth`}>Source of wealth</Label>
          <Textarea
            id={`${idPrefix}-wealth`}
            value={draft.sourceOfWealth}
            onChange={(event) =>
              onChange({ ...draft, sourceOfWealth: event.target.value })
            }
            placeholder="How the person came by their wealth, and how you confirmed it."
            className="min-h-20"
            maxLength={1000}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-note`}>
          Other checks done{" "}
          <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`${idPrefix}-note`}
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="e.g. Called the beneficiary, checked adverse media, verified the hospital bill."
          className="min-h-16"
          maxLength={1000}
        />
      </div>
    </div>
  );
}

// ---- After approving: the profile and the MLRO's tools ----------------------

export function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{value}</dd>
    </div>
  );
}

/** What the MLRO can do to a rating. Individuals and organizations each have their own mutations. */
export interface RiskProfileActions {
  override: (rating: RiskLevel, reason: string) => Promise<unknown>;
  flagForEdd: (reason: string) => Promise<unknown>;
  recordEdd: (edd: ReturnType<typeof eddArgs>) => Promise<unknown>;
}

export function RiskProfileCard({
  submissionId,
  profile,
  canManage,
}: {
  submissionId: ReviewData["_id"];
  profile: RiskProfileView;
  canManage: boolean;
}) {
  const overrideRating = useMutation(api.customerRisk.overrideRiskRating);
  const flagForEdd = useMutation(api.customerRisk.flagForEdd);
  const recordEdd = useMutation(api.customerRisk.recordEdd);

  return (
    <RiskProfileCardBase
      profile={profile}
      canManage={canManage}
      actions={{
        override: (rating, reason) =>
          overrideRating({ submissionId, rating, reason }),
        flagForEdd: (reason) => flagForEdd({ submissionId, reason }),
        recordEdd: (edd) => recordEdd({ submissionId, edd }),
      }}
    />
  );
}

export function RiskProfileCardBase({
  profile,
  canManage,
  actions,
  countryLabel = "Lives in",
  customerNoun = "fundraiser",
  extraDetails,
}: {
  profile: RiskProfileView;
  canManage: boolean;
  actions: RiskProfileActions;
  /** "Lives in" for a person, "Registered in" for an organization. */
  countryLabel?: string;
  /** Who the warning says not to tell: "fundraiser" or "organization". */
  customerNoun?: string;
  /** More rows for the details grid, for what only this kind of customer has. */
  extraDetails?: React.ReactNode;
}) {
  const [overrideTo, setOverrideTo] = React.useState<RiskLevel | null>(null);
  const [flagOpen, setFlagOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<EddDraft>(EMPTY_EDD);
  const [recording, setRecording] = React.useState(false);
  const [recordError, setRecordError] = React.useState<string | null>(null);

  const isPep = profile.pepOutcome === "PEP";
  // A PEP is always High, so there is nothing to change it to.
  const overrideOptions = isPep
    ? []
    : RISK_LEVELS.filter((level) => level !== profile.rating);

  async function handleRecord(event: React.FormEvent) {
    event.preventDefault();
    setRecordError(null);
    const problem = eddDraftProblem(draft, isPep);
    if (problem) {
      setRecordError(problem);
      return;
    }
    setRecording(true);
    try {
      await actions.recordEdd(eddArgs(draft, isPep));
      setDraft(EMPTY_EDD);
      toast.success("Enhanced due diligence recorded.");
    } catch (err) {
      setRecordError(errorMessage(err));
    } finally {
      setRecording(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Risk rating</CardTitle>
          <RiskBadge level={profile.rating} />
          {isPep && <Badge variant="destructive">PEP</Badge>}
          {profile.mlroFlagged && (
            <Badge variant="outline">Flagged by MLRO</Badge>
          )}
        </div>
        <CardDescription>
          Staff only. Never tell the {customerNoun} about their rating or any
          checks made because of it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <FactorList factors={profile.factors} />

        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail
            label={countryLabel}
            value={countryName(profile.residenceCountry)}
          />
          <Detail
            label="Expects to raise"
            value={formatKes(profile.expectedAmountKes)}
          />
          <Detail
            label="Rated"
            value={`${formatDate(profile.ratedAt)}${profile.ratedByName ? ` by ${profile.ratedByName}` : ""}`}
          />
          <Detail
            label="Next review due"
            value={formatDate(profile.nextReviewDue)}
          />
          {extraDetails}
          {profile.overrideRating && (
            <Detail
              label={`Rating changed by the MLRO (from ${RISK_LEVEL_LABELS[profile.computedRating]})`}
              value={profile.overrideReason}
            />
          )}
        </dl>

        {profile.eddReasons.length > 0 && (
          <div className="space-y-3 rounded-xl border p-4">
            <p className="font-medium">
              Enhanced due diligence:{" "}
              {profile.eddOutstanding ? (
                <span className="text-destructive">
                  not recorded. Payouts are blocked.
                </span>
              ) : (
                "recorded"
              )}
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {profile.eddReasons.map((reason) => (
                <li key={reason}>{EDD_REASON_LABELS[reason]}</li>
              ))}
            </ul>
            {!profile.eddOutstanding && (
              <dl className="grid gap-3">
                <Detail
                  label={`Approved${profile.eddCompletedByName ? ` by ${profile.eddCompletedByName}` : ""}${profile.eddCompletedAt ? ` on ${formatDate(profile.eddCompletedAt)}` : ""}`}
                  value={null}
                />
                <Detail label="Source of funds" value={profile.sourceOfFunds} />
                <Detail
                  label="Source of wealth"
                  value={profile.sourceOfWealth}
                />
                <Detail label="Other checks" value={profile.eddNote} />
              </dl>
            )}
          </div>
        )}

        {canManage && profile.eddOutstanding && (
          <form
            onSubmit={handleRecord}
            className="space-y-4 rounded-xl border p-4"
          >
            <p className="font-medium">Record enhanced due diligence</p>
            <EddFields
              draft={draft}
              onChange={setDraft}
              isPep={isPep}
              idPrefix="record-edd"
            />
            {recordError && (
              <p role="alert" className="text-destructive">
                {recordError}
              </p>
            )}
            <Button type="submit" disabled={recording}>
              {recording ? "Saving…" : "Approve and record"}
            </Button>
          </form>
        )}

        {canManage && (
          <div className="flex flex-wrap gap-2">
            {overrideOptions.map((level) => (
              <Button
                key={level}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOverrideTo(level)}
              >
                Change to {RISK_LEVEL_LABELS[level]}
              </Button>
            ))}
            {!profile.mlroFlagged && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFlagOpen(true)}
              >
                Require enhanced due diligence
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <DecisionDialog
        open={overrideTo !== null}
        onOpenChange={(open) => !open && setOverrideTo(null)}
        title={`Change the rating to ${overrideTo ? RISK_LEVEL_LABELS[overrideTo] : ""}?`}
        description="This replaces the rating the factors give. A higher rating means enhanced due diligence and stops payouts until it is recorded. Your reason is kept with the audit log."
        confirmLabel="Change rating"
        noteLabel="Reason"
        notePlaceholder="e.g. Adverse media about the organizer of the campaign."
        minNoteLength={10}
        onConfirm={async (reason) => {
          if (!overrideTo) return;
          await actions.override(overrideTo, reason);
          toast.success("The rating was changed.");
        }}
      />

      <DecisionDialog
        open={flagOpen}
        onOpenChange={setFlagOpen}
        title="Require enhanced due diligence?"
        description="Payouts stop until you record the source of funds. The fundraiser isn't told."
        confirmLabel="Require it"
        noteLabel="Reason"
        notePlaceholder="e.g. Donations are coming from many unrelated accounts."
        minNoteLength={10}
        onConfirm={async (reason) => {
          await actions.flagForEdd(reason);
          toast.success("Enhanced due diligence is now required.");
        }}
      />
    </Card>
  );
}

// ---- Someone approved before risk was rated ---------------------------------

export function RateCustomerCard({
  submissionId,
  kycTier,
}: {
  submissionId: ReviewData["_id"];
  kycTier: ReviewData["kycTier"];
}) {
  const rateCustomer = useMutation(api.customerRisk.rateCustomer);
  const countries = React.useMemo(() => countryOptions(), []);
  const countryItems = React.useMemo(
    () => Object.fromEntries(countries.map((c) => [c.code, c.name])),
    [countries],
  );

  const [country, setCountry] = React.useState(HOME_COUNTRY);
  const [amount, setAmount] = React.useState("");
  const [screening, setScreening] = React.useState<Screening>({
    pepOutcome: "NOT_PEP",
    behaviour: "LOW",
  });
  const [draft, setDraft] = React.useState<EddDraft>(EMPTY_EDD);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const amountKes = Number(amount.replace(/[,\s]/g, ""));
  const amountValid =
    Number.isInteger(amountKes) &&
    amountKes >= 1 &&
    amountKes <= MAX_EXPECTED_AMOUNT_KES;
  const assessment = amountValid
    ? assessRisk({
        expectedAmountKes: amountKes,
        residenceCountry: country,
        pepOutcome: screening.pepOutcome,
        behaviour: screening.behaviour,
        tier: kycTier >= 2 ? 2 : 1,
      })
    : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!assessment) {
      setError("Enter the amount they expect to raise, in whole shillings.");
      return;
    }
    if (assessment.requiresEdd) {
      const problem = eddDraftProblem(draft, assessment.isPep);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setSaving(true);
    try {
      await rateCustomer({
        submissionId,
        residenceCountry: country,
        expectedAmountKes: amountKes,
        ...screening,
        ...(assessment.requiresEdd
          ? { edd: eddArgs(draft, assessment.isPep) }
          : {}),
      });
      toast.success("They have been rated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate this customer</CardTitle>
        <CardDescription>
          They were verified before risk was rated, so they can&apos;t be paid
          out until you rate them. Fill in what the application would have said.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5 text-sm">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rate-country">Lives in</Label>
              <Select
                items={countryItems}
                value={country}
                onValueChange={(value) => value && setCountry(value)}
              >
                <SelectTrigger id="rate-country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {countries.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-amount">Expects to raise (KES)</Label>
              <Input
                id="rate-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder="50,000"
                autoComplete="off"
              />
            </div>
          </div>

          <ScreeningFields
            declaredPep={false}
            value={screening}
            onChange={setScreening}
          />

          {assessment && <RiskPreview assessment={assessment} />}

          {assessment?.requiresEdd && (
            <EddFields
              draft={draft}
              onChange={setDraft}
              isPep={assessment.isPep}
              idPrefix="rate-edd"
            />
          )}

          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save rating"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
