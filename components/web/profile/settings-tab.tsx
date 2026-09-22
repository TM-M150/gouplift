"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { profileSchema } from "@/lib/validations/profile";
import {
  changePasswordSchema,
  ChangePasswordValues,
} from "@/lib/validations/auth";
import { authClient } from "@/lib/auth-client";

const accountDetailsSchema = profileSchema.pick({
  username: true,
  location: true,
  website: true,
});
type AccountDetailsValues = z.infer<typeof accountDetailsSchema>;

export function SettingsTab() {
  return (
    <div className="space-y-6 p-1">
      <AccountDetailsCard />
      <ContactInfoCard />
      <ChangePasswordCard />
    </div>
  );
}

function AccountDetailsCard() {
  const profile = useQuery(api.users.getCurrentUserProfile);
  const updateProfile = useMutation(api.users.updateProfile);
  const [synced, setSynced] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AccountDetailsValues>({
    resolver: zodResolver(accountDetailsSchema),
    defaultValues: { username: undefined, location: undefined, website: "" },
  });

  useEffect(() => {
    if (profile && !synced) {
      reset({
        username: profile.username || undefined,
        location: profile.location || undefined,
        website: profile.website || "",
      });
      setSynced(true);
    }
  }, [profile, synced, reset]);

  const onSubmit = async (data: AccountDetailsValues) => {
    try {
      await updateProfile({
        username: data.username?.trim() || undefined,
        location: data.location?.trim() || undefined,
        website: data.website?.trim() ?? "",
      });
      toast.success("Account details updated!");
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? String(error.data)
          : "Failed to update. Please try again.",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account details</CardTitle>
        <CardDescription>Your username, location, and website.</CardDescription>
      </CardHeader>
      <CardContent>
        {profile === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  placeholder="e.g. wanjiru_k"
                  aria-invalid={!!errors.username}
                  {...register("username")}
                />
                {errors.username && (
                  <p className="text-xs text-destructive">
                    {errors.username.message}
                  </p>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="location">Location</FieldLabel>
                <Input
                  id="location"
                  placeholder="Nairobi, Kenya"
                  aria-invalid={!!errors.location}
                  {...register("location")}
                />
                {errors.location && (
                  <p className="text-xs text-destructive">
                    {errors.location.message}
                  </p>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="website">Website</FieldLabel>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://example.com"
                  aria-invalid={!!errors.website}
                  {...register("website")}
                />
                {errors.website && (
                  <p className="text-xs text-destructive">
                    {errors.website.message}
                  </p>
                )}
              </Field>

              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Spinner className="mr-2" />
                      Saving...
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ContactInfoCard() {
  const profile = useQuery(api.users.getCurrentUserProfile);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact info</CardTitle>
        <CardDescription>
          Used for sign-in and receipts. Contact support to change these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {profile === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="flex justify-between border-b pb-3">
              <span className="text-muted-foreground">Email</span>
              <span>{profile?.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span>{profile?.phoneNumber || "Not set"}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChangePasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const onSubmit = async (data: ChangePasswordValues) => {
    const { error } = await authClient.changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      revokeOtherSessions: true,
    });

    if (error) {
      toast.error(error.message ?? "Could not change your password.");
      return;
    }

    toast.success("Password changed.");
    reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change your account password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="currentPassword">
                Current password
              </FieldLabel>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.currentPassword}
                {...register("currentPassword")}
              />
              {errors.currentPassword && (
                <p className="text-xs text-destructive">
                  {errors.currentPassword.message}
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.newPassword}
                {...register("newPassword")}
              />
              {errors.newPassword && (
                <p className="text-xs text-destructive">
                  {errors.newPassword.message}
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="confirmNewPassword">
                Confirm new password
              </FieldLabel>
              <Input
                id="confirmNewPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.confirmNewPassword}
                {...register("confirmNewPassword")}
              />
              {errors.confirmNewPassword && (
                <p className="text-xs text-destructive">
                  {errors.confirmNewPassword.message}
                </p>
              )}
            </Field>

            <Field>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2" />
                    Updating...
                  </>
                ) : (
                  "Change password"
                )}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
