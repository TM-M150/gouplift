"use client";

import * as React from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import Logo from "@/components/icons/logo";
import { cn } from "@/lib/utils";

/**
 * What a visitor sees when something breaks while a page is loading.
 *
 * It says what to do about money, because the likeliest worry after an error
 * in the middle of a donation is whether the payment went through: the answer
 * is to check for the confirmation before trying again, not to give twice.
 * The reference (Next's `digest`) matches the error in the server logs, so
 * someone reporting a problem can quote it.
 */
export function ErrorContent({
  error,
  onRetry,
  standalone = false,
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
  /** True where there is no site header above, so the logo goes on top. */
  standalone?: boolean;
}) {
  React.useEffect(() => {
    // No error monitoring yet: the browser console and the server logs (by
    // digest) are where this shows up.
    console.error(error);
  }, [error]);

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-xl flex-col items-center px-6 pb-24 text-center",
        standalone ? "min-h-screen justify-center" : "pt-36",
      )}
    >
      {standalone && (
        <Link href="/" aria-label="Go to the homepage" className="mb-10">
          <Logo width={40} height={40} className="h-10 w-10" />
        </Link>
      )}
      <p className="text-sm font-medium text-muted-foreground">Error</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        Something went wrong
      </h1>
      <p className="mt-4 text-pretty text-lg text-muted-foreground">
        That was on our side, not yours. Please try again. If it keeps
        happening, wait a few minutes and come back.
      </p>
      <p className="mt-3 text-pretty text-sm text-muted-foreground">
        If you were in the middle of a donation, check your phone or email for a
        confirmation before you try again, so you don&apos;t give twice.
      </p>
      <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
        <Button size="lg" onClick={onRetry}>
          Try again
        </Button>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
        >
          Go to the homepage
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
