import Image from "next/image";
import Link from "next/link";

import Logo from "@/components/icons/logo";
import type { FundraiserCardData } from "@/components/web/fundraiser/fundraiser-card";
import { AMOUNT_PRESETS_KES } from "@/lib/donation-amounts";
import { cn } from "@/lib/utils";

const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const CARD =
  "overflow-hidden rounded-3xl bg-white text-primary shadow-2xl shadow-black/30";

// What the donation form offers, in KES through SasaPay.
const PAY_WITH = ["M-Pesa", "Airtel Money", "SasaPay", "Card"];
const SELECTED_PRESET = AMOUNT_PRESETS_KES[1];

/** One real, live fundraiser: what a GoUplift page is actually like. */
function Spotlight({ fundraiser }: { fundraiser: FundraiserCardData }) {
  const progress =
    fundraiser.goalAmount > 0
      ? Math.min(
          100,
          Math.round((fundraiser.amountRaised / fundraiser.goalAmount) * 100),
        )
      : 0;

  return (
    <article aria-label="Featured fundraiser" className={CARD}>
      <div className="relative aspect-16/10 bg-mint">
        {fundraiser.coverImageUrl ? (
          <Image
            src={fundraiser.coverImageUrl}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 560px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Logo size={88} />
          </div>
        )}
      </div>

      <div className="space-y-5 p-6 sm:p-8">
        <div className="space-y-1.5">
          <p className="text-sm text-primary/70">
            Featured fundraiser
            {fundraiser.location ? `, ${fundraiser.location}` : ""}
          </p>
          <p className="text-balance text-2xl font-semibold leading-tight">
            {fundraiser.title}
          </p>
        </div>

        <div className="space-y-3">
          <p>
            <span className="text-4xl font-semibold tabular-nums tracking-tight">
              {kes.format(fundraiser.amountRaised)}
            </span>{" "}
            <span className="text-sm text-primary/70">
              raised of {kes.format(fundraiser.goalAmount)}
            </span>
          </p>
          <div
            role="progressbar"
            aria-label="Progress toward the goal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-3 w-full overflow-hidden rounded-full bg-mint ring-1 ring-primary/10"
          >
            <div
              className="h-full origin-left rounded-full bg-primary motion-safe:animate-grow-x"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="flex justify-between text-sm text-primary/70">
            <span>{progress}% of the goal</span>
            <span>
              {fundraiser.donorCount}{" "}
              {fundraiser.donorCount === 1 ? "donation" : "donations"}
            </span>
          </p>
        </div>

        <Link
          href={`/fundraiser/${fundraiser._id}`}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          View fundraiser
        </Link>
      </div>
    </article>
  );
}

/**
 * Shown while there is no real fundraiser to feature: the donation form,
 * drawn small. The amounts are the form's own suggestions and the payment
 * methods are the ones it accepts. No fundraiser, person or total is invented.
 */
function GivingPreview() {
  return (
    <div aria-hidden className={cn(CARD, "select-none p-6 sm:p-8")}>
      <div className="flex items-center gap-3">
        <Logo size={36} />
        <p className="font-semibold">How giving works</p>
      </div>

      <p className="mt-7 text-sm text-primary/70">Choose an amount</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {AMOUNT_PRESETS_KES.map((amount) => (
          <div
            key={amount}
            className={cn(
              "rounded-2xl border px-4 py-3 text-lg font-semibold tabular-nums",
              amount === SELECTED_PRESET
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/15",
            )}
          >
            KES {amount.toLocaleString("en-KE")}
          </div>
        ))}
      </div>

      <p className="mt-7 text-sm text-primary/70">Pay the way you already do</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PAY_WITH.map((method) => (
          <span
            key={method}
            className="rounded-full bg-mint px-3.5 py-1.5 text-sm font-medium"
          >
            {method}
          </span>
        ))}
      </div>

      <div className="mt-8 rounded-full bg-secondary py-3.5 text-center font-semibold">
        Donate KES {SELECTED_PRESET.toLocaleString("en-KE")}
      </div>
    </div>
  );
}

/**
 * The picture beside the hero text. A real featured fundraiser when there is
 * one, so the page shows what GoUplift is rather than a stock photo, and the
 * donation form otherwise.
 */
export function HeroStage({
  fundraiser,
}: {
  fundraiser: FundraiserCardData | undefined;
}) {
  return fundraiser ? <Spotlight fundraiser={fundraiser} /> : <GivingPreview />;
}
