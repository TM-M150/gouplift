"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentUploadSlot } from "@/components/web/organization/document-upload-slot";
import {
  ORGANIZATION_REQUIREMENTS,
  ORGANIZATION_TYPES,
  getDocumentSlots,
  type DocumentType,
  type OrganizationType,
} from "@/lib/organization-verification";
import { organizationDetailsSchema } from "@/lib/validations/organization";

// Lets <SelectValue> show the friendly label rather than the raw enum value.
const TYPE_ITEMS: Record<string, string> = Object.fromEntries(
  ORGANIZATION_TYPES.map((type) => [type, ORGANIZATION_REQUIREMENTS[type].label]),
);

function isOrganizationType(value: string | null): value is OrganizationType {
  return (
    value !== null && (ORGANIZATION_TYPES as readonly string[]).includes(value)
  );
}

type FilesBySlot = Partial<Record<DocumentType, File[]>>;

export function OrganizationForm() {
  const router = useRouter();
  const createOrganization = useMutation(api.organizations.createOrganization);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);

  const [name, setName] = React.useState("");
  const [organizationType, setOrganizationType] =
    React.useState<OrganizationType | null>(null);
  const [registrationNumber, setRegistrationNumber] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [files, setFiles] = React.useState<FilesBySlot>({});
  const [missing, setMissing] = React.useState<ReadonlySet<DocumentType>>(
    new Set(),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Remembers files that already reached storage, so retrying after a failed
  // submit doesn't upload (and orphan) the same files again.
  const uploadedIds = React.useRef(new WeakMap<File, Id<"_storage">>());

  const slots = React.useMemo(
    () => (organizationType ? getDocumentSlots(organizationType) : []),
    [organizationType],
  );

  function handleTypeChange(value: string | null) {
    if (!isOrganizationType(value)) return;
    setOrganizationType(value);
    setMissing(new Set());

    // Keep files for documents the new type still asks for; drop the rest.
    const stillAsked = new Set(
      getDocumentSlots(value).map((slot) => slot.documentType),
    );
    setFiles((previous) => {
      const next: FilesBySlot = {};
      for (const slot of stillAsked) {
        if (previous[slot]) next[slot] = previous[slot];
      }
      return next;
    });
  }

  function handleFilesChange(documentType: DocumentType, next: File[]) {
    setFiles((previous) => ({ ...previous, [documentType]: next }));
    if (next.length > 0 && missing.has(documentType)) {
      const remaining = new Set(missing);
      remaining.delete(documentType);
      setMissing(remaining);
    }
  }

  async function uploadFile(file: File): Promise<Id<"_storage">> {
    const cached = uploadedIds.current.get(file);
    if (cached) return cached;

    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Couldn't upload ${file.name}. Please try again.`);
    }
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    uploadedIds.current.set(file, storageId);
    return storageId;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = organizationDetailsSchema.safeParse({
      name,
      organizationType: organizationType ?? undefined,
      registrationNumber,
      description,
      website,
      contactEmail,
      contactPhone,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Please check your details and try again.",
      );
      return;
    }
    const details = parsed.data;

    const missingSlots = slots.filter(
      (slot) => slot.required && !files[slot.documentType]?.length,
    );
    if (missingSlots.length > 0) {
      setMissing(new Set(missingSlots.map((slot) => slot.documentType)));
      setError(
        `Upload the required documents: ${missingSlots.map((slot) => slot.label).join(", ")}.`,
      );
      return;
    }
    setMissing(new Set());

    setSubmitting(true);
    try {
      const documents = await Promise.all(
        slots.flatMap((slot) =>
          (files[slot.documentType] ?? []).map(async (file) => ({
            documentType: slot.documentType,
            storageId: await uploadFile(file),
            fileName: file.name,
          })),
        ),
      );

      const { slug } = await createOrganization({
        name: details.name,
        organizationType: details.organizationType,
        registrationNumber: details.registrationNumber,
        description: details.description,
        website: details.website,
        contactEmail: details.contactEmail,
        contactPhone: details.contactPhone,
        documents,
      });

      toast.success("Organization submitted", {
        description: `${details.name} is under review. We'll verify your documents.`,
      });
      router.push(`/organizations/${slug}/dashboard`);
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? String(err.data)
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
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
            <CardTitle className="text-2xl">Create an organization</CardTitle>
            <CardDescription>
              Tell us about your organization, then upload the documents we use
              to verify it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Nakuru Youth Trust"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use the exact name on your registration certificate.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="org-type">Type of organization</Label>
                <Select
                  items={TYPE_ITEMS}
                  value={organizationType}
                  onValueChange={handleTypeChange}
                >
                  <SelectTrigger id="org-type" className="w-full">
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {ORGANIZATION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ORGANIZATION_REQUIREMENTS[type].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {organizationType && (
                  <p className="text-xs text-muted-foreground">
                    {ORGANIZATION_REQUIREMENTS[organizationType].hint}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="org-registration-number">
                  Registration number
                </Label>
                <Input
                  id="org-registration-number"
                  value={registrationNumber}
                  onChange={(event) => setRegistrationNumber(event.target.value)}
                  placeholder="As shown on your certificate"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-description">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="org-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What does your organization do?"
                className="min-h-24"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-website">
                Website{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="org-website"
                type="url"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://example.org"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="org-email">
                  Contact email{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="org-email"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder="hello@example.org"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-phone">
                  Contact phone{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="org-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder="07XX XXX XXX"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Verification documents</CardTitle>
            <CardDescription>
              Upload clear scans or photos (PDF, JPG, PNG or WebP, up to 10 MB
              each). They&apos;re only used to verify your organization and are
              never shown publicly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Choose your type of organization above to see which documents
                to upload.
              </p>
            ) : (
              slots.map((slot) => (
                <DocumentUploadSlot
                  key={slot.documentType}
                  slot={slot}
                  files={files[slot.documentType] ?? []}
                  onChange={(next) => handleFilesChange(slot.documentType, next)}
                  disabled={submitting}
                  invalid={missing.has(slot.documentType)}
                />
              ))
            )}
          </CardContent>
        </Card>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "Submit for verification"}
        </Button>
      </fieldset>
    </form>
  );
}
