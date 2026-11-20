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
      {loading ? (
        <Skeleton className="mt-6 h-[60px] w-64" />
      ) : (
        <h1 className={`mt-6 font-bold ${headlineSize(headline)}`}>
          {headline}
        </h1>
      )}

      <p className="mt-2 text-center text-muted-foreground text-lg">
        Your total impact from donating and organising
      </p>
      {hasImpact && (
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {formatKes(figures.givenKes)} given · {formatKes(figures.raisedKes)}{" "}
          raised by your fundraisers
        </p>
      )}
      {!figures.complete && (
        <p className="mt-1 max-w-md text-center text-xs text-muted-foreground">
          This counts your {MAX_IMPACT_DONATIONS} most recent donations and{" "}
          {MAX_IMPACT_FUNDRAISERS} most recent fundraisers, so the real total is
          higher.
        </p>
      )}

      <Card className="w-full mt-10 grid grid-cols-2 divide-x rounded-2xl p-5 sm:p-8">
        <div className="flex items-center gap-3 sm:gap-4">
          <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
          <div>
            {loading ? (
              <Skeleton className="h-9 w-12" />
            ) : (
              <div className="text-3xl font-bold">
                {count(figures.fundraisersSupported)}
              </div>
            )}
            <p className="text-muted-foreground">Fundraisers supported</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pl-4 sm:gap-4 sm:pl-8">
          <Users className="h-6 w-6 shrink-0 text-muted-foreground" />
          <div>
            {loading ? (
              <Skeleton className="h-9 w-12" />
            ) : (
              <div className="text-3xl font-bold">
                {count(figures.donationsReceived)}
              </div>
            )}
            <p className="text-muted-foreground">
              Donations to your fundraisers
            </p>
          </div>
        </div>
      </Card>

      {!loading && (
        <Link href="/fundraisers" className="block w-full">
          <Card className="mt-8 rounded-3xl border-0 bg-primary p-8 text-white shadow-none transition-opacity hover:opacity-95">
            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">
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

              <div className="inline-flex items-center gap-2 text-lg font-semibold">
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
