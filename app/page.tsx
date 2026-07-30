import Logo from "@/components/icons/logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  Bell,
  ChevronRight,
  LineChart,
  Megaphone,
  ShieldCheck,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface Features {
  icon: LucideIcon;
  title: string;
  description: string;
}

const OrganizerFeatures: Features[] = [
  {
    icon: Target,
    title: "Smart target setting.",
    description:
      "Set flexible or fixed fundraising targets with custom milestones.",
  },
  {
    icon: Wallet,
    title: "Instant payouts.",
    description:
      "Access raised funds seamlessly as donations roll into your wallet.",
  },
  {
    icon: Megaphone,
    title: "Organizer updates.",
    description:
      "Broadcast stories and progress logs directly to your supporters.",
  },
  {
    icon: ShieldCheck,
    title: "Verified trust.",
    description:
      "Give donors full confidence with identity verification and transparent fund tracking.",
  },
];

const CampaignFeatures: Features[] = [
  {
    icon: ArrowLeftRight,
    title: "Campaign tracking.",
    description:
      "Monitor every active fundraiser, milestone, and target in one view.",
  },
  {
    icon: Bell,
    title: "Donor history.",
    description:
      "Keep contributions, supporter notes, and updates tied to your cause.",
  },
  {
    icon: Users,
    title: "Supporter network.",
    description:
      "Organizers and volunteers work together to amplify campaign reach.",
  },
  {
    icon: LineChart,
    title: "Goal momentum.",
    description:
      "Track donation velocity and celebrate milestones as you hit your targets.",
  },
];

const testimonials = [
  {
    avatar:
      "https://images.unsplash.com/photo-1728577740843-5f29c7586afe?q=80&w=580&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    name: "Meschac Irung",
    quote:
      "Gouplift has been a game-changer for our team. It has helped us to build a modern and scalable web application.",
  },
  {
    avatar:
      "https://images.unsplash.com/photo-1620510625142-b45cbb784397?q=80&w=1372&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    name: "Theo Balick",
    quote:
      "Gouplift has been a game-changer for our team. It has helped us to build a modern and scalable web application.",
  },
  {
    avatar:
      "https://images.unsplash.com/photo-1740252117044-2af197eea287?q=80&w=580&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    name: "Sarah Johnson",
    quote:
      "Gouplift has been a game-changer for our team. It has helped us to build a modern and scalable web application.",
  },
  {
    avatar:
      "https://images.unsplash.com/photo-1740252117070-7aa2955b25f8?q=80&w=580&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    name: "Aisha Patel",
    quote:
      "Gouplift has been a game-changer for our team. It has helped us to build a modern and scalable web application.",
  },
];

export const revalidate = 60 * 60 * 24; // 24 hours

export default function Home() {
  return (
    <>
      <main className="overflow-hidden">
        <section>
          <div className="relative pt-24 md:pt-36">
            <div className="mx-auto max-w-7xl">
              <div className="px-6 text-center sm:mx-auto lg:mr-auto lg:mt-0">
                <Link
                  href="#"
                  className="group/arrow inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors"
                >
                  <Badge variant="secondary" className="rounded-full text-xs">
                    An Organization
                  </Badge>
                  <span>Follow this link to get started</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-hover/arrow:translate-x-1" />
                </Link>

                <h1 className="mx-auto mt-8 max-w-4xl text-balance text-5xl font-medium tracking-tight md:text-6xl lg:mt-12 xl:text-7xl">
                  Powering the movements changing the world
                </h1>
                <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-balance md:text-lg">
                  Bring your vision to life with zero platform friction.
                  Everything you need to launch, tell your story, and turn
                  supporters into long-term champions.
                </p>

                <div className="mt-6 flex flex-col items-center justify-center gap-2 md:flex-row">
                  <Link
                    href="#"
                    className={cn(
                      buttonVariants({ variant: "default" }),
                      "text-nowrap",
                    )}
                  >
                    Start a Fundraiser
                  </Link>

                  <Link
                    href="#"
                    className={cn(
                      buttonVariants({ variant: "ghost" }),
                      "text-nowrap",
                    )}
                  >
                    Sign up
                  </Link>
                </div>
              </div>
              <div className="relative mt-8 overflow-hidden p-6 max-sm:-mr-56 sm:mt-16">
                {/* 1. Ambient Background Gradient & Top-Fade Mask */}
                <div className="mask-t-from-25% mask-t-to-65% bg-linear-to-b border-zinc-700/50 absolute inset-0 -z-10 rounded-2xl border to-zinc-600" />

                {/* 2. Top-Left Radial Glow Ring Overlay */}
                <div className="before:mask-radial-at-top-left before:mask-radial-from-65% before:mask-radial-[100%_60%] before:ring-foreground before:border-foreground/10 pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-white/10 before:absolute before:-inset-px before:z-10 before:size-56 before:rounded-tl-2xl before:border-l before:border-t" />
                <div className="bg-background relative z-0 overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/50">
                  <Image
                    src="https://plus.unsplash.com/premium_photo-1683140538884-07fb31428ca6?q=80&w=870&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                    alt="Fundraiser Platform Dashboard"
                    width={1200}
                    height={675}
                    className="w-full h-auto object-cover"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-background pb-16 pt-6 md:pb-32">
          <div className="mx-auto max-w-7xl">
            <div className="px-6 text-center sm:mx-auto lg:mr-auto lg:mt-0">
              <Badge className="rounded-full text-1xl">
                No fee required to start a fundraiser
              </Badge>
              <h1 className="mx-auto mt-8 max-w-4xl text-balance text-5xl font-medium tracking-tight md:text-6xl lg:mt-12 xl:text-7xl">
                Start raising funds for what matters in minutes
              </h1>
              <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-balance md:text-lg">
                Launch your campaign with zero technical setup. Share your
                story, accept instant donations, and mobilize your supporters
                today.
              </p>
            </div>
          </div>
        </section>

        <section className="py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="text-muted-foreground max-w-4xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
              <span className="text-foreground">
                Every fundraiser, one view.
              </span>{" "}
              <br /> Funds and owners in one place.
            </h2>
            <div className="*:bg-background mt-8 grid gap-3 md:mt-16 md:grid-cols-2 lg:grid-cols-3">
              <Card className="p-8">
                <p className="text-muted-foreground max-w-xs text-lg font-medium">
                  <span className="text-foreground">One pipeline view.</span>{" "}
                  See every funsraiser stage, owner, and next step without
                  switching tabs.
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
                  <span className="text-foreground">
                    Fundraisers in context.
                  </span>{" "}
                  Comments, funds, and owners stay linked to the account — not
                  scattered across tools.
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
              {CampaignFeatures.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <p key={index} className="text-muted-foreground text-balance">
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
              <div className="flex flex-col gap-32 md:mx-auto xl:gap-44">
                <p className="text-muted-foreground text-balance text-lg">
                  Community leaders and changemakers raise funds faster when
                  every donor, story update, and milestone is connected in one
                  place. GoUplift gives organizers the tools to build trust,
                  mobilize supporters, and turn generosity into real
                  impact.{" "}
                </p>

                <div className="grid gap-12 md:grid-cols-3 md:gap-12">
                  <div className="space-y-3 border-t pt-6">
                    <div className="text-4xl font-semibold tracking-tight">
                      98%
                    </div>
                    <p className="text-muted-foreground">Goal success rate</p>
                  </div>
                  <div className="space-y-3 border-t pt-6">
                    <div className="text-4xl font-semibold tracking-tight">
                      85k
                    </div>
                    <p className="text-muted-foreground">Backers worldwide</p>
                  </div>
                  <div className="space-y-3 border-t pt-6">
                    <div className="text-4xl font-semibold tracking-tight">
                      +500
                    </div>
                    <p className="text-muted-foreground">
                      Verified non-profits
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="text-muted-foreground max-w-4xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
              <span className="text-foreground">Fundraisers, aligned.</span>{" "}
              <br />
              One fundraiser multiple organisers.
            </h2>
            <div className="*:bg-background mt-8 grid gap-3 md:mt-16 md:grid-cols-2 lg:grid-cols-3">
              <Card className="p-8">
                <p className="text-muted-foreground max-w-xs text-lg font-medium">
                  <span className="text-foreground">
                    Fundraiser ownership, clarified.
                  </span>{" "}
                  Know who owns each fundraiser.
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
                  <span className="text-foreground">
                    Support without friction.
                  </span>{" "}
                  Options to support once or monthly.
                </p>

                <div className="mask-x-from-65% relative mt-6 pt-2">
                  <div
                    aria-hidden
                    className="bg-linear-to-b from-card to background ring-foreground/6.5 relative h-72 rounded-xl shadow-xl ring"
                  ></div>
                </div>
              </Card>
              <Card className="p-8">
                <p className="text-muted-foreground max-w-xs text-lg font-medium">
                  <span className="text-foreground">
                    Organizers are aligned.
                  </span>{" "}
                  Communcate and support fundraiser organizers, from first touch
                  to the end.
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
              {OrganizerFeatures.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <p key={index} className="text-muted-foreground text-balance">
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
        <section className="bg-background @container py-24">
          <div className="mx-auto max-w-2xl px-6">
            <div>
              <h2 className="text-center text-4xl font-medium">
                Find a course to supoort
              </h2>
              <p className="text-muted-foreground mt-4 text-balance">
                Everything you need to build, connect, and scale your
                fundraisers effortlessly.
              </p>
            </div>
            <div className="@xl:grid-cols-2 mt-12 grid gap-3 *:p-6">
              <Card className="row-span-2 grid grid-rows-subgrid">
                <div className="space-y-2">
                  <h3 className="text-foreground font-medium">Fundraiser 1</h3>
                  <p className="text-muted-foreground text-sm">Fundraiser.</p>
                </div>
                <div
                  aria-hidden
                  className="**:fill-foreground flex h-44 flex-col justify-between pt-8"
                >
                  <div className="relative flex h-10 items-center gap-12 px-6">
                    <div className="bg-border absolute inset-0 my-auto h-px" />

                    <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring"></div>
                    <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring"></div>
                  </div>
                  <div className="pl-17 relative flex h-10 items-center justify-between gap-12 pr-6">
                    <div className="bg-border absolute inset-0 my-auto h-px" />

                    <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring"></div>
                    <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring"></div>
                  </div>
                  <div className="relative flex h-10 items-center gap-20 px-8">
                    <div className="bg-border absolute inset-0 my-auto h-px" />

                    <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring"></div>
                    <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring"></div>
                  </div>
                </div>
              </Card>
              <Card className="row-span-2 grid grid-rows-subgrid overflow-hidden">
                <div className="space-y-2">
                  <h3 className="text-foreground font-medium">Fundraiser 2</h3>
                  <p className="text-muted-foreground text-sm">Fundraiser</p>
                </div>
                <div aria-hidden className="relative h-44 translate-y-6">
                  <div className="bg-foreground/15 absolute inset-0 mx-auto w-px" />
                  <div className="absolute -inset-x-16 top-6 aspect-square rounded-full border" />
                  <div className="border-primary mask-l-from-50% mask-l-to-90% mask-r-from-50% mask-r-to-50% absolute -inset-x-16 top-6 aspect-square rounded-full border" />
                  <div className="absolute -inset-x-8 top-24 aspect-square rounded-full border" />
                  <div className="mask-r-from-50% mask-r-to-90% mask-l-from-50% mask-l-to-50% absolute -inset-x-8 top-24 aspect-square rounded-full border border-lime-500" />
                </div>
              </Card>
              <Card className="row-span-2 grid grid-rows-subgrid overflow-hidden">
                <div className="space-y-2">
                  <h3 className="text-foreground font-medium">Fundraier 3</h3>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Fundraiser
                  </p>
                </div>
                <div
                  aria-hidden
                  className="*:bg-foreground/15 flex h-44 justify-between pb-6 pt-12 *:h-full *:w-px"
                >
                  <div />
                  <div />
                  <div />
                  <div />
                  <div className="bg-primary!" />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div className="bg-primary!" />
                  <div />
                  <div />
                  <div />
                  <div className="bg-primary!" />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div className="bg-primary!" />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div className="bg-primary!" />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div />
                  <div className="bg-primary!" />
                </div>
              </Card>
              <Card className="row-span-2 grid grid-rows-subgrid">
                <div className="space-y-2">
                  <h3 className="font-medium">Fundraier 4</h3>
                  <p className="text-muted-foreground text-sm">Fundraiser</p>
                </div>

                <div className="pointer-events-none relative -ml-7 flex size-44 items-center justify-center pt-5"></div>
              </Card>
            </div>
          </div>
        </section>
        <section className="py-16 md:py-20">
          <div className="mx-auto max-w-7xl space-y-8 px-6 md:space-y-16">
            <div className="grid gap-4 md:grid-cols-2 md:gap-6 lg:gap-12">
              <h2 className="text-balance text-4xl font-medium tracking-tight lg:text-5xl">
                Find a course to support{" "}
              </h2>
            </div>

            <div className="grid gap-3 lg:grid-cols-5">
              <div className="after:border-foreground/10 relative overflow-hidden rounded-xl bg-stone-100 p-8 after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:border lg:col-span-3 lg:row-span-2">
                <video
                  autoPlay
                  loop
                  muted
                  className="mask-l-from-foreground absolute inset-0 ml-auto h-full w-2/3 object-cover"
                  src="https://www.pexels.com/download/video/18744488/"
                />

                <div className="min-h-100 relative flex flex-col justify-between">
                  <p className="max-w-lg text-3xl text-black">
                    Even the most little matters
                  </p>

                  <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
                    <Logo size={40} className="w-10 h-10 my-auto" />
                    <div className="border-l border-black/10 pl-4">
                      <p className="text-sm font-medium text-black">GoupLift</p>
                      <span className="block text-sm text-black/65">
                        A crowdfunding platform
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="inset-ring inset-ring-foreground/10 min-h-100 relative grid gap-8 overflow-hidden rounded-xl bg-emerald-600 p-8 lg:col-span-2 lg:row-span-2 lg:grid-rows-subgrid">
                <Image
                  src="https://images.unsplash.com/photo-1579208570378-8c970854bc23?q=80&w=922&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                  alt="Support"
                  width={1200}
                  height={675}
                  className="w-full h-auto rounded-lg"
                  priority
                />
                <div className="bg-linear-to-b pointer-events-none absolute inset-0 to-black/25" />
                <p className="max-w-lg text-balance text-3xl">
                  Your supoort will always help others
                </p>

                <div className="relative grid grid-cols-[auto_1fr] items-center gap-4 self-end" />
              </div>
            </div>
          </div>
        </section>
        <section className="bg-background @container py-24">
          <div className="mx-auto max-w-2xl px-6">
            <div className="space-y-4">
              <h2 className="text-balance text-4xl font-medium">
                What Our Customers Say
              </h2>
              <p className="text-muted-foreground text-balance">
                Hear from the teams and individuals who have transformed their
                lives with our platform.
              </p>
            </div>
            <div className="@xl:grid-cols-2 mt-12 grid gap-3">
              {testimonials.map((testimonial, index) => (
                <Card
                  key={index}
                  className="text-foreground flex items-end gap-3 rounded-2xl p-4 text-sm"
                >
                  <div className="before:border-foreground/10 relative size-5 shrink-0 rounded-full before:absolute before:inset-0 before:rounded-full before:border">
                    <Image
                      src={testimonial.avatar}
                      alt={testimonial.name}
                      className="rounded-full object-cover"
                      width={40}
                      height={40}
                    />
                  </div>
                  <div className="space-y-6">
                    <p className="text-foreground text-lg">
                      {testimonial.quote}
                    </p>

                    <div className="space-y-1">
                      <p className="text-muted-foreground text-sm font-medium">
                        {testimonial.name}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>
        <section className="py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-4xl text-center">
              <h2 className="text-balance text-4xl font-semibold tracking-tight lg:text-5xl xl:text-6xl">
                Start a course you support now!
              </h2>

              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link
                  href="#"
                  className={cn(
                    buttonVariants({ variant: "default" }),
                    "text-nowrap",
                  )}
                >
                  Start a Fundraiser
                </Link>

                <Link
                  href="#"
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "text-nowrap",
                  )}
                >
                  Sign up
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
