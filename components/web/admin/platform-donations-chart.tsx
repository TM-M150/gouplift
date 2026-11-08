"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

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
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlatformDonationSeries } from "./use-platform-series";
import { formatKes } from "./format";

const RANGES = {
  "7d": { days: 7, label: "Last 7 days" },
  "30d": { days: 30, label: "Last 30 days" },
  "90d": { days: 90, label: "Last 3 months" },
} as const;

type RangeKey = keyof typeof RANGES;

const RANGE_ITEMS = Object.entries(RANGES).map(([value, r]) => ({
  value,
  label: r.label,
}));

const chartConfig = {
  netAmount: { label: "Net to organizers", color: "var(--primary)" },
  platformFeeAmount: { label: "Platform fees", color: "var(--secondary)" },
} satisfies ChartConfig;

// Dates are plain "YYYY-MM-DD" East Africa calendar days. Format them in UTC
// so a viewer in another time zone never sees the day shifted.
function formatDay(value: string, withYear = false) {
  return new Date(value).toLocaleDateString("en-KE", {
    month: "short",
    day: "numeric",
    ...(withYear && { year: "numeric" }),
    timeZone: "UTC",
  });
}

export function PlatformDonationsChart() {
  const isMobile = useIsMobile();
  const [timeRange, setTimeRange] = React.useState<RangeKey>("90d");

  React.useEffect(() => {
    if (isMobile) setTimeRange("7d");
  }, [isMobile]);

  // One 90-day subscription; the toggle only slices it, so switching
  // ranges never flashes a loading state.
  const series = usePlatformDonationSeries();
  const range = RANGES[timeRange];

  const data = React.useMemo(
    () => series?.days.slice(-range.days) ?? [],
    [series, range.days],
  );

  const totals = React.useMemo(
    () =>
      data.reduce(
        (acc, d) => ({
          gross: acc.gross + d.grossAmount,
          fees: acc.fees + d.platformFeeAmount,
          count: acc.count + d.donationCount,
        }),
        { gross: 0, fees: 0, count: 0 },
      ),
    [data],
  );

  const hasData = totals.count > 0;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Donations</CardTitle>
        <CardDescription>
          {hasData && (
            <span className="hidden @[540px]/card:inline">
              {formatKes(totals.gross)} raised · {formatKes(totals.fees)} in
              fees ·{" "}
            </span>
          )}
          <span>{range.label}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            value={[timeRange]}
            onValueChange={(value) => {
              if (value[0]) setTimeRange(value[0] as RangeKey);
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
            items={RANGE_ITEMS}
            onValueChange={(value) => {
              if (value !== null) setTimeRange(value as RangeKey);
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a time range"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {RANGE_ITEMS.map((item) => (
                <SelectItem
                  key={item.value}
                  value={item.value}
                  className="rounded-lg"
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {series === undefined ? (
          <Skeleton className="h-[250px] w-full" />
        ) : hasData ? (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={data}>
              <defs>
                <linearGradient id="fillNet" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-netAmount)"
                    stopOpacity={1.0}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-netAmount)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="fillFee" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-platformFeeAmount)"
                    stopOpacity={0.9}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-platformFeeAmount)"
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
                tickFormatter={(value) => formatDay(value)}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatDay(value, true)}
                    // A custom formatter replaces the whole row, so render
                    // the series name and colour dot ourselves.
                    formatter={(value, name, item) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          {chartConfig[name as keyof typeof chartConfig]
                            ?.label ?? name}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatKes(Number(value))}
                        </span>
                      </div>
                    )}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="netAmount"
                type="natural"
                fill="url(#fillNet)"
                stroke="var(--color-netAmount)"
                stackId="a"
              />
              <Area
                dataKey="platformFeeAmount"
                type="natural"
                fill="url(#fillFee)"
                stroke="var(--color-platformFeeAmount)"
                stackId="a"
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

        {series?.truncated && (
          <p className="px-2 pt-3 text-xs text-muted-foreground">
            Very busy period: the oldest days in this range may be incomplete.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
