"use client";

import * as React from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BENEFICIAL_OWNER_BASES,
  BENEFICIAL_OWNER_BASIS_LABELS,
  BENEFICIAL_OWNER_THRESHOLD_PERCENT,
  MAX_BENEFICIAL_OWNERS,
  type BeneficialOwnerBasis,
} from "@/lib/beneficial-ownership";
import { HOME_COUNTRY, countryOptions } from "@/lib/countries";
import {
  KYC_ID_TYPES,
  KYC_ID_TYPE_LABELS,
  type KycIdType,
} from "@/lib/kyc";
import {
  EXPECTED_TIMELINES,
  EXPECTED_TIMELINE_LABELS,
  type ExpectedTimeline,
} from "@/lib/risk";

// The parts of the organization form that answer the AML policy's questions
// (5.7, 5.8, 6, 7, 9): where it is registered, what it expects to raise, who
// owns or controls it, whether any of its people hold a senior public position,
// and that its purpose isn't a prohibited one. The form checks the answers with
// lib/validations/organization.ts, and the server checks them again.

const COUNTRIES = countryOptions();
const COUNTRY_ITEMS: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name]),
);
const TIMELINE_ITEMS: Record<string, string> = EXPECTED_TIMELINE_LABELS;
const ID_TYPE_ITEMS: Record<string, string> = KYC_ID_TYPE_LABELS;

// Short enough for a dropdown. The full wording shows under it once chosen.
const BASIS_SHORT_LABELS: Record<BeneficialOwnerBasis, string> = {
  OWNERSHIP: `Owns ${BENEFICIAL_OWNER_THRESHOLD_PERCENT}% or more`,
  CONTROL: "Controls it in another way",
  SENIOR_MANAGING_OFFICIAL: "Senior managing official (nobody owns it)",
};

function isTimeline(value: string | null): value is ExpectedTimeline {
  return (
    value !== null && (EXPECTED_TIMELINES as readonly string[]).includes(value)
  );
}
function isIdType(value: string | null): value is KycIdType {
  return value !== null && (KYC_ID_TYPES as readonly string[]).includes(value);
}
function isBasis(value: string | null): value is BeneficialOwnerBasis {
  return (
    value !== null && (BENEFICIAL_OWNER_BASES as readonly string[]).includes(value)
  );
}

// ---- Declarations ---------------------------------------------------------

export interface DeclarationsDraft {
  registeredCountry: string;
  expectedAmount: string;
  expectedTimeline: ExpectedTimeline | "";
  pepDeclared: boolean | null;
  pepDetails: string;
  acknowledged: boolean;
}

export const EMPTY_DECLARATIONS: DeclarationsDraft = {
  registeredCountry: HOME_COUNTRY,
  expectedAmount: "",
  expectedTimeline: "",
  pepDeclared: null,
  pepDetails: "",
  acknowledged: false,
};

/** "1,500,000" and "1 500 000" both mean 1500000. Anything else is left for the schema to refuse. */
export function parseAmount(text: string): number | undefined {
  const cleaned = text.replace(/[,\s]/g, "");
  return cleaned ? Number(cleaned) : undefined;
}

export function DeclarationsCard({
  draft,
  onChange,
  disabled,
}: {
  draft: DeclarationsDraft;
  onChange: (next: DeclarationsDraft) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof DeclarationsDraft>(
    key: K,
    value: DeclarationsDraft[K],
  ) => onChange({ ...draft, [key]: value });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">About the organization and the money</CardTitle>
        <CardDescription>
          The law asks us to know who we pay and roughly how much. We use this
          to decide how closely to check, never to judge your cause.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="org-country">Where is it registered?</Label>
          <Select
            items={COUNTRY_ITEMS}
            value={draft.registeredCountry}
            onValueChange={(value) => value && set("registeredCountry", value)}
            disabled={disabled}
          >
            <SelectTrigger id="org-country" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {COUNTRIES.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {draft.registeredCountry !== HOME_COUNTRY && (
            <p className="text-xs text-muted-foreground">
              Organizations registered outside Kenya need an extra check by our
              compliance team, so it can take a little longer.
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="org-amount">How much do you expect to raise?</Label>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
              >
                KES
              </span>
              <Input
                id="org-amount"
                value={draft.expectedAmount}
                onChange={(event) => set("expectedAmount", event.target.value)}
                inputMode="numeric"
                placeholder="500,000"
                autoComplete="off"
                className="pl-12"
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              An estimate is fine. It doesn&apos;t limit your campaigns.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-timeline">Over how long?</Label>
            <Select
              items={TIMELINE_ITEMS}
              value={draft.expectedTimeline || null}
              onValueChange={(value) =>
                isTimeline(value) && set("expectedTimeline", value)
              }
              disabled={disabled}
            >
              <SelectTrigger id="org-timeline" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {EXPECTED_TIMELINES.map((timeline) => (
                  <SelectItem key={timeline} value={timeline}>
                    {EXPECTED_TIMELINE_LABELS[timeline]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset className="min-w-0 space-y-3">
          <legend className="text-sm font-medium">
            Does anyone who runs, owns or controls the organization hold, or
            has held, a senior public position, or is a close relative or
            associate of someone who does?
          </legend>
          <p className="text-xs text-muted-foreground">
            For example a minister, MP, county governor or assembly member, a
            senior judge, military or police chief, a senior official of a state
            corporation, or a political party leader, in Kenya or abroad.
            Answering yes doesn&apos;t stop you. It just means our compliance
            officer approves the organization.
          </p>
          <RadioGroup
            value={
              draft.pepDeclared === null ? "" : draft.pepDeclared ? "yes" : "no"
            }
            onValueChange={(value) => set("pepDeclared", value === "yes")}
            className="gap-3"
          >
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <RadioGroupItem value="no" />
              No
            </label>
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <RadioGroupItem value="yes" />
              Yes
            </label>
          </RadioGroup>
          {draft.pepDeclared && (
            <div className="space-y-2">
              <Label htmlFor="org-pep-details">
                Who is it, and what is their role?
              </Label>
              <Textarea
                id="org-pep-details"
                value={draft.pepDetails}
                onChange={(event) => set("pepDetails", event.target.value)}
                placeholder="e.g. Our treasurer is a member of the county assembly."
                className="min-h-20"
                maxLength={500}
              />
            </div>
          )}
        </fieldset>

        <div className="flex items-start gap-3">
          <Checkbox
            id="org-acknowledge"
            checked={draft.acknowledged}
            onCheckedChange={(checked) => set("acknowledged", checked)}
            className="mt-0.5"
          />
          <Label
            htmlFor="org-acknowledge"
            className="font-normal leading-snug"
          >
            I confirm the organization&apos;s money is not for violence,
            terrorism, hate, human trafficking, illegal weapons or drugs,
            illegal gambling, a pyramid or Ponzi scheme, or anything else
            unlawful.
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Who owns or controls it ----------------------------------------------

export interface OwnerDraft {
  key: string;
  fullName: string;
  idType: KycIdType;
  idNumber: string;
  basis: BeneficialOwnerBasis;
  ownershipPercent: string;
  role: string;
  residenceCountry: string;
  pepDeclared: boolean;
}

/**
 * A blank person to fill in. The key comes from the people already listed, not
 * from a counter, so the server and the browser agree on it when the page is
 * first drawn.
 */
export function newOwnerDraft(existing: readonly OwnerDraft[] = []): OwnerDraft {
  const highest = existing.reduce(
    (max, owner) => Math.max(max, Number(owner.key.replace("owner-", "")) || 0),
    0,
  );
  return {
    key: `owner-${highest + 1}`,
    fullName: "",
    idType: "NATIONAL_ID",
    idNumber: "",
    basis: "OWNERSHIP",
    ownershipPercent: "",
    role: "",
    residenceCountry: HOME_COUNTRY,
    pepDeclared: false,
  };
}

/** The drafts as the schema wants them: a share is a number, and only where one is asked for. */
export function ownersToInput(owners: readonly OwnerDraft[]) {
  return owners.map((owner) => {
    const percent = owner.ownershipPercent.trim();
    return {
      fullName: owner.fullName,
      idType: owner.idType,
      idNumber: owner.idNumber,
      basis: owner.basis,
      ownershipPercent:
        owner.basis !== "SENIOR_MANAGING_OFFICIAL" && percent
          ? Number(percent.replace(/%$/, ""))
          : undefined,
      role: owner.role.trim() || undefined,
      residenceCountry: owner.residenceCountry,
      pepDeclared: owner.pepDeclared,
    };
  });
}

export function OwnersCard({
  owners,
  onChange,
  disabled,
}: {
  owners: OwnerDraft[];
  onChange: (next: OwnerDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (key: string, patch: Partial<OwnerDraft>) =>
    onChange(owners.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Who owns or controls it</CardTitle>
        <CardDescription>
          List every person who owns {BENEFICIAL_OWNER_THRESHOLD_PERCENT}% or
          more of the organization, or controls it in another way, for example
          through a trust, a nominee, a veto, or by appointing the board. If
          nobody does, name its senior managing official, such as the chair or
          chief executive, and choose that option. Upload their IDs below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {owners.map((owner, index) => (
          <OwnerFields
            key={owner.key}
            index={index}
            owner={owner}
            disabled={disabled}
            canRemove={owners.length > 1}
            onChange={(patch) => update(owner.key, patch)}
            onRemove={() => onChange(owners.filter((o) => o.key !== owner.key))}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || owners.length >= MAX_BENEFICIAL_OWNERS}
          onClick={() => onChange([...owners, newOwnerDraft(owners)])}
        >
          Add another person
        </Button>
      </CardContent>
    </Card>
  );
}

export function OwnerFields({
  index,
  owner,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  owner: OwnerDraft;
  disabled?: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<OwnerDraft>) => void;
  onRemove: () => void;
}) {
  const id = (name: string) => `${owner.key}-${name}`;
  const showShare = owner.basis !== "SENIOR_MANAGING_OFFICIAL";

  return (
    <fieldset className="min-w-0 space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-medium">Person {index + 1}</legend>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("name")}>Full name</Label>
        <Input
          id={id("name")}
          value={owner.fullName}
          onChange={(event) => onChange({ fullName: event.target.value })}
          placeholder="As it appears on their ID"
          autoComplete="off"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={id("id-type")}>ID type</Label>
          <Select
            items={ID_TYPE_ITEMS}
            value={owner.idType}
            onValueChange={(value) => isIdType(value) && onChange({ idType: value })}
            disabled={disabled}
          >
            <SelectTrigger id={id("id-type")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {KYC_ID_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {KYC_ID_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={id("id-number")}>
            {owner.idType === "PASSPORT" ? "Passport number" : "ID number"}
          </Label>
          <Input
            id={id("id-number")}
            value={owner.idNumber}
            onChange={(event) => onChange({ idNumber: event.target.value })}
            inputMode={owner.idType === "PASSPORT" ? "text" : "numeric"}
            autoComplete="off"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("basis")}>How do they own or control it?</Label>
        <Select
          items={BASIS_SHORT_LABELS}
          value={owner.basis}
          onValueChange={(value) =>
            isBasis(value) &&
            onChange({
              basis: value,
              // A senior managing official has no share to declare.
              ...(value === "SENIOR_MANAGING_OFFICIAL"
                ? { ownershipPercent: "" }
                : {}),
            })
          }
          disabled={disabled}
        >
          <SelectTrigger id={id("basis")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {BENEFICIAL_OWNER_BASES.map((basis) => (
              <SelectItem key={basis} value={basis}>
                {BASIS_SHORT_LABELS[basis]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {BENEFICIAL_OWNER_BASIS_LABELS[owner.basis]}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {showShare && (
          <div className="space-y-2">
            <Label htmlFor={id("share")}>
              Share owned{" "}
              {owner.basis === "CONTROL" && (
                <span className="text-muted-foreground">(if any)</span>
              )}
            </Label>
            <div className="relative">
              <Input
                id={id("share")}
                value={owner.ownershipPercent}
                onChange={(event) =>
                  onChange({ ownershipPercent: event.target.value })
                }
                inputMode="decimal"
                placeholder="e.g. 25"
                autoComplete="off"
                className="pr-8"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
              >
                %
              </span>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={id("role")}>
            Their role{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={id("role")}
            value={owner.role}
            onChange={(event) => onChange({ role: event.target.value })}
            placeholder="e.g. Chairperson"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id("country")}>Where do they live?</Label>
        <Select
          items={COUNTRY_ITEMS}
          value={owner.residenceCountry}
          onValueChange={(value) => value && onChange({ residenceCountry: value })}
          disabled={disabled}
        >
          <SelectTrigger id={id("country")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {COUNTRIES.map((country) => (
              <SelectItem key={country.code} value={country.code}>
                {country.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id={id("pep")}
          checked={owner.pepDeclared}
          onCheckedChange={(checked) => onChange({ pepDeclared: checked })}
          className="mt-0.5"
        />
        <Label htmlFor={id("pep")} className="font-normal leading-snug">
          This person holds, or has held, a senior public position, or is a
          close relative or associate of someone who does.
        </Label>
      </div>
    </fieldset>
  );
}
