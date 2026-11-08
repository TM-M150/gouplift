"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { startOfTodayEat } from "@/lib/time";

export function usePlatformDonationSeries() {
  // Computed once per mount, so the args stay identical and Convex can cache.
  const [startOfToday] = React.useState(() => startOfTodayEat(Date.now()));
  return useQuery(api.admin.getPlatformDonationSeries, {
    startOfToday,
    days: 90,
  });
}
