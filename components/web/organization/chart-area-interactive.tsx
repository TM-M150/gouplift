"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export const description = "Organization donations over time";

const chartConfig = {
  amount: {
    label: "Amount Raised",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

interface ChartAreaInteractiveProps {
  organizationId: string;
}

export function ChartAreaInteractive({
  organizationId,
}: ChartAreaInteractiveProps) {
  const isMobile = useIsMobile();
  const [timeRange, setTimeRange] = React.useState("90d");

  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;

  // Real data from Convex
  // Returns: { date: string; amount: number }[] | undefined
  const chartData = useQuery(api.organizations.getDonationStats, {
    organizationId: organizationId as Id<"organizations">,
    days,
  });

  const data = chartData ?? [];

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d");
    }
  }, [isMobile]);

  const totalRaised = data.reduce((sum, d) => sum + d.amount, 0);
  const hasData = data.length > 0;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Donations Raised</CardTitle>
        <CardDescription>
          {hasData ? (
            <span className="hidden @[540px]/card:block">
              Total:{" "}
              {new Intl.NumberFormat("en-KE", {
                style: "currency",
                currency: "KES",
                maximumFractionDigits: 0,
              }).format(totalRaised)}{" "}
              · last{" "}
              {timeRange === "7d"
                ? "7 days"
                : timeRange === "30d"
                  ? "30 days"
                  : "3 months"}
            </span>
          ) : (
            <span>
              {timeRange === "7d"
                ? "Last 7 days"
                : timeRange === "30d"
                  ? "Last 30 days"
                  : "Last 3 months"}
            </span>
          )}
          {hasData && (
            <span className="@[540px]/card:hidden">
              {timeRange === "7d"
                ? "Last 7 days"
                : timeRange === "30d"
                  ? "Last 30 days"
                  : "Last 3 months"}
            </span>
          )}
        </CardDescription>
        <CardAction>
          <ToggleGroup
            value={[timeRange]}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d");
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value);
              }
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {hasData ? (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={data}>
              <defs>
                <linearGradient id="fillAmount" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-amount)"
                    stopOpacity={1.0}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-amount)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-KE", {
                    month: "short",
                    day: "numeric",
                  });
                }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("en-KE", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      });
                    }}
                    formatter={(value) =>
                      new Intl.NumberFormat("en-KE", {
                        style: "currency",
                        currency: "KES",
                        maximumFractionDigits: 0,
                      }).format(Number(value))
                    }
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="amount"
                type="natural"
                fill="url(#fillAmount)"
                stroke="var(--color-amount)"
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[250px] w-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No donation data yet
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
