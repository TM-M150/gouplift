"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  forgotPasswordSchema,
  ForgotPasswordValues,
} from "@/lib/validations/auth";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotPasswordValues) => {
    await authClient.requestPasswordReset({
      email: data.email,
      redirectTo: "/reset-password",
    });
    // Same message whether or not the address has an account —
    // don't let this endpoint reveal which emails are registered.
    setSent(true);
  };

  return (
    <main className="flex flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card className="overflow-hidden p-0">
          <CardContent className="p-6 md:p-8">
            {sent ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Check your email</h1>
                <p className="text-sm text-muted-foreground">
                  If an account exists for that address, we&apos;ve sent a link
                  to reset your password.
                </p>
                <Link
                  href="/sign-in"
                  className="mt-4 text-sm font-medium underline underline-offset-4"
                >
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)}>
                <FieldGroup>
                  <FieldSet>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <FieldLegend>
                        <h1 className="text-2xl font-bold">Forgot password?</h1>
                      </FieldLegend>
                      <FieldDescription>
                        <span className="text-balance text-muted-foreground">
                          Enter your email and we&apos;ll send you a reset link.
                        </span>
                      </FieldDescription>
                    </div>

                    <Field>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        aria-invalid={!!errors.email}
                        {...register("email")}
                      />
                      {errors.email && (
                        <p className="text-xs text-destructive">
                          {errors.email.message}
                        </p>
                      )}
                    </Field>
                  </FieldSet>

                  <Field>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Spinner className="mr-2" />
                          Sending...
                        </>
                      ) : (
                        "Send reset link"
                      )}
                    </Button>
                  </Field>

                  <FieldDescription className="text-center">
                    Remembered it?{" "}
                    <Link
                      href="/sign-in"
                      className="underline underline-offset-4"
                    >
                      Sign in
                    </Link>
                  </FieldDescription>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
