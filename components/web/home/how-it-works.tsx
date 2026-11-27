import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { HomeSection, SectionHeading } from "@/components/web/home/section";
import { cn } from "@/lib/utils";

// The same sequence as /how-it-works, shortened to four steps.
const STEPS = [
  {
    title: "Tell your story",
    detail:
      "Add a photo, set a goal in Kenyan shillings and say why you are raising money.",
  },
  {
    title: "Share the link",
    detail:
      "Send your fundraiser page on WhatsApp or anywhere else. Supporters don't need an account.",
  },
  {
    title: "Supporters give",
    detail:
      "They pay by M-Pesa, Airtel Money or card, or by PayPal. The total updates as gifts arrive.",
  },
  {
    title: "Get paid",
    detail:
      "Get verified and add a payout account. We review each withdrawal, then send the money.",
  },
];

export function HowItWorks({ feePercent }: { feePercent: number }) {
  return (
    <HomeSection labelledBy="how-title">
      <SectionHeading
        id="how-title"
        title="Raise money in four steps"
        lead="Your fundraiser goes live as soon as you publish it, so you can start collecting while you wait to be verified."
      />

      <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {STEPS.map((step, index) => (
          <li key={step.title} className="relative">
            <span
              aria-hidden
              className="flex size-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-secondary"
            >
              {index + 1}
            </span>
            {index < STEPS.length - 1 && (
              <span
                aria-hidden
                className="absolute -right-4 left-16 top-6 hidden h-px bg-primary/15 lg:block"
              />
            )}
            <h3 className="mt-5 text-xl font-semibold tracking-tight">
              {step.title}
            </h3>
            <p className="mt-2 text-pretty text-primary/70">{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="mt-14 flex flex-col gap-5 rounded-3xl bg-mint p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-2xl text-lg font-medium">
          It&apos;s free to start. GoUplift charges a {feePercent}% platform fee
          on each donation, and nothing else.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/pricing"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-11 rounded-full border-primary/25 bg-white px-6 text-primary hover:bg-white/70 hover:text-primary",
            )}
          >
            See pricing
          </Link>
          <Link
            href="/how-it-works"
            className={cn(
              buttonVariants({ variant: "default" }),
              "h-11 rounded-full px-6",
            )}
          >
            Read the full guide
          </Link>
        </div>
      </div>
    </HomeSection>
  );
}
