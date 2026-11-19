"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, MailWarning } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  resendButtonLabel,
  useResendConfirmation,
} from "@/components/web/email-confirmation-banner";
import { authClient } from "@/lib/auth-client";
import { confirmationResult } from "@/lib/email-confirmation";
import { safeNextPath, signInHref } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";

// Where the link in the confirmation email lands. better-auth has already
// decided by the time this page loads: it adds `?error=<code>` when the link
// didn't work, and nothing when it did. `?next` is where the person was headed
// when they signed up.
function EmailConfirmedContent() {
  const params = useSearchParams();
  const result = confirmationResult(params.get("error"));
  const next = safeNextPath(params.get("next"));
  const nextParam = params.get("next");

  const { data: session, isPending, refetch } = authClient.useSession();
  const signedIn = !!session;
  const { sending, secondsLeft, resend } = useResendConfirmation(
    session?.user.email ?? "",
    () => void refetch(),
  );

  // If they confirmed in the browser they are signed in with, the banner has to
  // learn that it is done. Once is enough.
  const refreshed = useRef(false);
  useEffect(() => {
    if (result.status !== "confirmed" || refreshed.current) return;
    refreshed.current = true;
    void refetch();
  }, [result.status, refetch]);

  const confirmed = result.status === "confirmed";
  const Icon = confirmed ? MailCheck : MailWarning;

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full",
          confirmed
            ? "bg-primary/10 text-primary"
            : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
        )}
      >
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold">{result.title}</h1>
      <p className="text-sm text-muted-foreground">{result.message}</p>

      {!isPending && !signedIn && !confirmed && result.canResend && (
        <p className="text-sm text-muted-foreground">
          Sign in, then choose “Send again” in the banner at the top of the
          page.
        </p>
      )}

      <div className="mt-2 flex w-full flex-col gap-2">
        {isPending ? (
          <Spinner className="mx-auto" />
        ) : confirmed ? (
          <Link
            href={signedIn ? next : signInHref(nextParam)}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            {signedIn ? "Continue" : "Sign in"}
          </Link>
        ) : signedIn && result.canResend ? (
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={resend}
            disabled={sending || secondsLeft > 0}
          >
            {sending ? (
              <>
                <Spinner className="mr-2" />
                Sending…
              </>
            ) : secondsLeft > 0 ? (
              resendButtonLabel(false, secondsLeft)
            ) : (
              "Send a new link"
            )}
          </Button>
        ) : (
          <Link
            href={signInHref(nextParam)}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}

export default function EmailConfirmedPage() {
  return (
    // The layout around this page already provides <main>.
    <div className="flex flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card className="overflow-hidden p-0">
          <CardContent className="p-6 md:p-8">
            <Suspense fallback={<Spinner className="mx-auto" />}>
              <EmailConfirmedContent />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
