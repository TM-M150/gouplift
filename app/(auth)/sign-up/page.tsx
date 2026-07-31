"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm, UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FaApple, FaGoogle, FaMeta } from "react-icons/fa6";
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
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { signUpSchema, SignUpValues } from "@/lib/validations/auth";
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

// General Input Function
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

// Self-Contained Password Input Function
function FormPasswordField({
  id,
  label,
  registration,
  error,
  placeholder = "........",
  autoComplete = "new-password",
}: BaseFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
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

// Helper to format names
function toProperCase(str: string): string {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function SignupForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: "",
      middleName: "",
      lastName: "",
      email: "",
      phoneNumber: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: SignUpValues) => {
    setServerError(null);

    const firstName = toProperCase(data.firstName);
    const middleName = data.middleName ? toProperCase(data.middleName) : "";
    const lastName = toProperCase(data.lastName);
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

    const { error } = await authClient.signUp.email({
      email: data.email,
      password: data.password,
      name: fullName,
      phoneNumber: data.phoneNumber,
    } as any);

    if (error) {
      const errorMsg = error.message || "Failed to create account.";
      setServerError(errorMsg);
      toast.error("Sign up failed", { description: errorMsg });
    } else {
      toast.success("Account created successfully!", {
        description: "Redirecting you to the home page...",
      });
      router.push("/");
    }
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-4xl">
        <div className="flex flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <CardContent className="grid p-0 md:grid-cols-2">
              <form onSubmit={handleSubmit(onSubmit)} className="p-6 md:p-8">
                <FieldGroup>
                  <FieldSet>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <FieldLegend>
                        <h1 className="text-2xl font-bold">Create your Account</h1>
                      </FieldLegend>
                      <FieldDescription>
                        <span className="text-balance text-muted-foreground">
                          Set up an account in a few simple steps
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
                        id="firstName"
                        label="First Name"
                        placeholder="e.g., John"
                        autoComplete="given-name"
                        registration={register("firstName")}
                        error={errors.firstName?.message}
                      />

                      <FormTextField
                        id="middleName"
                        label="Middle Name"
                        placeholder="Optional"
                        autoComplete="additional-name"
                        registration={register("middleName")}
                        error={errors.middleName?.message}
                      />

                      <FormTextField
                        id="lastName"
                        label="Last Name"
                        placeholder="e.g., Doe"
                        autoComplete="family-name"
                        registration={register("lastName")}
                        error={errors.lastName?.message}
                      />

                      <FormTextField
                        id="email"
                        type="email"
                        label="Email"
                        placeholder="e.g., johndoe@gmail.com"
                        autoComplete="email"
                        registration={register("email")}
                        error={errors.email?.message}
                      />

                      <FormTextField
                        id="phoneNumber"
                        type="tel"
                        label="Phone Number"
                        placeholder="e.g., +254700000000"
                        autoComplete="tel"
                        registration={register("phoneNumber")}
                        error={errors.phoneNumber?.message}
                      />

                      <FormPasswordField
                        id="password"
                        label="Password"
                        registration={register("password")}
                        error={errors.password?.message}
                      />

                      <FormPasswordField
                        id="confirmPassword"
                        label="Confirm Password"
                        registration={register("confirmPassword")}
                        error={errors.confirmPassword?.message}
                      />
                    </FieldGroup>
                  </FieldSet>

                  <Field>
                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <Spinner className="mr-2" />
                          Creating account...
                        </>
                      ) : (
                        "Sign Up"
                      )}
                    </Button>
                  </Field>

                  <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                    Or continue with
                  </FieldSeparator>

                  <Field className="grid grid-cols-3 gap-4">
                    <Button variant="outline" type="button">
                      <FaApple className="size-5 text-[#555555]" />
                    </Button>
                    <Button variant="outline" type="button">
                      <FaGoogle className="size-5 text-[#EA4335]" />
                    </Button>
                    <Button variant="outline" type="button">
                      <FaMeta className="size-5 text-[#0082FB]" />
                    </Button>
                  </Field>

                  <FieldDescription className="text-center">
                    Already have an account? <Link href="/sign-in">Sign in</Link>
                  </FieldDescription>
                </FieldGroup>
              </form>

              <div className="relative hidden bg-muted md:block">
                <Image
                  src="https://images.unsplash.com/photo-1578357078586-491adf1aa5ba?q=80&w=464&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                  alt="Sign up Image"
                  fill
                  priority
                  className="object-cover dark:brightness-[0.8] dark:grayscale"
                />
              </div>
            </CardContent>
          </Card>
          <FieldDescription className="px-6 text-center">
            By clicking continue, you agree to our{" "}
            <Link href="/terms">Terms of Service</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </FieldDescription>
        </div>
      </div>
    </main>
  );
}