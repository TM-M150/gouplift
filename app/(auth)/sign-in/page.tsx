"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
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
          href="#"
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

export default function SignInForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

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

    const input = data.identifier.trim();
    // Check if input looks like an email or a phone number
    const isEmail = input.includes("@");

    let response;
    if (isEmail) {
      response = await authClient.signIn.email({
        email: input,
        password: data.password,
      });
    } else {
      response = await authClient.signIn.phoneNumber({
        phoneNumber: input,
        password: data.password,
      });
    }

    if (response.error) {
      const errorMsg =
        response.error.message || "Invalid credentials provided.";
      setServerError(errorMsg);
      toast.error("Sign in failed", { description: errorMsg });
    } else {
      toast.success("Welcome back!", {
        description: "Redirecting your profile...",
      });
      router.push("/profile");
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
                          Sign in to your GoupLift account
                        </span>
                      </FieldDescription>
                    </div>

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
                        placeholder="e.g., johndoe@gmail.com or +254..."
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

                  <FieldDescription className="text-center">
                    Don&apos;t have an account?{" "}
                    <Link
                      href="/sign-up"
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
            <Link href="#" className="underline">
              Privacy Policy
            </Link>
            .
          </FieldDescription>
        </div>
      </div>
    </main>
  );
}
