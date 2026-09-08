"use client";

import { IconTrendingUp } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SectionCardsProps {
  organizationId: string;
}

function formatKES(amount: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function SectionCards({ organizationId }: SectionCardsProps) {
  const stats = useQuery(api.organizations.getOrganizationDashboardStats, {
    organizationId: organizationId as Id<"organizations">,
  });

  const totalRaised = stats?.totalRaised ?? 0;
  const activeFundraisers = stats?.activeFundraisers ?? 0;
  const totalDonors = stats?.totalDonors ?? 0;
  const avgDonation = stats?.avgDonation ?? 0;
  const isLoading = stats === undefined;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {/* Total Raised */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Total Raised</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {isLoading ? "—" : formatKES(totalRaised)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <IconTrendingUp />
              All time
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Across all fundraisers
          </div>
          <div className="text-muted-foreground">Net amount received</div>
        </CardFooter>
      </Card>

      {/* Active Fundraisers */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Active Fundraisers</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {isLoading ? "—" : activeFundraisers.toLocaleString()}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">Live</Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Currently collecting
          </div>
          <div className="text-muted-foreground">Status = Active</div>
        </CardFooter>
      </Card>

      {/* Total Donors */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Total Donors</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {isLoading ? "—" : totalDonors.toLocaleString()}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">All time</Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Supporters across campaigns
          </div>
          <div className="text-muted-foreground">Sum of fundraiser donors</div>
        </CardFooter>
      </Card>

      {/* Avg. Donation */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Avg. Donation</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {isLoading ? "—" : formatKES(avgDonation)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">Completed</Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Per completed donation
          </div>
          <div className="text-muted-foreground">Based on net amount</div>
        </CardFooter>
      </Card>
    </div>
  );
}
