"use client";

import { ChevronRight, FileText, Users } from "lucide-react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKes } from "@/components/web/kyc/format";
import {
  MAX_IMPACT_DONATIONS,
  MAX_IMPACT_FUNDRAISERS,
  type Impact,
} from "@/lib/impact";
import { IconChip } from "./card-heading";
import { MyTestimonials } from "./my-testimonials";

export type ImpactFigures = Impact & {
  /** False when there was more than we read, so the figures are a floor. */
  complete: boolean;
};

const NOTHING_YET: ImpactFigures = {
  givenKes: 0,
  raisedKes: 0,
  totalKes: 0,
  fundraisersSupported: 0,
  donationsReceived: 0,
  complete: true,
};

const count = (value: number) => value.toLocaleString("en-KE");

// The big number is 60px, which is wider than a phone once it has more than a
// few digits, so longer amounts step down on small screens.
function headlineSize(text: string): string {
  if (text.length <= 7) return "text-6xl";
  if (text.length <= 11) return "text-5xl sm:text-6xl";
  return "text-4xl sm:text-6xl";
}

/** The figures and what to do next, apart from Convex. */
export function ImpactView({
  impact,
}: {
  /** Undefined while loading; null when there is nobody signed in. */
  impact: ImpactFigures | null | undefined;
}) {
  const loading = impact === undefined;
  const figures = impact ?? NOTHING_YET;
  const hasImpact =
    figures.totalKes > 0 ||
    figures.fundraisersSupported > 0 ||
    figures.donationsReceived > 0;
  const headline = `${formatKes(figures.totalKes)}${figures.complete ? "" : "+"}`;

  return (
    <div className="flex flex-col items-center">
      <Card className="w-full items-center gap-0 px-6 py-10 text-center sm:py-12">
        {loading ? (
          <Skeleton className="h-[60px] w-64" />
        ) : (
          // Not a heading: the profile's name is the page's one h1.
          <p
            className={`font-semibold tabular-nums tracking-tight text-primary ${headlineSize(headline)}`}
          >
            {headline}
          </p>
        )}

        <span
          aria-hidden
          className="mt-5 h-1.5 w-16 rounded-full bg-secondary"
        />

        <p className="mt-5 text-pretty text-lg text-primary/70">
          Your total impact from donating and organising
        </p>
        {hasImpact && (
          <p className="mt-1 text-sm text-primary/70">
            {formatKes(figures.givenKes)} given · {formatKes(figures.raisedKes)}{" "}
            raised by your fundraisers
          </p>
        )}
        {!figures.complete && (
          <p className="mt-2 max-w-md text-xs text-primary/70">
            This counts your {MAX_IMPACT_DONATIONS} most recent donations and{" "}
            {MAX_IMPACT_FUNDRAISERS} most recent fundraisers, so the real total
            is higher.
          </p>
        )}
      </Card>

      <div className="mt-5 grid w-full grid-cols-2 gap-4 sm:gap-5">
        <Card className="gap-3 p-5 sm:flex-row sm:items-center sm:gap-4 sm:p-6">
          <IconChip icon={FileText} />
          <div>
            {loading ? (
              <Skeleton className="h-9 w-12" />
            ) : (
              <div className="text-3xl font-semibold tabular-nums text-primary">
                {count(figures.fundraisersSupported)}
              </div>
            )}
            <p className="text-primary/70">Fundraisers supported</p>
          </div>
        </Card>

        <Card className="gap-3 p-5 sm:flex-row sm:items-center sm:gap-4 sm:p-6">
          <IconChip icon={Users} />
          <div>
            {loading ? (
              <Skeleton className="h-9 w-12" />
            ) : (
              <div className="text-3xl font-semibold tabular-nums text-primary">
                {count(figures.donationsReceived)}
              </div>
            )}
            <p className="text-primary/70">Donations to your fundraisers</p>
          </div>
        </Card>
      </div>

      {!loading && (
        <Link
          href="/fundraisers"
          className="mt-5 block w-full rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          <Card className="rounded-3xl border-0 bg-primary p-8 text-white shadow-none ring-0 transition-opacity hover:opacity-95">
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {hasImpact
                    ? "Keep making a difference"
                    : "Start seeing your impact"}
                </h2>

                <p className="mt-2 max-w-2xl text-base text-white/80">
                  {hasImpact
                    ? "Every donation, and every fundraiser you start, adds to the total above."
                    : "When you donate to or start a fundraiser, you can view your total impact above."}
                </p>
              </div>

              <div className="inline-flex h-11 items-center gap-2 rounded-full bg-secondary px-6 text-base font-semibold text-primary">
                Find a fundraiser
                <ChevronRight className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </Link>
      )}

      <MyTestimonials />
    </div>
  );
}

/** The signed-in person's impact, wired to Convex. */
export function ImpactTab() {
  return <ImpactView impact={useQuery(api.impact.mine)} />;
}
