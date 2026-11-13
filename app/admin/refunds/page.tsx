"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { DonationRefunds } from "@/components/web/admin/donation-refunds";

export default function AdminRefundsPage() {
  const me = useQuery(api.users.getCurrentUser);

  if (me === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }
  // The search finds nothing for anyone who isn't an admin, which would read
  // as "no such fundraiser". Say why instead.
  if (me?.role !== "ADMIN") {
    return (
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Refunds</h1>
        <p className="text-sm text-muted-foreground">
          Only admins can record refunds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Refunds</h1>
        <p className="text-sm text-muted-foreground">
          Send the money back from the SasaPay dashboard, then record it here.
          That takes it off the fundraiser&apos;s total and withdrawable
          balance. For PayPal, refund the payment in PayPal instead and it is
          recorded by itself.
        </p>
      </div>
      <DonationRefunds />
    </div>
  );
}
