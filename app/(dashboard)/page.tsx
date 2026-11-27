import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";

import { Causes } from "@/components/web/home/causes";
import { FeaturedSection } from "@/components/web/home/featured-section";
import { FinalCta } from "@/components/web/home/final-cta";
import { HomeFaq } from "@/components/web/home/home-faq";
import { HomeHero } from "@/components/web/home/home-hero";
import { HowItWorks } from "@/components/web/home/how-it-works";
import { OrganizationsSection } from "@/components/web/home/organizations-section";
import { Testimonials } from "@/components/web/home/testimonials";
import { TrustSection } from "@/components/web/home/trust-section";
import { WaysToGive } from "@/components/web/home/ways-to-give";
import { api } from "@/convex/_generated/api";
import { PLATFORM_FEE_RATE } from "@/convex/lib/constants";
import {
  SHARE_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";

// Statically rendered and refreshed in the background, like /fundraisers.
export const dynamic = "force-static";
export const revalidate = 60;

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_KE",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

// Read from the same constant the donation flow charges, so the homepage
// can never drift from what donors are actually billed.
const platformFeePercent = Number((PLATFORM_FEE_RATE * 100).toFixed(2));

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Live homepage data. Every piece is optional: if Convex is unreachable, or
 * there is nothing to show yet, the page renders without that section
 * instead of failing or showing placeholders.
 */
async function loadHomepageData() {
  // Rounded so repeated renders share one cached query result.
  const now = Math.floor(Date.now() / FIVE_MINUTES) * FIVE_MINUTES;

  const [featured, stats, testimonials] = await Promise.all([
    fetchQuery(api.fundraiser.listFeaturedFundraisers, { now }).catch(() => []),
    fetchQuery(api.platformStats.get, {}).catch(() => null),
    fetchQuery(api.testimonials.listPublic, {}).catch(() => []),
  ]);

  return { featured, stats, testimonials };
}

export default async function Home() {
  const { featured, stats, testimonials } = await loadHomepageData();

  return (
    <>
      <HomeHero fundraiser={featured[0]} stats={stats} />
      <HowItWorks feePercent={platformFeePercent} />
      <Causes />
      <FeaturedSection
        fundraisers={featured.slice(1)}
        categories={stats?.categories ?? []}
      />
      <WaysToGive />
      <TrustSection feePercent={platformFeePercent} />
      <OrganizationsSection />
      <Testimonials testimonials={testimonials} />
      <HomeFaq feePercent={platformFeePercent} />
      <FinalCta />
    </>
  );
}
