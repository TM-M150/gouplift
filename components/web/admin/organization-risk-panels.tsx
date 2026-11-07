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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Detail,
  EMPTY_EDD,
  EddFields,
  RiskPreview,
  RiskProfileCardBase,
  ScreeningFields,
  eddArgs,
  eddDraftProblem,
  type EddDraft,
  type Screening,
} from "@/components/web/admin/risk-panels";
import { errorMessage } from "@/components/web/admin/utils";
import {
  OwnerFields,
  newOwnerDraft,
  ownersToInput,
  parseAmount,
  type OwnerDraft,
} from "@/components/web/organization/organization-declarations";
import {
  BENEFICIAL_OWNER_BASIS_LABELS,
  MAX_BENEFICIAL_OWNERS,
  hasNoIdentifiedOwner,
} from "@/lib/beneficial-ownership";
import { HOME_COUNTRY, countryName, countryOptions } from "@/lib/countries";
import { KYC_ID_TYPE_LABELS } from "@/lib/kyc";
import { assessOrganizationRisk } from "@/lib/risk";
import { beneficialOwnerSchema } from "@/lib/validations/beneficial-owner";
import { MAX_EXPECTED_AMOUNT_KES } from "@/lib/validations/kyc";

// The organization side of the compliance review (AML policy 4.3, 6, 7, 8): the
// register of who owns or controls it, what the reviewer found, and the MLRO's
// tools once it is rated. The rules are in lib/risk.ts and
// lib/beneficial-ownership.ts, which the server uses too.

type ReviewData = NonNullable<
  FunctionReturnType<typeof api.admin.getOrganizationForReview>
>;
export type OrganizationOwnerView = ReviewData["owners"][number];
export type OrganizationRiskProfileView = NonNullable<ReviewData["riskProfile"]>;

// ---- Who owns or controls it --------------------------------------------

export function OwnersPanel({
  organizationId,
  owners,
  problem,
  lockedReason,
}: {
  organizationId: ReviewData["_id"];
  owners: readonly OrganizationOwnerView[];
  /** What is wrong with the register as it stands, or null. */
  problem: string | null;
  /** Why the register can't be changed, or null when it can. */
  lockedReason: string | null;
}) {
  const addOwner = useMutation(api.beneficialOwners.addBeneficialOwner);
  const removeOwner = useMutation(api.beneficialOwners.removeBeneficialOwner);

  const [draft, setDraft] = React.useState<OwnerDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    const parsed = beneficialOwnerSchema.safeParse(ownersToInput([draft])[0]);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details.");
      return;
    }
    setSaving(true);
    try {
      await addOwner({ organizationId, owner: parsed.data });
      setDraft(null);
      toast.success("Added to the list of owners.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(ownerId: OrganizationOwnerView["_id"]) {
    setError(null);
    setRemoving(ownerId);
    try {
      await removeOwner({ ownerId });
      toast.success("Removed from the list of owners.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who owns or controls it</CardTitle>
        <CardDescription>
          Check each person against their ID and against the registry
          documents. Correct the list if it is wrong: add anyone who was left
          out, remove anyone who isn&apos;t one. ID numbers are for staff only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {owners.length === 0 ? (
          <p className="text-muted-foreground">Nobody is listed.</p>
        ) : (
          <ul className="space-y-3">
            {owners.map((owner) => (
              <li
                key={owner._id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{owner.fullName}</span>
                    {owner.pepDeclared && (
                      <Badge variant="destructive">Says they are a PEP</Badge>
                    )}
                  </div>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <Detail
                      label={KYC_ID_TYPE_LABELS[owner.idType]}
                      value={owner.idNumber}
                    />
                    <Detail
                      label="Lives in"
                      value={countryName(owner.residenceCountry)}
                    />
                    <Detail
                      label="Owns or controls it by"
                      value={`${BENEFICIAL_OWNER_BASIS_LABELS[owner.basis]}${
                        owner.ownershipPercent !== null
                          ? ` (${owner.ownershipPercent}%)`
                          : ""
                      }`}
                    />
                    <Detail label="Role" value={owner.role} />
                  </dl>
                </div>
                {!lockedReason && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={removing !== null}
                    onClick={() => handleRemove(owner._id)}
                  >
                    {removing === owner._id ? "Removing…" : "Remove"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
        {lockedReason && (
          <p className="text-muted-foreground">{lockedReason}</p>
        )}

        {!lockedReason && draft === null && (
          <Button
            type="button"
            variant="outline"
            disabled={owners.length >= MAX_BENEFICIAL_OWNERS}
            onClick={() => {
              setError(null);
              setDraft(newOwnerDraft());
            }}
          >
            Add a person
          </Button>
        )}

        {!lockedReason && draft !== null && (
          <form onSubmit={handleAdd} className="space-y-4">
            <OwnerFields
              index={owners.length}
              owner={draft}
              canRemove={false}
              disabled={saving}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
              onRemove={() => setDraft(null)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Adding…" : "Add to the list"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setDraft(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---- What the reviewer found ----------------------------------------------

export interface OrganizationFindings extends Screening {
  complexStructure: boolean;
  highRiskSector: boolean;
}

export const DEFAULT_FINDINGS: OrganizationFindings = {
  pepOutcome: "NOT_PEP",
  behaviour: "LOW",
  complexStructure: false,
  highRiskSector: false,
};

/** The PEP screening and behaviour questions, plus the two that are about an organization. */
export function OrganizationFindingsFields({
  declaredPep,
  value,
  onChange,
  idPrefix,
}: {
  declaredPep: boolean;
  value: OrganizationFindings;
  onChange: (next: OrganizationFindings) => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-5">
      <ScreeningFields
        declaredPep={declaredPep}
        value={value}
        onChange={(next) => onChange({ ...value, ...next })}
      />
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">About the organization</legend>
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${idPrefix}-complex`}
            checked={value.complexStructure}
            onCheckedChange={(checked) =>
              onChange({ ...value, complexStructure: checked })
            }
            className="mt-0.5"
          />
          <Label
            htmlFor={`${idPrefix}-complex`}
            className="font-normal leading-snug"
          >
            Its ownership is complex: layered companies, trusts, nominees or
            owners in several countries.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${idPrefix}-sector`}
            checked={value.highRiskSector}
            onCheckedChange={(checked) =>
              onChange({ ...value, highRiskSector: checked })
            }
            className="mt-0.5"
          />
          <Label
            htmlFor={`${idPrefix}-sector`}
            className="font-normal leading-snug"
          >
            It works in a sector the MLRO treats as high risk.
          </Label>
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The rating the server will arrive at for what the organization declared and
 * the reviewer found. Same rules, same file (lib/risk.ts).
 */
export function previewOrganizationRisk({
  expectedAmountKes,
  registeredCountry,
  findings,
  owners,
}: {
  expectedAmountKes: number;
  registeredCountry: string;
  findings: OrganizationFindings;
  owners: readonly OrganizationOwnerView[];
}) {
  return assessOrganizationRisk({
    expectedAmountKes,
    residenceCountry: registeredCountry,
    pepOutcome: findings.pepOutcome,
    behaviour: findings.behaviour,
    complexStructure: findings.complexStructure,
    highRiskSector: findings.highRiskSector,
    noOwnerIdentified: hasNoIdentifiedOwner(owners),
  });
}

// ---- After verifying: the profile and the MLRO's tools -----------------------

export function OrganizationRiskProfileCard({
  organizationId,
  profile,
  canManage,
}: {
  organizationId: ReviewData["_id"];
  profile: OrganizationRiskProfileView;
  canManage: boolean;
}) {
  const overrideRisk = useMutation(api.organizationRisk.overrideOrganizationRisk);
  const flagForEdd = useMutation(api.organizationRisk.flagOrganizationForEdd);
  const recordEdd = useMutation(api.organizationRisk.recordOrganizationEdd);

  return (
    <RiskProfileCardBase
      profile={profile}
      canManage={canManage}
      countryLabel="Registered in"
      customerNoun="organization"
      extraDetails={
        <>
          <Detail
            label="Complex ownership"
            value={profile.complexStructure ? "Yes" : null}
          />
          <Detail
            label="High-risk sector"
            value={profile.highRiskSector ? "Yes" : null}
          />
          <Detail
            label="Nobody found to own or control it"
            value={profile.noOwnerIdentified ? "Yes, a senior managing official is listed" : null}
          />
        </>
      }
      actions={{
        override: (rating, reason) =>
          overrideRisk({ organizationId, rating, reason }),
        flagForEdd: (reason) => flagForEdd({ organizationId, reason }),
        recordEdd: (edd) => recordEdd({ organizationId, edd }),
      }}
    />
  );
}

// ---- Verified before risk was rated -----------------------------------------

export function RateOrganizationCard({
  organizationId,
  owners,
  ownersProblem,
  declaredPep,
}: {
  organizationId: ReviewData["_id"];
  owners: readonly OrganizationOwnerView[];
  ownersProblem: string | null;
  declaredPep: boolean;
}) {
  const rateOrganization = useMutation(api.organizationRisk.rateOrganization);
  const countries = React.useMemo(() => countryOptions(), []);
  const countryItems = React.useMemo(
    () => Object.fromEntries(countries.map((c) => [c.code, c.name])),
    [countries],
  );

  const [country, setCountry] = React.useState(HOME_COUNTRY);
  const [amount, setAmount] = React.useState("");
  const [findings, setFindings] =
    React.useState<OrganizationFindings>(DEFAULT_FINDINGS);
  const [draft, setDraft] = React.useState<EddDraft>(EMPTY_EDD);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const amountKes = parseAmount(amount);
  const amountValid =
    amountKes !== undefined &&
    Number.isInteger(amountKes) &&
    amountKes >= 1 &&
    amountKes <= MAX_EXPECTED_AMOUNT_KES;
  const effective: OrganizationFindings = {
    ...findings,
    pepOutcome: declaredPep ? "PEP" : findings.pepOutcome,
  };
  const assessment = amountValid
    ? previewOrganizationRisk({
        expectedAmountKes: amountKes,
        registeredCountry: country,
        findings: effective,
        owners,
      })
    : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (ownersProblem) {
      setError(ownersProblem);
      return;
    }
    if (!assessment || amountKes === undefined) {
      setError("Enter the amount it expects to raise, in whole shillings.");
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
      await rateOrganization({
        organizationId,
        registeredCountry: country,
        expectedAmountKes: amountKes,
        pepOutcome: effective.pepOutcome,
        behaviour: effective.behaviour,
        complexStructure: effective.complexStructure,
        highRiskSector: effective.highRiskSector,
        ...(assessment.requiresEdd
          ? { edd: eddArgs(draft, assessment.isPep) }
          : {}),
      });
      toast.success("The organization has been rated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate this organization</CardTitle>
        <CardDescription>
          It was verified before risk was rated, so it can&apos;t be paid out
          until you rate it. First make sure the list of owners above is right,
          then fill in what the application would have said.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5 text-sm">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rate-org-country">Registered in</Label>
              <Select
                items={countryItems}
                value={country}
                onValueChange={(value) => value && setCountry(value)}
              >
                <SelectTrigger id="rate-org-country" className="w-full">
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
              <Label htmlFor="rate-org-amount">Expects to raise (KES)</Label>
              <Input
                id="rate-org-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder="500,000"
                autoComplete="off"
              />
            </div>
          </div>

          <OrganizationFindingsFields
            declaredPep={declaredPep}
            value={effective}
            onChange={setFindings}
            idPrefix="rate-org"
          />

          {assessment && <RiskPreview assessment={assessment} />}

          {assessment?.requiresEdd && (
            <EddFields
              draft={draft}
              onChange={setDraft}
              isPep={assessment.isPep}
              idPrefix="rate-org-edd"
            />
          )}

          {(error ?? ownersProblem) && (
            <p role="alert" className="text-destructive">
              {error ?? ownersProblem}
            </p>
          )}
          <Button type="submit" disabled={saving || ownersProblem !== null}>
            {saving ? "Saving…" : "Save rating"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
