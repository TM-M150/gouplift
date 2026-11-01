import { notFound } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/web/organization/dashboard/app-sidebar";
import { SiteHeader } from "@/components/web/organization/dashboard/site-header";
import { VerificationBanner } from "@/components/web/organization/dashboard/verification-banner";
import { EmbedCard } from "@/components/web/organization/developers/embed-card";
import { WebhooksSection } from "@/components/web/organization/developers/webhooks-section";
import { api } from "@/convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const metadata = { title: "Developers" };

// The embed snippet is public information. Webhooks are private, and the
// section that shows them asks the backend, which only answers the owner.
export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  const organization = await fetchAuthQuery(
    api.organizations.getOrganizationBySlug,
    { slug },
  );

  if (!organization) {
    notFound();
  }

  const isVerified = organization.verificationStatus === "VERIFIED";

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant="inset"
        slug={organization.slug}
        organizationId={organization._id}
        organizationName={organization.name}
      />
      <SidebarInset>
        <SiteHeader title="Developers" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <VerificationBanner
                status={organization.verificationStatus}
                rejectionReason={organization.rejectionReason}
              />
              <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
                <EmbedCard slug={organization.slug} isVerified={isVerified} />
                <WebhooksSection
                  organizationId={organization._id}
                  isVerified={isVerified}
                />
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
