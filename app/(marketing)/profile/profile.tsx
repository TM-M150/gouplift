"use client";

import * as React from "react";
import { Upload, EyeOff, Eye, Info } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";

import { Card } from "@/components/ui/card";
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

interface ProfileCardProps {
  userId?: string;
  onChangePhoto?: () => void;
}

export default function ProfileCard({
  userId,
  onChangePhoto,
}: ProfileCardProps) {
  const { data: session, isPending } = authClient.useSession();
  const currentUser = session?.user;

  const activeUserId = userId || currentUser?.id || "";
  const stats = useQuery(
    api.users.getProfileStats,
    activeUserId ? { userId: activeUserId } : "skip"
  );

  const name = currentUser?.name || "";
  const avatarUrl = currentUser?.image || "";

  const [isPrivate, setIsPrivate] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [pendingPrivate, setPendingPrivate] = React.useState(isPrivate);

  React.useEffect(() => {
    if (currentUser) {
      const initialPrivate = (currentUser as any)?.isPrivate ?? true;
      setIsPrivate(initialPrivate);
      setPendingPrivate(initialPrivate);
    }
  }, [currentUser]);

  const handleOpenChange = (next: boolean) => {
    if (next) setPendingPrivate(isPrivate);
    setOpen(next);
  };

  const handleSave = () => {
    setIsPrivate(pendingPrivate);
    setOpen(false);
  };

  const initials = name
    ? name
        .split(" ")
        .filter(Boolean)
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
    : "U";

  if (isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <Card className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm sm:p-10 md:p-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:text-left">
            {/* Avatar */}
            <div className="relative shrink-0">
              <Avatar className="h-28 w-28 shadow-md ring-4 ring-slate-100 sm:h-32 sm:w-32">
                {avatarUrl && (
                  <AvatarImage
                    src={avatarUrl}
                    alt={name}
                    className="object-cover"
                  />
                )}
                <AvatarFallback className="bg-slate-100 text-2xl font-bold text-slate-700">
                  {initials}
                </AvatarFallback>
              </Avatar>

              <Button
                size="icon"
                variant="secondary"
                onClick={onChangePhoto}
                aria-label="Change profile photo"
                className="absolute bottom-1 right-1 h-8 w-8 rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-100"
              >
                <Upload className="h-4 w-4 text-slate-700" />
              </Button>
            </div>

            {/* Profile Details */}
            <div className="flex flex-col items-center gap-10 sm:items-start">
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
                {name || "User Profile"}
              </h1>

              {/* Visibility Status Badge */}
              <div className="inline-flex w-fit flex-wrap items-center justify-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-medium text-slate-700 sm:text-sm">
                {isPrivate ? (
                  <EyeOff className="h-4 w-4 shrink-0 text-slate-600" />
                ) : (
                  <Eye className="h-4 w-4 shrink-0 text-slate-600" />
                )}
                <span>
                  {isPrivate
                    ? "Your profile is private."
                    : "Your profile is public."}
                </span>

                <Dialog open={open} onOpenChange={handleOpenChange}>
                  <DialogTrigger className="font-semibold underline transition-colors hover:text-slate-950">
                    Change visibility
                  </DialogTrigger>

                  <DialogContent className="max-w-md rounded-3xl p-8">
                    <DialogHeader className="items-start gap-2 text-left">
                      <DialogTitle className="text-2xl font-extrabold text-slate-900">
                        Visibility
                      </DialogTitle>
                      <DialogDescription className="text-sm text-slate-600">
                        <a
                          href="#"
                          onClick={(e) => e.preventDefault()}
                          className="font-semibold text-slate-900 underline"
                        >
                          Learn more
                        </a>{" "}
                        about what&apos;s visible and what stays hidden.
                      </DialogDescription>
                    </DialogHeader>

                    {/* Radio Group */}
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
                          <p className="font-semibold text-slate-900">
                            Private
                          </p>
                          <p className="text-sm text-slate-500">
                            People can only see your name, profile photo, and cover image.
                          </p>
                        </div>
                      </label>

                      <label className="flex cursor-pointer items-start gap-3">
                        <RadioGroupItem value="public" className="mt-1" />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-slate-900">
                              Public
                            </p>
                            <Badge className="bg-lime-200 text-slate-900 hover:bg-lime-200">
                              RECOMMENDED
                            </Badge>
                          </div>
                          <p className="text-sm text-slate-500">
                            Everyone can see your full profile.
                          </p>
                        </div>
                      </label>
                    </RadioGroup>

                    <DialogFooter>
                      <Button
                        type="button"
                        onClick={handleSave}
                        size="lg"
                        className="w-full rounded-full"
                      >
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Tooltip>
                  <TooltipTrigger>
                    <Info className="ml-0.5 h-4 w-4 shrink-0 cursor-pointer text-slate-400 transition-colors hover:text-slate-600" />
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

          {/* Stats */}
          <div className="flex items-center justify-center gap-6 sm:gap-8">
            <div className="text-center">
              <span className="block text-3xl font-extrabold text-slate-900">
                {stats?.followersCount ?? 0}
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-slate-500">
                Followers
              </span>
            </div>
            <Separator orientation="vertical" className="h-10 bg-slate-200" />
            <div className="text-center">
              <span className="block text-3xl font-extrabold text-slate-900">
                {stats?.followingCount ?? 0}
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-slate-500">
                Following
              </span>
            </div>
          </div>
        </div>
      </Card>
    </main>
  );
}