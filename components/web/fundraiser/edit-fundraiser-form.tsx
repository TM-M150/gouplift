"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FUNDRAISER_TYPE_CHOICES } from "./form-questions";
import { fundraiserUpdateSchema } from "@/lib/validations/fundraiser";

interface EditFundraiserFormProps {
  fundraiser: Doc<"fundraisers"> & { coverImageUrl: string | null };
}

export function EditFundraiserForm({ fundraiser }: EditFundraiserFormProps) {
  const router = useRouter();
  const updateFundraiser = useMutation(api.fundraiser.updateFundraiser);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);

  const [title, setTitle] = React.useState(fundraiser.title);
  const [tagline, setTagline] = React.useState(fundraiser.tagline ?? "");
  const [type, setType] = React.useState(fundraiser.type);
  const [location, setLocation] = React.useState(fundraiser.location ?? "");
  const [goalAmount, setGoalAmount] = React.useState(
    String(fundraiser.goalAmount),
  );
  const [story, setStory] = React.useState(fundraiser.story);
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const candidate = {
      title: title.trim(),
      tagline: tagline.trim() || undefined,
      story: story.trim(),
      type,
      goalAmount: Number(goalAmount),
      location: location.trim() || undefined,
      coverImageFile: coverFile ?? undefined,
    };

    const parsed = fundraiserUpdateSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Please check your answers.",
      );
      return;
    }

    setSubmitting(true);
    try {
      let coverImageStorageId: Id<"_storage"> | undefined;

      if (coverFile) {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": coverFile.type },
          body: coverFile,
        });
        if (!result.ok)
          throw new Error("The cover photo upload failed. Please try again.");
        const { storageId } = (await result.json()) as {
          storageId: Id<"_storage">;
        };
        coverImageStorageId = storageId;
      }

      await updateFundraiser({
        fundraiserId: fundraiser._id,
        title: parsed.data.title,
        tagline: parsed.data.tagline,
        story: parsed.data.story,
        type: parsed.data.type,
        location: parsed.data.location,
        goalAmount: parsed.data.goalAmount,
        coverImageStorageId,
      });

      toast.success("Fundraiser updated!");
      router.push(`/fundraiser/${fundraiser._id}`);
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
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label>Cover photo</Label>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverPreviewUrl ?? fundraiser.coverImageUrl ?? ""}
            alt={title}
            className="h-full w-full object-cover"
          />
        </div>
        <Input type="file" accept="image/*" onChange={handleCoverChange} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={40}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tagline">Tagline</Label>
        <Input
          id="tagline"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={150}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="type">Category</Label>
          <Select
            value={type}
            onValueChange={(value) => {
              if (value !== null) {
                setType(value);
              }
            }}
          >
            <SelectTrigger id="type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNDRAISER_TYPE_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="goalAmount">Goal amount (KES)</Label>
        <Input
          id="goalAmount"
          type="number"
          min={1}
          value={goalAmount}
          onChange={(e) => setGoalAmount(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="story">Story</Label>
        <Textarea
          id="story"
          value={story}
          onChange={(e) => setStory(e.target.value)}
          className="min-h-48"
          required
        />
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}
