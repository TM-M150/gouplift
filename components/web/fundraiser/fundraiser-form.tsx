"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import {
  BENEFICIARY_CHOICES,
  FUNDRAISER_TYPE_CHOICES,
  GOAL_CHOICES,
  LOCATION_CHOICES,
} from "./form-questions";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import React from "react";
import { fundraiserFrontend } from "@/lib/validations/fundraiser";
import { ConvexError } from "convex/values";
import { Id } from "@/convex/_generated/dataModel";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const OTHER_ORGANIZATION = "OTHER";
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5MB, same cap as profile photos

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export default function FundraiserForm() {
  const router = useRouter();
  const createFundraiser = useMutation(api.fundraiser.createFundraiser);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const myOrganizations = useQuery(api.organizations.listMyOrganizations);

  const [beneficiaryType, setBeneficiaryType] = React.useState("");
  const [organizationChoice, setOrganizationChoice] = React.useState("");
  const [coverFile, setCoverFile] = React.useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = React.useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const isOrgBeneficiary = beneficiaryType === "ORGANIZATION";
  const hasOrganizations = (myOrganizations?.length ?? 0) > 0;

  // Only counts while the beneficiary is still "An organization", so going
  // back and changing that answer can't leave a stale link behind.
  const linkedOrganization = isOrgBeneficiary
    ? myOrganizations?.find((org) => org._id === organizationChoice)
    : undefined;

  // The free-text name/organization step is skipped for "Myself" and when one
  // of the user's own organizations was picked (its name is used instead).
  const needsBeneficiaryDetails =
    beneficiaryType !== "" && beneficiaryType !== "SELF" && !linkedOrganization;

  const beneficiaryCopy = isOrgBeneficiary
    ? {
        title: "What's the organization called?",
        placeholder: "e.g. Kajiado Youth Trust",
      }
    : { title: "Who are they?", placeholder: "Their full name" };

  function handleCoverChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0] ?? null;

    if (file) {
      const problem = !file.type.startsWith("image/")
        ? "Please choose an image file."
        : file.size > MAX_COVER_BYTES
          ? "Image must be smaller than 5MB."
          : null;

      if (problem) {
        toast.error(problem);
        input.value = ""; // clear the picker so the same file can be retried
        setCoverFile(null);
        setCoverPreviewUrl(null);
        return;
      }
    }

    setCoverFile(file);
    setCoverPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const goalRaw = formData.get("goal");
    const beneficiaryDetails = String(
      formData.get("beneficiaryDetails") ?? "",
    ).trim();

    const candidate = {
      location: String(formData.get("location") ?? "").trim(),
      type: String(formData.get("type") ?? ""),
      beneficiaryType,
      // Keyed off the beneficiary type, not just "is there text", so a name
      // typed earlier can't leak into a fundraiser for "Myself".
      beneficiaryName:
        beneficiaryType === "SOMEONE_ELSE" && beneficiaryDetails
          ? beneficiaryDetails
          : undefined,
      organizationName: isOrgBeneficiary
        ? (linkedOrganization?.name ?? (beneficiaryDetails || undefined))
        : undefined,
      goalAmount: Number(goalRaw ?? 0),
      currency: "KES" as const,
      country: "Kenya",
      title: String(formData.get("title") ?? "").trim(),
      story: String(formData.get("story") ?? "").trim(),
      coverImageFile: coverFile ?? undefined,
    };

    const parsed = fundraiserFrontend.safeParse(candidate);
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ??
          "Please check your answers and try again.",
      );
      return;
    }

    setSubmitting(true);
    try {
      let coverImageStorageId: Id<"_storage"> | undefined;

      if (parsed.data.coverImageFile) {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": parsed.data.coverImageFile.type },
          body: parsed.data.coverImageFile,
        });
        if (!result.ok) {
          throw new Error("The cover photo upload failed. Please try again.");
        }
        const { storageId } = (await result.json()) as {
          storageId: Id<"_storage">;
        };
        coverImageStorageId = storageId;
      }

      await createFundraiser({
        title: parsed.data.title,
        tagline: parsed.data.tagline,
        story: parsed.data.story,
        type: parsed.data.type,
        beneficiaryType: parsed.data.beneficiaryType,
        beneficiaryName: parsed.data.beneficiaryName,
        organizationName: parsed.data.organizationName,
        // From state, not parsed.data: the frontend zod schema doesn't know
        // about it. The server re-checks membership either way.
        organizationId: linkedOrganization?._id,
        goalAmount: parsed.data.goalAmount,
        currency: parsed.data.currency,
        location: parsed.data.location,
        country: parsed.data.country,
        coverImageStorageId,
      });

      // TODO: adjust if your Fundraisers tab needs a query param, e.g.
      // router.push("/profile?tab=fundraisers")
      toast.success("Fundraiser created!", {
        description: linkedOrganization
          ? `It's now live on your profile and on ${linkedOrganization.name}'s page.`
          : "It's now live on your profile.",
      });
      router.push("/profile");
    } catch (error) {
      const message =
        error instanceof ConvexError
          ? String(error.data)
          : error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <CardContent className="grid p-0 md:grid-cols-2">
        <Questionnaire
          onSubmit={handleSubmit}
          className="flex flex-col p-6 md:p-8"
        >
          <QuestionnaireProgress />

          {/* Fixed-height, scrollable question area. Without this, the card
              resizes on every Next/Previous because each item has a
              different amount of content (13 choices vs. one input).
              "type" has the most content and will scroll within this box
              on shorter screens — that's expected, not a bug. */}
          <div className="min-h-[26rem] flex-1 overflow-y-auto py-6 md:min-h-[30rem]">
            <QuestionnaireItem name="location" required>
              <QuestionnaireTitle>
                Where are you fundraising from?
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                Pick a county, or type another one.
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {LOCATION_CHOICES.map((choice) => (
                  <QuestionnaireChoice key={choice.value} value={choice.value}>
                    <span className="font-medium">{choice.label}</span>
                  </QuestionnaireChoice>
                ))}
                <QuestionnaireInput
                  aria-label="Other county"
                  placeholder="Type your county…"
                />
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>

            <QuestionnaireItem name="type" required>
              <QuestionnaireTitle>
                What kind of fundraiser is this?
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                Choose the closest category.
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {FUNDRAISER_TYPE_CHOICES.map((choice) => (
                  <QuestionnaireChoice key={choice.value} value={choice.value}>
                    <span className="font-medium">{choice.label}</span>
                    <span className="text-muted-foreground">
                      {choice.description}
                    </span>
                  </QuestionnaireChoice>
                ))}
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>

            <QuestionnaireItem name="beneficiary" required>
              <QuestionnaireTitle>
                Who is this fundraiser for?
              </QuestionnaireTitle>
              <QuestionnaireChoices>
                {BENEFICIARY_CHOICES.map((choice) => (
                  <QuestionnaireChoice
                    key={choice.value}
                    value={choice.value}
                    onChange={() => setBeneficiaryType(choice.value)}
                  >
                    <span className="font-medium">{choice.label}</span>
                    <span className="text-muted-foreground">
                      {choice.description}
                    </span>
                  </QuestionnaireChoice>
                ))}
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>

            {/* Only shown for "An organization" when the user belongs to at
                least one. Everyone else goes straight to the details step. */}
            <QuestionnaireItem
              name="organization"
              required={isOrgBeneficiary && hasOrganizations}
              disabled={!isOrgBeneficiary || !hasOrganizations}
            >
              <QuestionnaireTitle>
                Is this on behalf of one of your organizations?
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                It will appear on the organization&apos;s public page.{" "}
                <Link
                  href="/organizations/new"
                  target="_blank"
                  className="underline underline-offset-4"
                >
                  Create an organization
                </Link>
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {myOrganizations?.map((organization) => (
                  <QuestionnaireChoice
                    key={organization._id}
                    value={organization._id}
                    onChange={() => setOrganizationChoice(organization._id)}
                  >
                    <span className="font-medium">{organization.name}</span>
                    <span className="text-muted-foreground">
                      {organization.isVerified ? "Verified · " : ""}
                      {ROLE_LABELS[organization.role] ?? organization.role}
                    </span>
                  </QuestionnaireChoice>
                ))}
                <QuestionnaireChoice
                  value={OTHER_ORGANIZATION}
                  onChange={() => setOrganizationChoice(OTHER_ORGANIZATION)}
                >
                  <span className="font-medium">A different organization</span>
                  <span className="text-muted-foreground">
                    You&apos;ll enter its name next.
                  </span>
                </QuestionnaireChoice>
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>

            <QuestionnaireItem
              name="beneficiaryDetails"
              required={needsBeneficiaryDetails}
              disabled={!needsBeneficiaryDetails}
            >
              <QuestionnaireTitle>{beneficiaryCopy.title}</QuestionnaireTitle>
              <QuestionnaireInput
                aria-label={beneficiaryCopy.title}
                placeholder={beneficiaryCopy.placeholder}
              />
              <QuestionnaireError />
            </QuestionnaireItem>

            <QuestionnaireItem name="goal" required>
              <QuestionnaireTitle>
                What&apos;s your fundraising goal?
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                Amounts are in Kenyan shillings.
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {GOAL_CHOICES.map((choice) => (
                  <QuestionnaireChoice key={choice.value} value={choice.value}>
                    <span className="font-medium">{choice.label}</span>
                  </QuestionnaireChoice>
                ))}
                <QuestionnaireInput
                  type="number"
                  aria-label="Custom goal amount"
                  placeholder="Custom amount"
                />
              </QuestionnaireChoices>
              <QuestionnaireError />
            </QuestionnaireItem>

            <QuestionnaireItem name="coverPhoto" required>
              <QuestionnaireTitle>Add a cover photo</QuestionnaireTitle>
              <QuestionnaireDescription>
                A clear photo helps donors trust your fundraiser. Images only,
                up to 5MB.
              </QuestionnaireDescription>
              <Input
                type="file"
                accept="image/*"
                aria-label="Cover photo"
                onChange={handleCoverChange}
              />
              {/* Questionnaire only recognizes its own Choice/Input controls
                  as "answered" — it can't see the file input above. This
                  hidden input mirrors the selected filename so `required`
                  actually works (and clears) instead of blocking forever. */}
              <QuestionnaireInput
                aria-hidden="true"
                tabIndex={-1}
                readOnly
                className="sr-only"
                value={coverFile?.name ?? ""}
              />
              <QuestionnaireError>
                Add a cover photo to continue.
              </QuestionnaireError>
            </QuestionnaireItem>

            <QuestionnaireItem name="title" required>
              <QuestionnaireTitle>
                Give your fundraiser a title
              </QuestionnaireTitle>
              <QuestionnaireDescription>
                Up to 40 characters.
              </QuestionnaireDescription>
              <QuestionnaireInput
                aria-label="Fundraiser title"
                placeholder="e.g. Help Wanjiru walk again"
                maxLength={40}
              />
              <QuestionnaireError />
            </QuestionnaireItem>

            <QuestionnaireItem name="story" required>
              <QuestionnaireTitle>Tell your story</QuestionnaireTitle>
              <QuestionnaireDescription>
                At least 50 characters.
              </QuestionnaireDescription>
              <QuestionnaireInput
                aria-label="Your story"
                placeholder="Share what happened and how the funds will help…"
                render={<Textarea className="min-h-40" />}
              />
              <QuestionnaireError />
            </QuestionnaireItem>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <QuestionnaireActions>
            <QuestionnairePrevious />
            <QuestionnaireNext />
            <QuestionnaireSubmit disabled={submitting}>
              {submitting ? "Creating…" : "Create fundraiser"}
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>

        <div className="relative hidden bg-muted md:block">
          {coverPreviewUrl ? (
            // next/image doesn't support blob: URLs, so this stays a plain
            // <img> — it's a local, already-in-memory preview anyway, not
            // something that needs Next's remote-image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverPreviewUrl}
              alt="Fundraiser cover"
              className="h-full w-full object-cover dark:brightness-[0.8]"
            />
          ) : (
            <div className="relative flex h-full items-center justify-center p-8 text-center text-sm text-white">
              <Image
                src="https://images.unsplash.com/photo-1613803161619-ffc734b8963e?q=80&w=436&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                alt="Fundraiser cover placeholder"
                fill
                priority
                className="object-cover brightness-50 dark:brightness-[0.3] dark:grayscale"
              />
              <span className="relative z-10 font-medium drop-shadow-md">
                Your cover photo will show up here once you add one.
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
