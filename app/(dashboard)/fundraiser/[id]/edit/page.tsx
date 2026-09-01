"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { fundraiserSchema } from "@/lib/validations/fundraiser"; // adjust path if needed
import { toast } from "sonner";
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
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

const FUNDRAISER_TYPES = [
  "MEDICAL",
  "EDUCATION",
  "EMERGENCY",
  "MEMORIAL_FUNERAL",
  "COMMUNITY_HARAMBEE",
  "BUSINESS_STARTUP",
  "SPORTS",
  "CREATIVE_ARTS",
  "ANIMAL_WELFARE",
  "ENVIRONMENT",
  "DISASTER_RELIEF",
  "NONPROFIT",
  "OTHER",
] as const;

export default function EditFundraiserPage() {
  const params = useParams();
  const router = useRouter();
  const fundraiserId = params.id as Id<"fundraisers">;

  const fundraiser = useQuery(api.fundraiser.getFundraiserById, {
    fundraiserId,
  });

  const updateFundraiser = useMutation(api.fundraiser.updateFundraiser);

  const form = useForm({
    resolver: zodResolver(fundraiserSchema),
    defaultValues: {
      title: "",
      tagline: "",
      type: "OTHER",
      story: "",
      beneficiaryType: "SELF",
      beneficiaryName: "",
      organizationName: "",
      goalAmount: 0,
      location: "",
      country: "",
    },
  });

  // Prefill form when data loads
  useEffect(() => {
    if (fundraiser) {
      form.reset({
        title: fundraiser.title ?? "",
        tagline: fundraiser.tagline ?? "",
        type: fundraiser.type ?? "OTHER",
        story: fundraiser.story ?? "",
        beneficiaryType: fundraiser.beneficiaryType ?? "MYSELF",
        beneficiaryName: fundraiser.beneficiaryName ?? "",
        organizationName: fundraiser.organizationName ?? "",
        goalAmount: fundraiser.goalAmount ?? 0,
        location: fundraiser.location ?? "",
        country: fundraiser.country ?? "",
      });
    }
  }, [fundraiser, form]);

  const onSubmit = async (values: any) => {
    try {
      await updateFundraiser({
        fundraiserId,
        ...values,
        currency: "KES",
      });

      toast.success("Fundraiser updated successfully");
      router.push(`/fundraiser/${fundraiserId}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update fundraiser");
    }
  };

  if (fundraiser === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (fundraiser === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h1 className="text-2xl font-semibold">Fundraiser not found</h1>
        <Link href="/">
          <Button>Go home</Button>
        </Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen max-w-3xl mx-auto w-full pt-24 px-4 pb-16">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/fundraiser/${fundraiserId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Edit Fundraiser</h1>
          <p className="text-sm text-muted-foreground">
            Make changes and save when you’re done
          </p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            {...form.register("title")}
            placeholder="Fundraiser title"
          />
          {form.formState.errors.title && (
            <p className="text-sm text-destructive">
              {form.formState.errors.title.message as string}
            </p>
          )}
        </div>

        {/* Tagline */}
        <div className="space-y-2">
          <Label htmlFor="tagline">Tagline (optional)</Label>
          <Input
            id="tagline"
            {...form.register("tagline")}
            placeholder="Short summary"
          />
        </div>

        {/* Type */}
        <div className="space-y-2">
          <Label>Type</Label>
          <Select
            value={form.watch("type") ?? undefined}
            onValueChange={(value) => {
              if (value) {
                form.setValue("type", value, { shouldValidate: true });
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {FUNDRAISER_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type
                    .toLowerCase()
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Goal Amount */}
        <div className="space-y-2">
          <Label htmlFor="goalAmount">Goal Amount (KES)</Label>
          <Input
            id="goalAmount"
            type="number"
            {...form.register("goalAmount", { valueAsNumber: true })}
          />
        </div>

        {/* Location */}
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            {...form.register("location")}
            placeholder="e.g. Nakuru"
          />
        </div>

        {/* Story */}
        <div className="space-y-2">
          <Label htmlFor="story">Story</Label>
          <Textarea
            id="story"
            rows={10}
            {...form.register("story")}
            placeholder="Tell the full story..."
            className="resize-y"
          />
          {form.formState.errors.story && (
            <p className="text-sm text-destructive">
              {form.formState.errors.story.message as string}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save changes
          </Button>

          <Link href={`/fundraiser/${fundraiserId}`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </main>
  );
}
