import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import {
  ArrowLeftRight,
  ChevronRight,
  Eye,
  FileText,
  LineChart,
  Pencil,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import Logo from "@/components/icons/logo";
import { CategoryChips } from "@/components/web/home/category-chips";
import { FeaturedFundraisers } from "@/components/web/home/featured-fundraisers";
import { PlatformStats } from "@/components/web/home/platform-stats";
import { StartFundraiserLink } from "@/components/web/home/start-fundraiser-link";
import { Testimonials } from "@/components/web/home/testimonials";
import { HeroStage } from "@/components/web/home/hero-stage";
import { AmountSlips, GoalRing } from "@/components/web/home/panel-art";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { PLATFORM_FEE_RATE } from "@/convex/lib/constants";
import {
  SHARE_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site";
import { cn } from "@/lib/utils";

// Statically rendered and refreshed in the background, like /fundraisers.
export const dynamic = "force-static";
export const revalidate = 60;

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_KE",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

// Read from the same constant the donation flow charges, so the homepage
// can never drift from what donors are actually billed.
const platformFeePercent = Number((PLATFORM_FEE_RATE * 100).toFixed(2));

interface Features {
  icon: LucideIcon;
  title: string;
  description: string;
}

const OrganizerFeatures: Features[] = [
  {
    icon: Target,
    title: "Set your goal.",
    description:
      "Choose a target in Kenyan shillings and watch progress toward it.",
  },
  {
    icon: FileText,
    title: "Tell your story.",
    description:
      "Add a cover photo, your story and a location so donors know who they are helping.",
  },
  {
    icon: Pencil,
    title: "Edit any time.",
    description:
      "Update your story, goal and photo as your fundraiser moves along.",
  },
  {
    icon: Eye,
    title: "Visible progress.",
    description:
      "Donors see the amount raised, the goal and how many people have given.",
  },
];

const CampaignFeatures: Features[] = [
  {
    icon: ArrowLeftRight,
    title: "Fundraiser tracking.",
    description:
      "Follow the progress of each of your fundraisers toward its goal in one place.",
  },
  {
    icon: Users,
    title: "Team access.",
    description:
      "Invite teammates to your organization so they can run fundraisers with you.",
  },
  {
    icon: FileText,
    title: "Organization page.",
    description:
      "Show all of your organization's fundraisers together on one public page.",
  },
  {
    icon: LineChart,
    title: "Clear progress.",
    description:
      "A progress bar on every fundraiser shows donors how close it is to its goal.",
  },
];

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Live homepage data. Every piece is optional: if Convex is unreachable, or
 * there is nothing to show yet, the page renders without that section
 * instead of failing or showing placeholders.
 */
async function loadHomepageData() {
  // Rounded so repeated renders share one cached query result.
  const now = Math.floor(Date.now() / FIVE_MINUTES) * FIVE_MINUTES;

  const [featured, stats, testimonials] = await Promise.all([
    fetchQuery(api.fundraiser.listFeaturedFundraisers, { now }).catch(
      () => [],
    ),
    fetchQuery(api.platformStats.get, {}).catch(() => null),
    fetchQuery(api.testimonials.listPublic, {}).catch(() => []),
  ]);

  return { featured, stats, testimonials };
}

export default async function Home() {
  const { featured, stats, testimonials } = await loadHomepageData();

  return (
    <div className="overflow-hidden">
      <section>
        <div className="relative pt-24 md:pt-36">
          <div className="mx-auto max-w-7xl">
            <div className="px-6 text-center sm:mx-auto lg:mr-auto lg:mt-0">
              <Link
                href="/organizations/new"
                className="group/arrow inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors"
              >
                <Badge variant="secondary" className="rounded-full text-xs">
                  For organizations
                </Badge>
                <span>Get started</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover/arrow:translate-x-1" />
              </Link>

              <h1 className="mx-auto mt-8 max-w-4xl text-balance text-5xl font-medium tracking-tight md:text-6xl lg:mt-12 xl:text-7xl">
                Powering the movements changing the world
              </h1>
              <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-balance md:text-lg">
                Tell your story, set a goal and start accepting donations in
                Kenyan shillings through SasaPay, or in US dollars through
                PayPal.
              </p>

              <div className="mt-6 flex flex-col items-center justify-center gap-2 md:flex-row">
                <StartFundraiserLink className="text-nowrap" />

                <Link
                  href="/fundraisers"
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "text-nowrap",
                  )}
                >
                  Browse fundraisers
                </Link>
              </div>
            </div>
            <div className="relative mt-8 overflow-hidden p-6 sm:mt-16">
              {/* 1. Ambient Background Gradient & Top-Fade Mask */}
              <div className="mask-t-from-25% mask-t-to-65% bg-linear-to-b border-zinc-700/50 absolute inset-0 -z-10 rounded-2xl border to-zinc-600" />

              {/* 2. Top-Left Radial Glow Ring Overlay */}
              <div className="before:mask-radial-at-top-left before:mask-radial-from-65% before:mask-radial-[100%_60%] before:ring-foreground before:border-foreground/10 pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-white/10 before:absolute before:-inset-px before:z-10 before:size-56 before:rounded-tl-2xl before:border-l before:border-t" />
              <HeroStage fundraiser={featured[0]} />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-background pb-16 pt-6 md:pb-32">
        <div className="mx-auto max-w-7xl">
          <div className="px-6 text-center sm:mx-auto lg:mr-auto lg:mt-0">
            <Badge className="rounded-full text-sm">
              Free to start · {platformFeePercent}% platform fee on donations
            </Badge>
            <h2 className="mx-auto mt-8 max-w-4xl text-balance text-5xl font-medium tracking-tight md:text-6xl lg:mt-12 xl:text-7xl">
              Start raising funds for what matters in minutes
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-balance md:text-lg">
              Create a fundraiser, add your story and your goal, then share the
              link with the people who want to help.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-muted-foreground max-w-4xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
            <span className="text-foreground">Every fundraiser, one view.</span>{" "}
            <br /> Progress and people in one place.
          </h2>
          <div className="*:bg-background mt-8 grid gap-3 md:mt-16 md:grid-cols-2 lg:grid-cols-3">
            <Card className="p-8">
              <p className="text-muted-foreground max-w-xs text-lg font-medium">
                <span className="text-foreground">One place to look.</span> See
                how much each fundraiser has raised and how many people have
                given.
              </p>

              <div className="my-16">
                <div
                  aria-hidden
                  className="bg-background relative mx-auto aspect-square w-10/12 rounded-xl border"
                >
                  <div className="bg-card ring-foreground/6.5 absolute bottom-0 right-0 aspect-square w-3/5 translate-x-8 translate-y-16 rounded-xl shadow-xl ring" />
                </div>
              </div>
            </Card>
            <Card className="p-8 lg:col-span-2">
              <p className="text-muted-foreground max-w-xs text-lg font-medium">
                <span className="text-foreground">Donations on record.</span>{" "}
                Every donation is recorded against its fundraiser, so your
                progress toward the goal stays up to date.
              </p>

              <div className="mask-x-from-65% mt-6 pt-2">
                <div
                  aria-hidden
                  className="bg-linear-to-b from-foreground/5 ring-foreground/6.5 relative h-72 rounded-xl shadow-xl ring"
                ></div>
              </div>
            </Card>
          </div>
          <div className="max-sm:*:not-last:border-b max-sm:*:not-last:pb-3 mt-12 grid gap-3 sm:grid-cols-2 md:mt-16 md:gap-y-6 lg:mt-24 lg:grid-cols-4 lg:gap-6">
            {CampaignFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <p
                  key={feature.title}
                  className="text-muted-foreground text-balance"
                >
                  <span className="text-foreground font-medium">
                    <Icon className="inline size-4 -translate-y-0.5 text-emerald-500" />{" "}
                    {feature.title}
                  </span>{" "}
                  {feature.description}
                </p>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            <h2 className="text-muted-foreground max-w-4xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
              <span className="text-foreground">Fund more causes.</span>{" "}
              <br /> Empower every campaign.
            </h2>
            <p className="text-muted-foreground text-balance text-lg md:mx-auto">
              GoUplift is a crowdfunding platform for individuals, communities
              and organizations in Kenya. Raise money for medical bills, school
              fees, funerals, harambees and community projects, and let your
              supporters give through SasaPay or PayPal.
            </p>
          </div>
          <PlatformStats stats={stats} />
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="text-muted-foreground max-w-4xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
            <span className="text-foreground">Built for teams.</span> <br />
            Run fundraisers together.
          </h2>
          <div className="*:bg-background mt-8 grid gap-3 md:mt-16 md:grid-cols-2 lg:grid-cols-3">
            <Card className="p-8">
              <p className="text-muted-foreground max-w-xs text-lg font-medium">
                <span className="text-foreground">Clear ownership.</span> Every
                fundraiser shows who is raising the funds.
              </p>

              <div className="my-16">
                <div
                  aria-hidden
                  className="relative mx-auto aspect-square w-10/12"
                >
                  <div className="mask-b-from-75% absolute inset-0">
                    <div className="bg-background h-full rounded-xl border"></div>
                  </div>
                  <div className="bg-card ring-foreground/6.5 absolute bottom-0 right-0 aspect-square w-3/5 translate-x-8 translate-y-16 rounded-xl shadow-xl shadow-black/5 ring" />
                </div>
              </div>
            </Card>
            <Card className="p-8">
              <p className="text-muted-foreground max-w-xs text-lg font-medium">
                <span className="text-foreground">Give your way.</span> Donate
                in Kenyan shillings through SasaPay, or in US dollars through
                PayPal.
              </p>

              <div className="mask-x-from-65% relative mt-6 pt-2">
                <div
                  aria-hidden
                  className="bg-linear-to-b from-card to-background ring-foreground/6.5 relative h-72 rounded-xl shadow-xl ring"
                ></div>
              </div>
            </Card>
            <Card className="p-8">
              <p className="text-muted-foreground max-w-xs text-lg font-medium">
                <span className="text-foreground">Invite your team.</span> Add
                teammates to your organization so they can run fundraisers under
                its name.
              </p>

              <div className="mask-b-from-75% mt-16">
                <div
                  aria-hidden
                  className="bg-background relative mx-auto flex aspect-square flex-col justify-between rounded-xl border pb-6"
                >
                  <div className="flex gap-1 border-b p-3">
                    <div className="bg-foreground/10 size-1 rounded-full"></div>
                    <div className="bg-foreground/10 size-1 rounded-full"></div>
                    <div className="bg-foreground/10 size-1 rounded-full"></div>
                  </div>

                  <div className="bg-card ring-foreground/6.5 mx-6 mt-auto aspect-video rounded-xl shadow-xl ring" />
                </div>
              </div>
            </Card>
          </div>
          <div className="max-sm:*:not-last:border-b max-sm:*:not-last:pb-3 mt-12 grid gap-3 sm:grid-cols-2 md:mt-16 md:gap-y-6 lg:mt-24 lg:grid-cols-4 lg:gap-6">
            {OrganizerFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <p
                  key={feature.title}
                  className="text-muted-foreground text-balance"
                >
                  <span className="text-foreground font-medium">
                    <Icon className="inline size-4 -translate-y-0.5 text-emerald-500" />{" "}
                    {feature.title}
                  </span>{" "}
                  {feature.description}
                </p>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl space-y-8 px-6 md:space-y-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-balance text-4xl font-medium tracking-tight lg:text-5xl">
              Find a cause to support
            </h2>
            <Link
              href="/fundraisers"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Browse fundraisers
            </Link>
          </div>

          <CategoryChips categories={stats?.categories ?? []} />
          <FeaturedFundraisers fundraisers={featured.slice(1)} />

          <div className="grid gap-3 lg:grid-cols-5">
            <div className="after:border-foreground/10 relative overflow-hidden rounded-xl bg-stone-100 p-8 after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:border lg:col-span-3 lg:row-span-2">
              <AmountSlips />

              <div className="min-h-100 relative flex flex-col justify-between">
                <p className="max-w-lg text-3xl text-black">
                  Every contribution counts.
                </p>

                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
                  <Logo size={40} className="w-10 h-10 my-auto" />
                  <div className="border-l border-black/10 pl-4">
                    <p className="text-sm font-medium text-black">GoUplift</p>
                    <span className="block text-sm text-black/65">
                      A crowdfunding platform
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="inset-ring inset-ring-foreground/10 min-h-100 relative grid gap-8 overflow-hidden rounded-xl bg-emerald-600 p-8 lg:col-span-2 lg:row-span-2 lg:grid-rows-subgrid">
              <GoalRing />
              <div className="bg-linear-to-b pointer-events-none absolute inset-0 to-black/25" />
              <p className="max-w-lg text-balance text-3xl">
                Every shilling brings a fundraiser closer to its goal.
              </p>

              <div className="relative grid grid-cols-[auto_1fr] items-center gap-4 self-end" />
            </div>
          </div>
        </div>
      </section>

      <Testimonials testimonials={testimonials} />

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-balance text-4xl font-semibold tracking-tight lg:text-5xl xl:text-6xl">
              Start a fundraiser for a cause you care about.
            </h2>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <StartFundraiserLink className="text-nowrap" />

              <Link
                href="/fundraisers"
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "text-nowrap",
                )}
              >
                Browse fundraisers
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
