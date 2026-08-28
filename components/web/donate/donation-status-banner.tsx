"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

interface DonationStatusBannerProps {
  donationId: string;
}

export function DonationStatusBanner({
  donationId,
}: DonationStatusBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Cheap sanity check before handing a possibly-tampered-with URL param
  // to Convex — a garbage id would otherwise throw during argument
  // validation rather than failing gracefully.
  const looksLikeAnId = /^[a-z0-9]{10,}$/i.test(donationId);

  const status = useQuery(
    api.donations.getDonationStatus,
    looksLikeAnId ? { donationId: donationId as Id<"donations"> } : "skip",
  );

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
      <BannerShell tone="success" onDismiss={() => setDismissed(true)}>
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

  // FAILED or CANCELLED
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
}: {
  tone: "pending" | "success" | "error";
  children: React.ReactNode;
  onDismiss: () => void;
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
      className={`mb-6 flex items-start justify-between gap-4 rounded-lg border p-4 text-sm ${toneClasses}`}
    >
      <p>{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}