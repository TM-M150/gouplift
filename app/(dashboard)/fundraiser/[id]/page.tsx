import { cache } from "react";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { connection } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import Image from "next/image";
import type { Metadata } from "next";
import { DonationStatusBanner } from "@/components/web/donate/donation-status-banner";
import { DonateButton } from "@/components/web/donate/donate-button";
import { EditFundraiserButton } from "@/components/web/fundraiser/edit-fundraiser-button";
import { PayoutVerificationNotice } from "@/components/web/fundraiser/payout-verification-notice";
import {
  describeTimeLeft,
  formatEndDate,
  hasEnded,
} from "@/lib/fundraiser-dates";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donation?: string; source?: string }>;
}

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

function formatType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function beneficiaryLine(fundraiser: {
  beneficiaryType: string;
  beneficiaryName?: string | null;
  organizationName?: string | null;
}) {
  switch (fundraiser.beneficiaryType) {
    case "ORGANIZATION":
      return fundraiser.organizationName
        ? `Raising funds for ${fundraiser.organizationName}`
        : "Raising funds for an organization";
    case "SOMEONE_ELSE":
      return fundraiser.beneficiaryName
        ? `Raising funds for ${fundraiser.beneficiaryName}`
        : "Raising funds for someone else";
    default:
      return "Raising funds for themselves";
  }
}

const loadFundraiser = cache(async (id: string) => {
  try {
    return await fetchQuery(api.fundraiser.getFundraiserById, {
      fundraiserId: id as Id<"fundraisers">,
    });
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const fundraiser = await loadFundraiser(id);

  if (!fundraiser) {
    return { title: "Fundraiser not found" };
  }

  return {
    title: fundraiser.title,
    description: fundraiser.tagline ?? fundraiser.story.slice(0, 160),
  };
}

export default async function FundraiserPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { donation: donationId, source } = await searchParams;
  // The page depends on the time of the request (has the end date passed?),
  // so it must never be prerendered or reused.
  await connection();
  const fundraiser = await loadFundraiser(id);

  if (!fundraiser) {
    notFound();
  }

  const progress =
    fundraiser.goalAmount > 0
      ? Math.min(
          100,
          Math.round((fundraiser.amountRaised / fundraiser.goalAmount) * 100),
        )
      : 0;

  // The hourly sweep marks a fundraiser EXPIRED, but donations stop at the
  // end date itself, so the page shows it as ended straight away.
  // A server component runs once per request, so reading the clock is fine.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const status =
    fundraiser.status === "ACTIVE" && hasEnded(fundraiser.endDate, now)
      ? "EXPIRED"
      : fundraiser.status;
  const showStatusBadge = status !== "ACTIVE";
  const endNote =
    fundraiser.endDate === undefined
      ? null
      : status === "ACTIVE"
        ? `${describeTimeLeft(fundraiser.endDate, now)} · ends ${formatEndDate(fundraiser.endDate)}`
        : status === "EXPIRED"
          ? `Ended ${formatEndDate(fundraiser.endDate)}`
          : null;

  return (
    <main className="min-h-screen max-w-5xl mx-auto w-full pt-24 px-4 pb-16">
      {donationId && <DonationStatusBanner donationId={donationId} />}
      <div className="grid gap-8 lg:grid-cols-3">
        <section className="space-y-6 lg:col-span-2">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
            {fundraiser.coverImageUrl ? (
              <Image
                src={fundraiser.coverImageUrl}
                alt={fundraiser.title}
                fill
                sizes="(max-width: 1024px) 100vw, 66vw"
                priority
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No photo
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{formatType(fundraiser.type)}</Badge>
              {showStatusBadge && (
                <Badge variant="outline">
                  {STATUS_LABELS[status] ?? status}
                </Badge>
              )}
            </div>

            <PayoutVerificationNotice
              creatorId={fundraiser.creatorId}
              organizationId={fundraiser.organizationId}
            />

            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {fundraiser.title}
              </h1>

              <EditFundraiserButton
                fundraiserId={fundraiser._id}
                creatorId={fundraiser.creatorId}
              />
            </div>

            {fundraiser.tagline && (
              <p className="text-lg text-muted-foreground">
                {fundraiser.tagline}
              </p>
            )}

            <p className="text-sm text-muted-foreground">
              {beneficiaryLine(fundraiser)}
              {fundraiser.location ? ` · ${fundraiser.location}` : ""}
            </p>
          </div>

          <p className="whitespace-pre-wrap text-base leading-relaxed">
            {fundraiser.story}
          </p>
        </section>

        <section className="lg:col-span-1">
          <Card className="sticky top-20 py-6">
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold">
                    {currencyFormatter.format(fundraiser.amountRaised)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    of {currencyFormatter.format(fundraiser.goalAmount)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {fundraiser.donorCount}{" "}
                  {fundraiser.donorCount === 1 ? "donation" : "donations"} ·{" "}
                  {progress}% funded
                </p>
                {endNote && (
                  <p className="text-sm text-muted-foreground">{endNote}</p>
                )}
              </div>

              <DonateButton
                fundraiserId={fundraiser._id}
                disabled={status !== "ACTIVE"}
                // The embed widget links here with ?source=embed. This only
                // labels the donation; it grants nothing.
                source={source === "embed" ? "EMBED" : undefined}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
