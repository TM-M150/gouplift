import { cache } from "react";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import type { Metadata } from "next";
import { DonationStatusBanner } from "@/components/web/donate/donation-status-banner";
import { DonateButton } from "@/components/web/donate/donate-button";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donation?: string }>;
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
  const { donation: donationId } = await searchParams;
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

  const showStatusBadge = fundraiser.status !== "ACTIVE";

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
                  {STATUS_LABELS[fundraiser.status] ?? fundraiser.status}
                </Badge>
              )}
            </div>

            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {fundraiser.title}
            </h1>

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
                  {fundraiser.donorCount === 1 ? "donor" : "donors"} ·{" "}
                  {progress}% funded
                </p>
              </div>

              <DonateButton
                fundraiserId={fundraiser._id}
                disabled={fundraiser.status !== "ACTIVE"}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
