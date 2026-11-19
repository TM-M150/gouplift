"use client";

import * as React from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { EMAIL_CONFIRMED_PATH } from "@/lib/email-confirmation";

/** Set on the page while the banner shows, to the height it takes. */
export const BANNER_HEIGHT_VAR = "--email-banner-height";

/** How long "Send again" waits after an email goes out. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Asks for a new confirmation email, with a short wait between requests so a
 * double click doesn't send two. Used by the banner and by the page the link
 * lands on when the link has expired.
 */
export function useResendConfirmation(
  email: string,
  onAlreadyConfirmed?: () => void,
) {
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [cooldownEndsAt, setCooldownEndsAt] = React.useState(0);
  const [now, setNow] = React.useState(0);

  // Tick once a second, only while there is a wait to count down.
  React.useEffect(() => {
    if (cooldownEndsAt === 0) return;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= cooldownEndsAt) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [cooldownEndsAt]);

  const secondsLeft = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));

  const resend = async () => {
    if (sending || secondsLeft > 0) return;
    setSending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: EMAIL_CONFIRMED_PATH,
      });
      if (error) {
        if (error.code?.toLowerCase() === "email_already_verified") {
          toast.success("Your email address is already confirmed.");
          onAlreadyConfirmed?.();
          return;
        }
        toast.error(
          error.message ||
            "We couldn't send the email. Please try again in a few minutes.",
        );
        return;
      }
      const started = Date.now();
      setNow(started);
      setCooldownEndsAt(started + RESEND_COOLDOWN_SECONDS * 1000);
      setSent(true);
      toast.success("Confirmation email sent", {
        description: "Check your inbox, and your spam folder.",
      });
    } catch {
      toast.error(
        "We couldn't send the email. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return { sending, sent, secondsLeft, resend };
}

export function resendButtonLabel(sending: boolean, secondsLeft: number) {
  if (sending) return "Sending…";
  if (secondsLeft > 0) return `Send again in ${secondsLeft}s`;
  return "Send again";
}

interface EmailConfirmationBannerViewProps {
  email: string;
  sending: boolean;
  sent: boolean;
  secondsLeft: number;
  onResend: () => void;
  ref?: React.Ref<HTMLElement>;
}

/** The strip itself, with nothing to fetch, so it can be looked at on its own. */
export function EmailConfirmationBannerView({
  email,
  sending,
  sent,
  secondsLeft,
  onResend,
  ref,
}: EmailConfirmationBannerViewProps) {
  return (
    <section
      ref={ref}
      aria-label="Confirm your email address"
      className="border-t border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <MailWarning className="size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 basis-64">
          <span className="font-medium">Confirm your email address.</span>{" "}
          {sent ? (
            <>
              We sent a new link to <span className="break-all">{email}</span>.
            </>
          ) : (
            <>
              We sent a link to <span className="break-all">{email}</span>
              {/* A string, so the space after the address is kept. Written
                  as plain text after the closing tag, it came out without. */}
              {" when you signed up. You'll need it to request a withdrawal."}
            </>
          )}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onResend}
          disabled={sending || secondsLeft > 0}
        >
          {resendButtonLabel(sending, secondsLeft)}
        </Button>
      </div>
    </section>
  );
}

/**
 * Tells the page how tall the banner is, while it shows. The header is fixed
 * and the banner hangs from it, so the page has to move down by that much; it
 * reads the height from here (see SiteShell). It follows the banner when the
 * text wraps on a narrow screen, and is removed when the banner goes.
 */
function useReportedHeight(
  ref: React.RefObject<HTMLElement | null>,
  showing: boolean,
) {
  React.useEffect(() => {
    const element = ref.current;
    if (!showing || !element) return;
    const root = document.documentElement;
    const report = () =>
      root.style.setProperty(BANNER_HEIGHT_VAR, `${element.offsetHeight}px`);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, [ref, showing]);
}

/**
 * Shown under the header to anyone signed in whose email address is not
 * confirmed yet, and gone once it is. It can't be closed: it is the way to ask
 * for a new link, and the message shown when a withdrawal is refused points
 * here. Signed-out visitors, and people who signed in with Google (which
 * confirms the address itself), never see it.
 */
export function EmailConfirmationBanner() {
  const { data: session, refetch } = authClient.useSession();
  const user = session?.user;
  const { sending, sent, secondsLeft, resend } = useResendConfirmation(
    user?.email ?? "",
    () => void refetch(),
  );

  // `=== false`, so nothing shows while the answer is still unknown.
  const showing = !!user && user.emailVerified === false;
  const ref = React.useRef<HTMLElement>(null);
  useReportedHeight(ref, showing);
  if (!user || !showing) return null;

  return (
    <EmailConfirmationBannerView
      ref={ref}
      email={user.email}
      sending={sending}
      sent={sent}
      secondsLeft={secondsLeft}
      onResend={resend}
    />
  );
}
