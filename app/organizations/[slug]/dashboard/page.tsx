import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/web/organization/dashboard/app-sidebar";
import { ChartAreaInteractive } from "@/components/web/organization/dashboard/chart-area-interactive";
import { DataTable } from "@/components/web/organization/dashboard/data-table";
import { SectionCards } from "@/components/web/organization/dashboard/section-cards";
import { SiteHeader } from "@/components/web/organization/dashboard/site-header";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { fetchAuthQuery } from "@/lib/auth-server";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  const organization = await fetchAuthQuery(
    api.organizations.getOrganizationById,
    {
      organizationId: id as Id<"organizations">,
    },
  );

  if (!organization) {
    notFound();
  }

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
        organizationId={organization._id}
        organizationName={organization.name}
      />
      <SidebarInset>
        <SiteHeader title="Dashboard" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <SectionCards organizationId={organization._id} />
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive organizationId={organization._id} />
              </div>
              <DataTable organizationId={organization._id} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
