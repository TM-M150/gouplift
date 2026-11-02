"use client";

import { useQuery } from "convex/react";
import {
  Banknote,
  Building2,
  ClipboardCheck,
  Heart,
  Percent,
  Users,
  Wallet,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { StatCard } from "@/components/web/admin/stat-card";
import { formatCount, formatKes } from "@/components/web/admin/format";
import { PlatformDonationsChart } from "@/components/web/admin/platform-donations-chart";

export default function AdminOverviewPage() {
  const attention = useQuery(api.admin.getAttentionCounts);
  const totals = useQuery(api.admin.getPlatformTotals);

  const orgs = attention?.orgsAwaitingVerification;
  const reviews = attention?.fundraisersAwaitingReview;

  const anyCapped =
    !!totals &&
    [
      totals.users,
      totals.activeFundraisers,
      totals.completedDonations,
      totals.pendingPayouts,
    ].some((t) => t.capped);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Platform activity at a glance.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Add href="/admin/organizations" and "/admin/fundraisers"
              as those pages get built. */}
          <StatCard
            title="Organizations awaiting verification"
            icon={Building2}
            value={orgs && formatCount(orgs.count, orgs.capped)}
            hint="Documents waiting for review"
            highlight={!!orgs && orgs.count > 0}
          />
          <StatCard
            title="Fundraisers awaiting review"
            icon={ClipboardCheck}
            value={reviews && formatCount(reviews.count, reviews.capped)}
            hint="Waiting for approval"
            highlight={!!reviews && reviews.count > 0}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Platform</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            title="Users"
            icon={Users}
            value={
              totals && formatCount(totals.users.count, totals.users.capped)
            }
          />
          <StatCard
            title="Active fundraisers"
            icon={Heart}
            value={
              totals &&
              formatCount(
                totals.activeFundraisers.count,
                totals.activeFundraisers.capped,
              )
            }
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            title="Gross volume"
            icon={Banknote}
            value={
              totals &&
              formatKes(
                totals.completedDonations.grossVolume,
                totals.completedDonations.capped,
              )
            }
            hint={
              totals &&
              `${formatCount(
                totals.completedDonations.count,
                totals.completedDonations.capped,
              )} completed donations`
            }
          />
          <StatCard
            title="Platform fees"
            icon={Percent}
            value={
              totals &&
              formatKes(
                totals.completedDonations.platformFees,
                totals.completedDonations.capped,
              )
            }
            hint="Earned on completed donations"
          />
          <StatCard
            title="Owed to organizers"
            icon={Wallet}
            value={
              totals &&
              formatKes(
                totals.pendingPayouts.netOwed,
                totals.pendingPayouts.capped,
              )
            }
            hint={
              totals &&
              `${formatCount(
                totals.pendingPayouts.count,
                totals.pendingPayouts.capped,
              )} donations pending payout`
            }
          />
        </div>
        {anyCapped && totals && (
          <p className="text-xs text-muted-foreground">
            A &quot;+&quot; means the count hit its {totals.cap}-record limit,
            so the real figure is higher.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Donations</h2>
        <PlatformDonationsChart />
      </section>
    </div>
  );
}
