import Link from "next/link";
import {
  Building2,
  Landmark,
  ReceiptText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { HomeSection, SectionHeading } from "@/components/web/home/section";

interface Point {
  icon: LucideIcon;
  title: string;
  detail: string;
}

// Every line here is something /trust and /pricing already say. If one of
// those pages changes, change the line here too.
function pointsFor(feePercent: number): Point[] {
  return [
    {
      icon: ShieldCheck,
      title: "Verified before payout",
      detail:
        "You can raise money straight away. Nothing is paid out until a person on our team has checked who you are.",
    },
    {
      icon: Building2,
      title: "Organizations are reviewed separately",
      detail:
        "We check registration documents, a KRA PIN certificate and who owns or controls the organization. Those that pass are marked as verified.",
    },
    {
      icon: Landmark,
      title: "Money goes to verified accounts",
      detail:
        "Payouts go only to an account we have verified: the fundraiser's own, or a verified beneficiary such as a hospital or a school.",
    },
    {
      icon: ReceiptText,
      title: "A clear fee and a receipt",
      detail: `Our ${feePercent}% fee comes out of the donation, not on top of it, and donors get a receipt by email.`,
    },
  ];
}

export function TrustSection({ feePercent }: { feePercent: number }) {
  return (
    <HomeSection tone="forest" labelledBy="trust-title">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div>
          <SectionHeading
            id="trust-title"
            tone="forest"
            title="Know who is receiving the money"
            lead="We check everyone who receives money through GoUplift."
          />
          <p className="mt-8 max-w-md text-pretty text-white/65">
            Verification confirms who is receiving the money. It isn&apos;t a
            guarantee of how a fundraiser turns out, so read the story before
            you give.
          </p>
          <Link
            href="/trust"
            className="mt-6 inline-block text-lg font-medium text-secondary underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            How verification works
          </Link>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {pointsFor(feePercent).map((point) => (
            <li
              key={point.title}
              className="rounded-3xl bg-white/6 p-6 ring-1 ring-white/10"
            >
              <div className="flex items-center gap-4 sm:block">
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"
                >
                  <point.icon className="size-5" />
                </span>
                <h3 className="text-lg font-semibold leading-snug sm:mt-5">
                  {point.title}
                </h3>
              </div>
              <p className="mt-3 text-pretty text-white/75 sm:mt-2">
                {point.detail}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </HomeSection>
  );
}
