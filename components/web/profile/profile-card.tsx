"use client";

import * as React from "react";
import { Upload, Loader2, EyeOff, Eye, Info } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { getInitials } from "@/lib/utils";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Who you are, on the deep green band at the top of the profile page: photo,
 * name, who can see the profile, and your followers. White and the bright
 * green carry the text here; the bright green is never used as text on white.
 */
export function ProfileCard() {
  const { data: session, isPending } = authClient.useSession();
  const { user: currentUser } = session ?? {};

  const stats = useQuery(
    api.users.getProfileStats,
    currentUser?.id ? { userId: currentUser.id } : "skip",
  );
  const profile = useQuery(api.users.getCurrentUserProfile);
  const updateProfile = useMutation(api.users.updateProfile);
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const processImage = useAction(api.users.processProfileImageAction);

  const { name = "" } = currentUser ?? {};
  const avatarUrl = profile?.image || currentUser?.image || "";

  const [open, setOpen] = React.useState(false);
  const [pendingPrivate, setPendingPrivate] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && profile) setPendingPrivate(profile.isPrivate);
    setOpen(nextOpen);
  };

  const handleSave = async () => {
    if (pendingPrivate === profile?.isPrivate) {
      setOpen(false);
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({ isPrivate: pendingPrivate });
      toast.success("Visibility updated!");
      setOpen(false);
    } catch {
      toast.error("Failed to update visibility. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be re-selected later
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image must be smaller than 5MB.");
      return;
    }

    setIsUploadingImage(true);
    try {
      const postUrl = await generateUploadUrl();

      const result = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok) throw new Error("Upload failed");

      const { storageId } = await result.json();
      await processImage({ storageId });

      toast.success("Profile photo updated!");
    } catch {
      toast.error("Failed to update photo. Please try again.");
    } finally {
      setIsUploadingImage(false);
    }
  };

  if (isPending) {
    return (
      <section
        aria-busy
        aria-label="Your profile"
        className="mx-auto w-full max-w-4xl"
      >
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <Skeleton className="h-28 w-28 shrink-0 rounded-full bg-white/15 sm:h-32 sm:w-32" />
            <div className="flex flex-col items-center gap-3 sm:items-start">
              <Skeleton className="h-9 w-56 rounded-lg bg-white/15" />
              <Skeleton className="h-9 w-64 rounded-full bg-white/15" />
            </div>
          </div>
          <Skeleton className="mx-auto h-[92px] w-64 rounded-2xl bg-white/15 md:mx-0" />
        </div>
      </section>
    );
  }

  const isPrivate = profile?.isPrivate ?? true;

  return (
    <section aria-label="Your profile" className="mx-auto w-full max-w-4xl">
      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <div className="relative shrink-0">
            <Avatar className="h-28 w-28 shadow-lg ring-4 ring-secondary sm:h-32 sm:w-32">
              {avatarUrl && (
                <AvatarImage
                  src={avatarUrl}
                  alt={name}
                  className="object-cover"
                />
              )}
              <AvatarFallback className="bg-mint text-3xl font-semibold text-primary">
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <Button
              size="icon"
              variant="secondary"
              onClick={handlePhotoUploadClick}
              disabled={isUploadingImage}
              aria-label="Change profile photo"
              className="absolute bottom-0 right-0 h-9 w-9 rounded-full border-2 border-primary shadow-md focus-visible:border-white focus-visible:ring-white/60"
            >
              {isUploadingImage ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Upload className="h-4 w-4 text-primary" />
              )}
            </Button>
          </div>

          <div className="flex flex-col items-center gap-4 sm:items-start">
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {name || "User Profile"}
            </h1>

            <div className="inline-flex w-fit flex-wrap items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white sm:text-sm">
              {isPrivate ? (
                <EyeOff className="h-4 w-4 shrink-0 text-secondary" />
              ) : (
                <Eye className="h-4 w-4 shrink-0 text-secondary" />
              )}
              <span>
                {isPrivate
                  ? "Your profile is private."
                  : "Your profile is public."}
              </span>

              <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogTrigger className="rounded-sm font-semibold underline underline-offset-2 transition-colors hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  Change visibility
                </DialogTrigger>

                <DialogContent className="max-w-md rounded-3xl p-8">
                  <DialogHeader className="items-start gap-2 text-left">
                    <DialogTitle className="text-2xl font-semibold tracking-tight text-primary">
                      Visibility
                    </DialogTitle>
                    <DialogDescription className="text-sm text-primary/70">
                      <Link
                        href="#"
                        onClick={(e) => e.preventDefault()}
                        className="font-semibold text-primary underline"
                      >
                        Learn more
                      </Link>{" "}
                      about what&apos;s visible and what stays hidden.
                    </DialogDescription>
                  </DialogHeader>

                  <RadioGroup
                    value={pendingPrivate ? "private" : "public"}
                    onValueChange={(value) =>
                      setPendingPrivate(value === "private")
                    }
                    className="gap-5 py-2"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <RadioGroupItem value="private" className="mt-1" />
                      <div>
                        <p className="font-semibold text-primary">Private</p>
                        <p className="text-sm text-primary/70">
                          People can only see your name, profile photo, and
                          cover image.
                        </p>
                      </div>
                    </label>

                    <label className="flex cursor-pointer items-start gap-3">
                      <RadioGroupItem value="public" className="mt-1" />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-primary">Public</p>
                          <Badge variant="secondary">Recommended</Badge>
                        </div>
                        <p className="text-sm text-primary/70">
                          Everyone can see your full profile.
                        </p>
                      </div>
                    </label>
                  </RadioGroup>

                  <DialogFooter>
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving}
                      size="lg"
                      className="w-full rounded-full"
                    >
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Tooltip>
                <TooltipTrigger
                  aria-label="Who can see your activity"
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <Info className="ml-0.5 h-4 w-4 shrink-0 cursor-pointer text-white/70 transition-colors hover:text-white" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-64 text-xs">
                    Only approved followers can view your detailed activity.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="mx-auto flex items-center justify-center gap-6 rounded-2xl bg-white/10 px-7 py-4 sm:gap-8 md:mx-0">
          <div className="text-center">
            <span className="block text-3xl font-semibold tabular-nums text-white">
              {stats?.followersCount ?? 0}
            </span>
            <span className="mt-0.5 block text-sm font-medium text-white/75">
              Followers
            </span>
          </div>
          <Separator orientation="vertical" className="h-10 bg-white/20" />
          <div className="text-center">
            <span className="block text-3xl font-semibold tabular-nums text-white">
              {stats?.followingCount ?? 0}
            </span>
            <span className="mt-0.5 block text-sm font-medium text-white/75">
              Following
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
