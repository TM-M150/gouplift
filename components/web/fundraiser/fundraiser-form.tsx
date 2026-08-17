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
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import React from "react";
import { fundraiserFrontend } from "@/lib/validations/fundraiser";
import { ConvexError } from "convex/values";
import { Id } from "@/convex/_generated/dataModel";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export default function FundraiserForm() {
  const router = useRouter();
  const createFundraiser = useMutation(api.fundraiser.createFundraiser);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);

  const [beneficiaryType, setBeneficiaryType] = React.useState("");
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

  function handleCoverChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setCoverFile(file);
    setCoverPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  const beneficiaryCopy =
    beneficiaryType === "ORGANIZATION"
      ? {
          title: "What's the organization called?",
          placeholder: "e.g. Kajiado Youth Trust",
        }
      : { title: "Who are they?", placeholder: "Their full name" };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const goalRaw = formData.get("goal");

    const isOrg = beneficiaryType === "ORGANIZATION";
    const beneficiaryDetails = String(
      formData.get("beneficiaryDetails") ?? "",
    ).trim();

    const candidate = {
      location: String(formData.get("location") ?? "").trim(),
      type: String(formData.get("type") ?? ""),
      beneficiaryType,
      beneficiaryName:
        !isOrg && beneficiaryDetails ? beneficiaryDetails : undefined,
      organizationName:
        isOrg && beneficiaryDetails ? beneficiaryDetails : undefined,
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
        goalAmount: parsed.data.goalAmount,
        currency: parsed.data.currency,
        location: parsed.data.location,
        country: parsed.data.country,
        coverImageStorageId,
      });

      // TODO: adjust if your Fundraisers tab needs a query param, e.g.
      // router.push("/profile?tab=fundraisers")
      toast.success("Fundraiser created!", {
        description: "It's now live on your profile.",
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

            <QuestionnaireItem
              name="beneficiaryDetails"
              required={beneficiaryType !== "" && beneficiaryType !== "SELF"}
              disabled={beneficiaryType === "" || beneficiaryType === "SELF"}
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
                A clear photo helps donors trust your fundraiser.
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