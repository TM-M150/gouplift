import Link from "next/link";
import { BadgeCheck, Code, Globe, UsersRound } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { HomeSection, SectionHeading } from "@/components/web/home/section";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: UsersRound,
    title: "Team access",
    detail: "Invite teammates so they can run fundraisers with you.",
  },
  {
    icon: Globe,
    title: "One public page",
    detail: "All of your organization's fundraisers together on a single page.",
  },
  {
    icon: BadgeCheck,
    title: "Verified badge",
    detail: "Organizations that pass our review are marked as verified.",
  },
  {
    icon: Code,
    title: "On your own website",
    detail:
      "Show your current fundraisers on your site with a short snippet, once your organization is verified.",
  },
];

export function OrganizationsSection() {
  return (
    <HomeSection labelledBy="orgs-title">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <SectionHeading
            id="orgs-title"
            title="Raise money as a team"
            lead="Registered companies, NGOs, societies, trusts and self-help groups can create an organization, invite their team and run fundraisers under one name."
          />
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/organizations/new"
              className={cn(
                buttonVariants({ variant: "default" }),
                "h-12 rounded-full px-7 text-base font-semibold",
              )}
            >
              Create an organization
            </Link>
            <Link
              href="/trust#organizations"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-12 rounded-full border-primary/25 px-7 text-base text-primary hover:bg-mint hover:text-primary",
              )}
            >
              How organizations are verified
            </Link>
          </div>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-3xl bg-mint p-6">
              <div className="flex items-center gap-4 sm:block">
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-secondary"
                >
                  <feature.icon className="size-5" />
                </span>
                <h3 className="text-lg font-semibold leading-snug sm:mt-5">
                  {feature.title}
                </h3>
              </div>
              <p className="mt-3 text-pretty text-primary/70 sm:mt-2">
                {feature.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </HomeSection>
  );
}
