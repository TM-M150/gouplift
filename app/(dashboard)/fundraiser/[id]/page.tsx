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
import { DonationPopup } from "@/components/web/fundraiser/donation-popup";
import { EditFundraiserButton } from "@/components/web/fundraiser/edit-fundraiser-button";
import { FundraiserComments } from "@/components/web/fundraiser/fundraiser-comments";
import { FundraiserUpdates } from "@/components/web/fundraiser/fundraiser-updates";
import { LiveFundraiserStats } from "@/components/web/fundraiser/live-fundraiser-stats";
import { PayoutVerificationNotice } from "@/components/web/fundraiser/payout-verification-notice";
import { RecentDonations } from "@/components/web/fundraiser/recent-donations";
import { ReportFundraiser } from "@/components/web/fundraiser/report-fundraiser";
import { ShareFundraiser } from "@/components/web/fundraiser/share-fundraiser";
import { UnderReviewNotice } from "@/components/web/fundraiser/under-review-notice";
import { WithdrawNotice } from "@/components/web/fundraiser/withdraw-notice";
import {
  describeTimeLeft,
  formatEndDate,
  hasEnded,
} from "@/lib/fundraiser-dates";
import { shareDescription, shareMetadata } from "@/lib/share";
import { canShareFundraiser } from "@/lib/share-links";
import { absoluteUrl } from "@/lib/seo";
import { UPDATE_POSTING_STATUSES } from "@/lib/updates";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donation?: string; source?: string }>;
}

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

// The totals and the latest donations, as the first draw of the live parts of
// the page. A failure is not an error here: they then start from the totals on
// the fundraiser itself and fill in once the live connection is up.
const loadActivity = cache(async (id: string) => {
  try {
    return await fetchQuery(api.donationActivity.forFundraiser, {
      fundraiserId: id as Id<"fundraisers">,
    });
  } catch {
    return null;
  }
});

// Whether the fundraiser is one that has been suspended, which the page says
// instead of acting as if it doesn't exist. Like loadFundraiser, a failure
// reads as "no".
const loadUnderReview = cache(async (id: string) => {
  try {
    return await fetchQuery(api.fundraiserReports.isUnderReview, {
      fundraiserId: id as Id<"fundraisers">,
    });
  } catch {
    return false;
  }
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const fundraiser = await loadFundraiser(id);

  if (!fundraiser) {
    // A suspended fundraiser gives away nothing (no title, no photo) and is
    // kept out of search results while it is looked into.
    if (await loadUnderReview(id)) {
      return {
        title: "Fundraiser under review",
        robots: { index: false, follow: false },
      };
    }
    return { title: "Fundraiser not found" };
  }

  // The canonical address has no query string, so a link carrying
  // ?donation=... or ?source=... is still the same page to a search engine.
  return shareMetadata({
    path: `/fundraiser/${encodeURIComponent(fundraiser._id)}`,
    title: fundraiser.title,
    description: shareDescription(
      [fundraiser.tagline, fundraiser.story],
      "Support this fundraiser on GoUplift.",
    ),
    images: [fundraiser.coverImageUrl],
    imageAlt: fundraiser.title,
  });
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
    if (await loadUnderReview(id)) {
      return (
        <main className="min-h-screen max-w-5xl mx-auto w-full pt-24 px-4 pb-16">
          {donationId && <DonationStatusBanner donationId={donationId} />}
          <UnderReviewNotice fundraiserId={id as Id<"fundraisers">} />
        </main>
      );
    }
    notFound();
  }

  const activity = (await loadActivity(id)) ?? {
    amountRaised: fundraiser.amountRaised,
    goalAmount: fundraiser.goalAmount,
    donorCount: fundraiser.donorCount,
    recent: [],
  };

  // The same address the link preview names as the page's own, with no query
  // string, so the preview WhatsApp shows is the one for this fundraiser.
  const shareUrl = absoluteUrl(
    `/fundraiser/${encodeURIComponent(fundraiser._id)}`,
  );
  const canShare = canShareFundraiser(fundraiser);

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
      {donationId && (
        <DonationStatusBanner
          donationId={donationId}
          share={
            canShare ? { title: fundraiser.title, url: shareUrl } : undefined
          }
        />
      )}
      {/* grid-cols-1, not the implicit auto column: that one grows to fit its
          widest unbreakable content (a long link in an update, say), and the
          whole page then scrolls sideways on a phone. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
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

            <WithdrawNotice
              fundraiserId={fundraiser._id}
              creatorId={fundraiser.creatorId}
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

            {/* On a phone the donate card is below the whole story, so the
                share row is here too. The desktop one is in the card. */}
            {canShare && (
              <ShareFundraiser
                layout="inline"
                title={fundraiser.title}
                url={shareUrl}
                className="pt-1 lg:hidden"
              />
            )}
          </div>

          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
            {fundraiser.story}
          </p>

          <FundraiserUpdates
            fundraiserId={fundraiser._id}
            creatorId={fundraiser.creatorId}
            canPost={UPDATE_POSTING_STATUSES.has(fundraiser.status)}
            hasDonors={fundraiser.donorCount > 0}
          />

          <FundraiserComments
            fundraiserId={fundraiser._id}
            creatorId={fundraiser.creatorId}
          />
        </section>

        <section className="lg:col-span-1">
          {/* Sticky as one piece, so the report link stays under the card. */}
          <div className="sticky top-20 space-y-3">
            <Card className="py-6">
              <CardContent className="space-y-4">
                <LiveFundraiserStats
                  fundraiserId={fundraiser._id}
                  initial={activity}
                >
                  {endNote && (
                    <p className="text-sm text-muted-foreground">{endNote}</p>
                  )}
                </LiveFundraiserStats>

                <DonateButton
                  fundraiserId={fundraiser._id}
                  disabled={status !== "ACTIVE"}
                  // The embed widget links here with ?source=embed. This only
                  // labels the donation; it grants nothing.
                  source={source === "embed" ? "EMBED" : undefined}
                />

                {canShare && (
                  <ShareFundraiser
                    title={fundraiser.title}
                    url={shareUrl}
                    className="border-t pt-4"
                  />
                )}

                <RecentDonations
                  fundraiserId={fundraiser._id}
                  initial={activity}
                />
              </CardContent>
            </Card>

            <ReportFundraiser
              fundraiserId={fundraiser._id}
              creatorId={fundraiser.creatorId}
            />
          </div>
        </section>
      </div>

      <DonationPopup fundraiserId={fundraiser._id} ownDonationId={donationId} />
    </main>
  );
}
