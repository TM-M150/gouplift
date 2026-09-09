import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

import { HeroSection } from "@/components/web/organization/view/hero-section";
import { Info } from "@/components/web/organization/view/info";
import { OrganizationFundraisers } from "@/components/web/organization/view/organization-fundraisers";
import { Testimonials } from "@/components/web/organization/view/testimonials";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  // Use the public query here
  const organization = await fetchQuery(
    api.organizations.getPublicOrganizationBySlug,
    { slug },
  );

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

export default function OrganizationPage() {
  return (
    <div className="pt-12">
      <HeroSection />
      <Info />
      <OrganizationFundraisers />
      <Testimonials />
    </div>
  );
}
