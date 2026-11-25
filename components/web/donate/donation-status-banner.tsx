"use client";

import { useState, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ShareFundraiser } from "@/components/web/fundraiser/share-fundraiser";

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

interface DonationStatusBannerProps {
  donationId: string;
  // When given, a donor whose payment has gone through is asked to pass the
  // fundraiser on: the moment they are likeliest to.
  share?: { title: string; url: string };
}

export function DonationStatusBanner({
  donationId,
  share,
}: DonationStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const looksLikeAnId = /^[a-z0-9]{10,}$/i.test(donationId);

  const status = useQuery(
    api.donations.getDonationStatus,
    looksLikeAnId ? { donationId: donationId as Id<"donations"> } : "skip",
  );

  const capturePayPalOrder = useAction(api.paypal.capturePayPalOrder);

  useEffect(() => {
    console.log("=== DonationStatusBanner useEffect ===");
    console.log("donationId:", donationId);
    console.log("status:", status);
    console.log("capturing:", capturing);

    if (!status) {
      console.log("→ early return: status is null/undefined");
      return;
    }

    if (status.status !== "PENDING") {
      console.log(
        "→ early return: status is not PENDING, it is",
        status.status,
      );
      return;
    }

    if (status.provider !== "PAYPAL") {
      console.log(
        "→ early return: provider is not PAYPAL, it is",
        status.provider,
      );
      return;
    }

    if (!status.checkoutRequestId) {
      console.log("→ early return: no checkoutRequestId");
      return;
    }

    if (capturing) {
      console.log("→ early return: already capturing");
      return;
    }

    const orderId = status.checkoutRequestId;
    console.log("All conditions passed. Will capture order:", orderId);

    let cancelled = false;

    async function tryCapture() {
      setCapturing(true);
      try {
        console.log("Calling capturePayPalOrder with orderId:", orderId);
        const result = await capturePayPalOrder({ orderId });
        console.log("Capture result:", result);
      } catch (err) {
        console.error("PayPal capture failed:", err);
      } finally {
        if (!cancelled) setCapturing(false);
      }
    }

    const timer = setTimeout(tryCapture, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, capturing, capturePayPalOrder, donationId]);

  if (dismissed || !looksLikeAnId || status === null) {
    return null;
  }

  if (status === undefined) {
    return (
      <BannerShell tone="pending" onDismiss={() => setDismissed(true)}>
        Checking your payment status…
      </BannerShell>
    );
  }

  if (status.status === "PENDING") {
    return (
      <BannerShell tone="pending" onDismiss={() => setDismissed(true)}>
        Confirming your payment — this updates automatically, no need to
        refresh.
      </BannerShell>
    );
  }

  if (status.status === "COMPLETED") {
    return (
      <BannerShell
        tone="success"
        onDismiss={() => setDismissed(true)}
        footer={
          share && (
            <div className="space-y-2">
              <p className="font-medium">
                Know someone who would want to help? Pass it on.
              </p>
              <ShareFundraiser
                layout="inline"
                title={share.title}
                url={share.url}
                className="sm:max-w-md"
              />
            </div>
          )
        }
      >
        Thank you! Your donation of{" "}
        {currencyFormatter.format(status.grossAmount)} has been received.
      </BannerShell>
    );
  }

  if (status.status === "REFUNDED") {
    return (
      <BannerShell tone="pending" onDismiss={() => setDismissed(true)}>
        Your donation of {currencyFormatter.format(status.grossAmount)} was
        refunded.
      </BannerShell>
    );
  }

  return (
    <BannerShell tone="error" onDismiss={() => setDismissed(true)}>
      {status.failureReason ??
        "Your payment didn't go through. Please try again."}
    </BannerShell>
  );
}

function BannerShell({
  tone,
  children,
  onDismiss,
  footer,
}: {
  tone: "pending" | "success" | "error";
  children: React.ReactNode;
  onDismiss: () => void;
  // Under the message, outside its paragraph.
  footer?: React.ReactNode;
}) {
  const toneClasses = {
    pending:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
    success:
      "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
    error:
      "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  }[tone];

  return (
    <div
      className={`mb-6 space-y-3 rounded-lg border p-4 text-sm ${toneClasses}`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 flex-1">{children}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
      {footer}
    </div>
  );
}
