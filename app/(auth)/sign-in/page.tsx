"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

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
import { signInSchema, SignInValues } from "@/lib/validations/auth";
import { authClient } from "@/lib/auth-client";
import {
  SIGN_IN_IDENTIFIER_MESSAGE,
  parseSignInIdentifier,
} from "@/lib/phone";
import {
  AFTER_SIGN_IN_DEFAULT,
  safeNextPath,
  signInHref,
  signUpHref,
} from "@/lib/safe-redirect";
import { signInErrorNotice, type SignInNotice } from "@/lib/sign-in-errors";
import { FaGoogle } from "react-icons/fa6";

// Local Input Helper
interface BaseFieldProps {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}

function FormTextField({
  id,
  label,
  registration,
  error,
  placeholder,
  type = "text",
  autoComplete,
}: BaseFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        {...registration}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Field>
  );
}

function FormPasswordField({
  id,
  label,
  registration,
  error,
  placeholder = "........",
  autoComplete = "current-password",
}: BaseFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Link
          href="/forgot-password"
          className="text-xs text-muted-foreground hover:underline"
        >
          Forgot password?
        </Link>
      </div>
      <div className="relative flex items-center">
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="pr-10"
          aria-invalid={!!error}
          {...registration}
        />
        <button
          type="button"
          onClick={() => setShow((prev) => !prev)}
          className="absolute right-3 text-muted-foreground hover:text-foreground focus:outline-none"
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Field>
  );
}

function SignInForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to go afterwards: the page that sent them here, if it was one of ours.
  const requestedNext = searchParams.get("next");
  const next = safeNextPath(requestedNext);

  // Google sends people back here with `?error=...` when it couldn't sign them
  // in. We keep the notice (our own words, from the code) and tidy the address,
  // so a refresh doesn't show it again.
  const [notice, setNotice] = useState<SignInNotice | null>(() =>
    signInErrorNotice(searchParams.get("error")),
  );
  const hasErrorInAddress =
    searchParams.has("error") || searchParams.has("error_description");
  useEffect(() => {
    if (hasErrorInAddress) {
      router.replace(signInHref(requestedNext), { scroll: false });
    }
  }, [hasErrorInAddress, requestedNext, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  const onSubmit = async (data: SignInValues) => {
    setServerError(null);
    setNotice(null);

    // An email address, or a Kenyan mobile number tidied to +254XXXXXXXXX so it
    // matches however it was typed when the account was made. The form has
    // already turned anything else away.
    const identifier = parseSignInIdentifier(data.identifier);
    if (!identifier) {
      setServerError(SIGN_IN_IDENTIFIER_MESSAGE);
      return;
    }

    const response =
      identifier.kind === "email"
        ? await authClient.signIn.email({
            email: identifier.email,
            password: data.password,
          })
        : await authClient.signIn.phoneNumber({
            phoneNumber: identifier.phoneNumber,
            password: data.password,
          });

    if (response.error) {
      const errorMsg =
        response.error.message || "Invalid credentials provided.";
      setServerError(errorMsg);
      toast.error("Sign in failed", { description: errorMsg });
    } else {
      toast.success("Welcome back!", {
        description:
          next === AFTER_SIGN_IN_DEFAULT
            ? "Redirecting your profile..."
            : "Taking you back...",
      });
      router.push(next);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <div className="flex flex-col gap-10">
          <Card className="overflow-hidden p-0">
            <CardContent className="grid p-0 md:grid-cols-2">
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 md:p-8">
                <FieldGroup>
                  <FieldSet>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <FieldLegend>
                        <h1 className="text-2xl font-bold">Welcome Back</h1>
                      </FieldLegend>
                      <FieldDescription>
                        <span className="text-balance text-muted-foreground">
                          Sign in to your GoUplift account
                        </span>
                      </FieldDescription>
                    </div>

                    {notice && (
                      <div
                        role={notice.tone === "error" ? "alert" : "status"}
                        data-tone={notice.tone}
                        className={
                          notice.tone === "error"
                            ? "rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                            : "rounded-md bg-muted p-3 text-sm text-foreground"
                        }
                      >
                        <p className="font-medium">{notice.title}</p>
                        <p
                          className={
                            notice.tone === "error"
                              ? "mt-1 text-xs"
                              : "mt-1 text-xs text-muted-foreground"
                          }
                        >
                          {notice.message}
                        </p>
                      </div>
                    )}

                    {serverError && (
                      <div className="rounded-md bg-destructive/15 p-3 text-center text-xs font-medium text-destructive">
                        {serverError}
                      </div>
                    )}

                    <FieldGroup>
                      <FormTextField
                        id="identifier"
                        type="text"
                        label="Email or Phone Number"
                        placeholder="e.g., johndoe@gmail.com or 0712 345 678"
                        autoComplete="username"
                        registration={register("identifier")}
                        error={errors.identifier?.message}
                      />

                      <FormPasswordField
                        id="password"
                        label="Password"
                        registration={register("password")}
                        error={errors.password?.message}
                      />
                    </FieldGroup>
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
                          Signing in...
                        </>
                      ) : (
                        "Sign In"
                      )}
                    </Button>
                  </Field>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        Or continue with
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    type="button"
                    aria-label="Continue with Google"
                    onClick={() => {
                      setNotice(null);
                      // If Google can't sign them in, they come back to this
                      // page (still heading where they were going) and are
                      // told why.
                      void authClient.signIn.social({
                        provider: "google",
                        callbackURL: next,
                        errorCallbackURL: signInHref(requestedNext),
                      });
                    }}
                  >
                    <FaGoogle className="size-5 text-[#EA4335]" />
                  </Button>

                  <FieldDescription className="text-center">
                    Don&apos;t have an account?{" "}
                    <Link
                      href={signUpHref(requestedNext)}
                      className="underline underline-offset-4"
                    >
                      Sign up
                    </Link>
                  </FieldDescription>
                </FieldGroup>
              </form>

              <div className="relative hidden bg-muted md:block">
                <Image
                  src="https://plus.unsplash.com/premium_photo-1661842755831-6b1fbc1f748b?q=80&w=870&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                  alt="Sign in cover"
                  fill
                  priority
                  className="object-cover dark:brightness-[0.8] dark:grayscale"
                />
              </div>
            </CardContent>
          </Card>
          <FieldDescription className="px-6 text-center text-xs">
            By continuing, you agree to our{" "}
            <Link href="/terms" className="underline">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </FieldDescription>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  // useSearchParams needs a Suspense boundary so the page can still be built
  // ahead of time.
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
