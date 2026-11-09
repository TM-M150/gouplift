"use client";

import * as React from "react";
import { useMutation } from "convex/react";
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
import { errorMessage } from "@/components/web/admin/utils";
import { formatKes } from "@/components/web/kyc/format";
import { useDocumentUpload } from "@/components/web/kyc/use-document-upload";
import { DocumentUploadSlot } from "@/components/web/organization/document-upload-slot";
import { HOME_COUNTRY, countryOptions } from "@/lib/countries";
import {
  KYC_ID_TYPES,
  KYC_ID_TYPE_LABELS,
  getKycDocumentSlots,
  tierPayoutLimitKes,
  type KycDocumentSlot,
  type KycDocumentType,
  type KycIdType,
} from "@/lib/kyc";
import {
  EXPECTED_TIMELINES,
  EXPECTED_TIMELINE_LABELS,
  type ExpectedTimeline,
} from "@/lib/risk";
import {
  kycTier1DetailsSchema,
  kycTier2DetailsSchema,
} from "@/lib/validations/kyc";

type FilesBySlot = Partial<Record<KycDocumentType, File[]>>;

const ID_TYPE_ITEMS: Record<string, string> = KYC_ID_TYPE_LABELS;
const TIMELINE_ITEMS: Record<string, string> = EXPECTED_TIMELINE_LABELS;

function isTimeline(value: string | null): value is ExpectedTimeline {
  return (
    value !== null && (EXPECTED_TIMELINES as readonly string[]).includes(value)
  );
}

function isIdType(value: string | null): value is KycIdType {
  return value !== null && (KYC_ID_TYPES as readonly string[]).includes(value);
}

// The upload state both forms share: which files sit in which slot, which
// required slot to highlight, and uploading everything on submit.
function useKycFiles(slots: KycDocumentSlot[]) {
  const { upload, discard } = useDocumentUpload();
  const [files, setFiles] = React.useState<FilesBySlot>({});
  const [missing, setMissing] = React.useState<ReadonlySet<KycDocumentType>>(
    new Set(),
  );

  function change(documentType: KycDocumentType, next: File[]) {
    discard((files[documentType] ?? []).filter((file) => !next.includes(file)));
    setFiles((previous) => ({ ...previous, [documentType]: next }));
    if (next.length > 0 && missing.has(documentType)) {
      const remaining = new Set(missing);
      remaining.delete(documentType);
      setMissing(remaining);
    }
  }

  // After the slots change (a passport has no back page), keep the files for
  // documents that are still asked for and drop the rest.
  function keepOnly(nextSlots: KycDocumentSlot[]) {
    const stillAsked = new Set(nextSlots.map((slot) => slot.documentType));
    discard(
      Object.entries(files)
        .filter(([type]) => !stillAsked.has(type as KycDocumentType))
        .flatMap(([, dropped]) => dropped ?? []),
    );
    setFiles((previous) => {
      const next: FilesBySlot = {};
      for (const type of stillAsked) {
        if (previous[type]) next[type] = previous[type];
      }
      return next;
    });
    setMissing(new Set());
  }

  /** The required slots with nothing in them. Also highlights them. */
  function findMissing(): KycDocumentSlot[] {
    const empty = slots.filter(
      (slot) => slot.required && !files[slot.documentType]?.length,
    );
    setMissing(new Set(empty.map((slot) => slot.documentType)));
    return empty;
  }

  async function uploadAll() {
    return await Promise.all(
      slots.flatMap((slot) =>
        (files[slot.documentType] ?? []).map(async (file) => ({
          documentType: slot.documentType,
          storageId: await upload(file),
          fileName: file.name,
        })),
      ),
    );
  }

  return { files, missing, change, keepOnly, findMissing, uploadAll };
}

function DocumentsCard({
  slots,
  files,
  missing,
  onChange,
  disabled,
  description,
}: {
  slots: KycDocumentSlot[];
  files: FilesBySlot;
  missing: ReadonlySet<KycDocumentType>;
  onChange: (documentType: KycDocumentType, next: File[]) => void;
  disabled: boolean;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Documents</CardTitle>
        <CardDescription>
          {description}{" "}
          PDF, JPG, PNG or WebP, up to 10 MB each. They&apos;re only used to verify you and are never shown publicly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {slots.map((slot) => (
          <DocumentUploadSlot
            key={slot.documentType}
            slot={slot}
            files={files[slot.documentType] ?? []}
            onChange={(next) => onChange(slot.documentType, next)}
            disabled={disabled}
            invalid={missing.has(slot.documentType)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function FormFooter({
  error,
  submitting,
  label,
}: {
  error: string | null;
  submitting: boolean;
  label: string;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" disabled={submitting}>
        {submitting ? "Submitting…" : label}
      </Button>
    </>
  );
}

// Level 1: who you are.
export function Tier1Form() {
  const submitKyc = useMutation(api.kyc.submitKycTier1);

  const [legalName, setLegalName] = React.useState("");
  const [idType, setIdType] = React.useState<KycIdType>("NATIONAL_ID");
  const [idNumber, setIdNumber] = React.useState("");
  const [phoneNumber, setPhoneNumber] = React.useState("");
  const [campaignPurpose, setCampaignPurpose] = React.useState("");
  const [residenceCountry, setResidenceCountry] = React.useState(HOME_COUNTRY);
  const [expectedAmount, setExpectedAmount] = React.useState("");
  const [expectedTimeline, setExpectedTimeline] = React.useState<
    ExpectedTimeline | ""
  >("");
  // null until they answer: a PEP question left blank is not a "no".
  const [pepDeclared, setPepDeclared] = React.useState<boolean | null>(null);
  const [pepDetails, setPepDetails] = React.useState("");
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const countries = React.useMemo(() => countryOptions(), []);
  const countryItems = React.useMemo(
    () => Object.fromEntries(countries.map((c) => [c.code, c.name])),
    [countries],
  );
  const slots = React.useMemo(() => getKycDocumentSlots(1, idType), [idType]);
  const documents = useKycFiles(slots);

  function handleIdTypeChange(value: string | null) {
    if (!isIdType(value)) return;
    setIdType(value);
    documents.keepOnly(getKycDocumentSlots(1, value));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = kycTier1DetailsSchema.safeParse({
      legalName,
      idType,
      idNumber,
      phoneNumber,
      campaignPurpose,
      residenceCountry,
      // Commas and spaces are fine to type. Anything else becomes NaN, which
      // the schema reports as a missing amount.
      expectedAmountKes: expectedAmount.trim()
        ? Number(expectedAmount.replace(/[,\s]/g, ""))
        : Number.NaN,
      expectedTimeline: expectedTimeline || undefined,
      pepDeclared: pepDeclared ?? undefined,
      pepDetails: pepDeclared ? pepDetails : undefined,
      prohibitedActivitiesAcknowledged: acknowledged || undefined,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Please check your details and try again.",
      );
      return;
    }

    const empty = documents.findMissing();
    if (empty.length > 0) {
      setError(
        `Upload the required documents: ${empty.map((slot) => slot.label).join(", ")}.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      await submitKyc({
        ...parsed.data,
        documents: await documents.uploadAll(),
      });
      toast.success("Sent for review", {
        description: "We'll let you know here once it has been checked.",
      });
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset disabled={submitting} className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Level 1: confirm who you are
            </CardTitle>
            <CardDescription>
              Enter your details exactly as they appear on your ID. This lets us
              pay out up to {formatKes(tierPayoutLimitKes(1))}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="kyc-name">Full name</Label>
              <Input
                id="kyc-name"
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
                autoComplete="name"
                required
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kyc-id-type">Type of ID</Label>
                <Select
                  items={ID_TYPE_ITEMS}
                  value={idType}
                  onValueChange={handleIdTypeChange}
                >
                  <SelectTrigger id="kyc-id-type" className="w-full">
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
                <Label htmlFor="kyc-id-number">
                  {idType === "PASSPORT" ? "Passport number" : "ID number"}
                </Label>
                <Input
                  id="kyc-id-number"
                  value={idNumber}
                  onChange={(event) => setIdNumber(event.target.value)}
                  inputMode={idType === "PASSPORT" ? "text" : "numeric"}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="kyc-phone">Mobile number</Label>
              <Input
                id="kyc-phone"
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="0712 345 678"
                autoComplete="tel"
                required
              />
              <p className="text-xs text-muted-foreground">
                It must be registered in your own name.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="kyc-purpose">What is the money for?</Label>
              <Textarea
                id="kyc-purpose"
                value={campaignPurpose}
                onChange={(event) => setCampaignPurpose(event.target.value)}
                placeholder="e.g. Hospital bills for my mother's surgery."
                className="min-h-24"
                maxLength={500}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">About you and the money</CardTitle>
            <CardDescription>
              The law asks us to know who we pay and roughly how much. We use
              this to decide how closely to check, never to judge your cause.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="kyc-country">Where do you live?</Label>
              <Select
                items={countryItems}
                value={residenceCountry}
                onValueChange={(value) => value && setResidenceCountry(value)}
              >
                <SelectTrigger id="kyc-country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {countries.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {residenceCountry !== HOME_COUNTRY && (
                <p className="text-xs text-muted-foreground">
                  Fundraisers who live outside Kenya need an extra check by our
                  compliance team, so it can take a little longer.
                </p>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kyc-amount">
                  How much do you expect to raise?
                </Label>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
                  >
                    KES
                  </span>
                  <Input
                    id="kyc-amount"
                    value={expectedAmount}
                    onChange={(event) => setExpectedAmount(event.target.value)}
                    inputMode="numeric"
                    placeholder="50,000"
                    autoComplete="off"
                    className="pl-12"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  An estimate is fine. It doesn&apos;t limit your campaign.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="kyc-timeline">Over how long?</Label>
                <Select
                  items={TIMELINE_ITEMS}
                  value={expectedTimeline || null}
                  onValueChange={(value) =>
                    isTimeline(value) && setExpectedTimeline(value)
                  }
                >
                  <SelectTrigger id="kyc-timeline" className="w-full">
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
                Do you hold, or have you held, a senior public position, or are
                you a close relative or associate of someone who does?
              </legend>
              <p className="text-xs text-muted-foreground">
                For example a minister, MP, county governor or assembly member,
                a senior judge, military or police chief, a senior official of a
                state corporation, or a political party leader, in Kenya or
                abroad. Answering yes doesn&apos;t stop you fundraising. It just
                means our compliance officer approves your account.
              </p>
              <RadioGroup
                value={pepDeclared === null ? "" : pepDeclared ? "yes" : "no"}
                onValueChange={(value) => setPepDeclared(value === "yes")}
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
              {pepDeclared && (
                <div className="space-y-2">
                  <Label htmlFor="kyc-pep-details">
                    Who is it, and what is their role?
                  </Label>
                  <Textarea
                    id="kyc-pep-details"
                    value={pepDetails}
                    onChange={(event) => setPepDetails(event.target.value)}
                    placeholder="e.g. Me: member of the county assembly, 2022 to now. Or: my uncle, a senior judge."
                    className="min-h-20"
                    maxLength={500}
                  />
                </div>
              )}
            </fieldset>

            <div className="flex items-start gap-3">
              <Checkbox
                id="kyc-acknowledge"
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked)}
                className="mt-0.5"
              />
              <Label
                htmlFor="kyc-acknowledge"
                className="font-normal leading-snug"
              >
                I confirm the money is not for violence, terrorism, hate, human
                trafficking, illegal weapons or drugs, illegal gambling, a
                pyramid or Ponzi scheme, or anything else unlawful.
              </Label>
            </div>
          </CardContent>
        </Card>

        <DocumentsCard
          slots={slots}
          files={documents.files}
          missing={documents.missing}
          onChange={documents.change}
          disabled={submitting}
          description="Clear photos with all four corners visible and nothing covered."
        />

        <FormFooter
          error={error}
          submitting={submitting}
          label="Send for review"
        />
      </fieldset>
    </form>
  );
}

// Level 2: what the money is for, and where it goes.
export function Tier2Form({ legalName }: { legalName: string | null }) {
  const submitKyc = useMutation(api.kyc.submitKycTier2);

  const [kraPin, setKraPin] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slots = React.useMemo(() => getKycDocumentSlots(2), []);
  const documents = useKycFiles(slots);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = kycTier2DetailsSchema.safeParse({ kraPin });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Please check your details and try again.",
      );
      return;
    }

    const empty = documents.findMissing();
    if (empty.length > 0) {
      setError(
        `Upload the required documents: ${empty.map((slot) => slot.label).join(", ")}.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      await submitKyc({
        ...parsed.data,
        documents: await documents.uploadAll(),
      });
      toast.success("Sent for review", {
        description: "We'll let you know here once it has been checked.",
      });
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset disabled={submitting} className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Level 2: back up your campaign
            </CardTitle>
            <CardDescription>
              Show us what the money is for and where it should go. This lets us
              pay out up to {formatKes(tierPayoutLimitKes(2))}.
              {legalName &&
                ` The KRA PIN and payout account must be in the name on your ID: ${legalName}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="kyc-kra-pin">KRA PIN</Label>
            <Input
              id="kyc-kra-pin"
              value={kraPin}
              onChange={(event) => setKraPin(event.target.value)}
              placeholder="A123456789Z"
              autoComplete="off"
              required
            />
          </CardContent>
        </Card>

        <DocumentsCard
          slots={slots}
          files={documents.files}
          missing={documents.missing}
          onChange={documents.change}
          disabled={submitting}
          description="Documents that show the need is real and the account is yours."
        />

        <FormFooter
          error={error}
          submitting={submitting}
          label="Send for review"
        />
      </fieldset>
    </form>
  );
}
