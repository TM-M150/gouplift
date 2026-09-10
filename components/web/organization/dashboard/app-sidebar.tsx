"use client";

import * as React from "react";
import Link from "next/link";
import {
  IconBuilding,
  IconDashboard,
  IconExternalLink,
  IconListDetails,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavMain } from "./nav-main";
import { NavSecondary } from "./nav-secondary";
import { NavUser } from "./nav-user";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  slug: string;
  organizationId: string;
  organizationName?: string;
}

export function AppSidebar({
  slug,
  organizationId,
  organizationName,
  ...props
}: AppSidebarProps) {
  const { data: session, isPending } = authClient.useSession();
  const { user: currentUser } = session ?? {};

  const profile = useQuery(api.users.getCurrentUserProfile);

  const navMain = [
    {
      title: "Dashboard",
      url: `/organizations/${slug}/dashboard`,
      icon: IconDashboard,
    },
    {
      title: "Fundraisers",
      url: `#`,
      icon: IconListDetails,
    },
    {
      title: "Members",
      url: `#`,
      icon: IconUsers,
    },
  ];

  const navSecondary = [
    {
      title: "Settings",
      url: `#`,
      icon: IconSettings,
    },
    {
      title: "View public page",
      url: `/organizations/${slug}`,
      icon: IconExternalLink,
    },
  ];

  const { name = "", email = "", image = "" } = currentUser ?? {};
  const avatarUrl = profile?.image || image || "";

  const user = {
    name: name || "",
    email: email || "",
    avatar: avatarUrl,
  };

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`/organizations/${slug}/dashboard`} />}
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <IconBuilding className="size-5!" />
              <span className="text-base font-semibold">
                {organizationName ?? "Organization"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navMain}
          quickCreate={{
            title: "New Fundraiser",
            url: `/fundraiser-form?organizationId=${organizationId}`,
          }}
        />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>{!isPending && <NavUser user={user} />}</SidebarFooter>
    </Sidebar>
  );
}
