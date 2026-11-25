"use client";

import * as React from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { FaFacebookF, FaWhatsapp, FaXTwitter } from "react-icons/fa6";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  facebookShareUrl,
  shareMessage,
  whatsappShareUrl,
  xShareUrl,
} from "@/lib/share-links";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some browsers, and pages they don't treat as secure, refuse the first
    // way, so fall back to the older one.
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(field);
      return copied;
    } catch {
      return false;
    }
  }
}

// Whether this browser has a share sheet of its own (phones do): it lists the
// person's own apps, so it reaches Telegram, SMS and the rest too. Read this
// way so the server and the browser draw the same thing first.
const noop = () => () => {};
function useCanShareNatively(): boolean {
  return React.useSyncExternalStore(
    noop,
    () => typeof navigator !== "undefined" && "share" in navigator,
    () => false,
  );
}

const WHATSAPP_BUTTON =
  "h-10 gap-2 bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-700/30";
const ICON_BUTTON = "size-10";

/**
 * Buttons to pass a fundraiser on: WhatsApp first, as that is how most
 * fundraisers spread here, then copying the link, Facebook and X, and the
 * phone's own share sheet where there is one.
 *
 * "card" is for the donate card. "inline" is the single row shown near the top
 * of the page on a phone, where the donate card is a long scroll away.
 */
export function ShareFundraiser({
  title,
  url,
  layout = "card",
  className,
}: {
  title: string;
  /** The fundraiser's own address, as written in its link preview. */
  url: string;
  layout?: "card" | "inline";
  className?: string;
}) {
  const canShareNatively = useCanShareNatively();
  const [copied, setCopied] = React.useState(false);
  const resetCopied = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(resetCopied.current), []);

  async function copy() {
    if (await copyText(url)) {
      toast.success("Link copied");
      setCopied(true);
      window.clearTimeout(resetCopied.current);
      resetCopied.current = window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(
        "Couldn't copy the link. Press and hold the address bar to copy it.",
      );
    }
  }

  async function shareNatively() {
    try {
      await navigator.share({ title, text: shareMessage(title), url });
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't open sharing. Try Copy link instead.");
    }
  }

  const inline = layout === "inline";

  const whatsapp = (
    <a
      href={whatsappShareUrl(title, url)}
      target="_blank"
      rel="noopener noreferrer"
      // The short label keeps the row inside a 360px phone screen; the full
      // one is still what a screen reader announces.
      aria-label={inline ? "Share on WhatsApp" : undefined}
      className={cn(
        buttonVariants(),
        WHATSAPP_BUTTON,
        inline ? "flex-1" : "w-full",
      )}
    >
      <FaWhatsapp className="size-5" aria-hidden />
      {inline ? "WhatsApp" : "Share on WhatsApp"}
    </a>
  );

  const copyButton = (
    <button
      type="button"
      onClick={copy}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-10 gap-2",
        inline ? "px-3" : "min-w-0 flex-1",
      )}
    >
      {copied ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Link2 className="size-4" aria-hidden />
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );

  const moreButton = canShareNatively && (
    <button
      type="button"
      onClick={shareNatively}
      aria-label="More ways to share"
      title="More ways to share"
      className={cn(buttonVariants({ variant: "outline" }), ICON_BUTTON)}
    >
      <Share2 className="size-4" aria-hidden />
    </button>
  );

  if (inline) {
    return (
      // Wraps rather than ever running past the screen, e.g. in the narrow
      // thank-you banner on a small phone.
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {whatsapp}
        {copyButton}
        {moreButton}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm font-medium">Share this fundraiser</p>
      {whatsapp}
      <div className="flex items-center gap-2">
        {copyButton}
        <a
          href={facebookShareUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on Facebook"
          title="Share on Facebook"
          className={cn(buttonVariants({ variant: "outline" }), ICON_BUTTON)}
        >
          <FaFacebookF className="size-4" aria-hidden />
        </a>
        <a
          href={xShareUrl(title, url)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Share on X"
          title="Share on X"
          className={cn(buttonVariants({ variant: "outline" }), ICON_BUTTON)}
        >
          <FaXTwitter className="size-4" aria-hidden />
        </a>
        {moreButton}
      </div>
    </div>
  );
}
