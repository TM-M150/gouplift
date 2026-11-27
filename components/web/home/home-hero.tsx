import type { FundraiserCardData } from "@/components/web/fundraiser/fundraiser-card";
import { CtaButtons } from "@/components/web/home/cta-buttons";
import { HeroStage } from "@/components/web/home/hero-stage";
import {
  PlatformStats,
  type PlatformStatsData,
} from "@/components/web/home/platform-stats";

/**
 * The top of the page, on the logo's deep green. The words say what GoUplift
 * is for and how people give. Beside them is a real fundraiser when there is
 * one to show (see HeroStage), and the live totals sit along the bottom.
 */
export function HomeHero({
  fundraiser,
  stats,
}: {
  fundraiser: FundraiserCardData | undefined;
  stats: PlatformStatsData | null;
}) {
  return (
    <section
      aria-labelledby="home-title"
      className="bg-primary text-primary-foreground"
    >
      <div className="mx-auto grid max-w-7xl gap-12 px-6 pb-16 pt-28 sm:pt-32 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pb-24 lg:pt-40">
        <div>
          <h1
            id="home-title"
            className="text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl"
          >
            Every harambee starts with a link.
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg text-white/75 md:text-xl">
            Tell your story, set a goal in Kenyan shillings and share your
            fundraiser page. Supporters don&apos;t need an account to give.
          </p>
          <CtaButtons className="mt-9" />
          <p className="mt-8 max-w-xl text-sm text-white/65">
            Supporters pay with M-Pesa, Airtel Money or a card in shillings, or
            with PayPal in US dollars.
          </p>
        </div>

        <HeroStage fundraiser={fundraiser} />
      </div>

      <PlatformStats stats={stats} />
    </section>
  );
}
