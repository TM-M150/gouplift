import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

import { HeroSection } from "@/components/web/organization/view/hero-section";
import { Info } from "@/components/web/organization/view/info";
import { OrganizationFundraisers } from "@/components/web/organization/view/organization-fundraisers";
import { Testimonials } from "@/components/web/organization/view/testimonials";

type Props = {
  params: Promise<{ slug: string }>;
};

// generateMetadata and the page both need the organization; cache() makes
// them share one query per request.
const getOrganization = cache((slug: string) =>
  fetchQuery(api.organizations.getPublicOrganization, { slug }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  const organization = await getOrganization(slug);

  if (!organization) {
    return {
      title: "Organization Not Found | GoUplift",
      description: "The requested organization could not be found.",
    };
  }

  return {
    title: `${organization.name} | GoUplift`,
    description:
      organization.description ??
      `Support and learn more about ${organization.name} on GoUplift.`,
  };
}

export default async function OrganizationPage({ params }: Props) {
  const { slug } = await params;

  const organization = await getOrganization(slug);

  if (!organization) {
    notFound();
  }

  return (
    <div className="pt-12">
      <HeroSection organization={organization} />
      <Info organization={organization} />
      <OrganizationFundraisers organizationId={organization._id} />
      <Testimonials />
    </div>
  );
}
