import Image from "next/image";
import Link from "next/link";
import Logo from "@/components/icons/logo";
import type { FundraiserCardData } from "@/components/web/fundraiser/fundraiser-card";

const FOREST = "bg-[rgb(7,43,25)]";
const SIGNAL = "bg-[rgb(9,204,96)]";

const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const STEPS = [
  {
    title: "Tell your story",
    detail: "Set a goal in Kenyan shillings, pick a category and add a photo.",
  },
  {
    title: "Share the link",
    detail: "Send your fundraiser page to the people who might want to help.",
  },
  {
    title: "Receive donations",
    detail: "Supporters give through SasaPay or PayPal and you follow the total.",
  },
];

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
    <article
      aria-label="Featured fundraiser"
      className="grid gap-6 text-left md:grid-cols-2 md:items-center md:gap-10"
    >
      <div className="relative aspect-4/3 overflow-hidden rounded-lg bg-white/5">
        {fundraiser.coverImageUrl ? (
          <Image
            src={fundraiser.coverImageUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 560px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Logo size={96} />
          </div>
        )}
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <p className="text-sm text-white/65">
            Featured fundraiser
            {fundraiser.location ? `, ${fundraiser.location}` : ""}
          </p>
          <p className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">
            {fundraiser.title}
          </p>
        </div>

        <div className="space-y-3">
          <p>
            <span className="text-4xl font-semibold tabular-nums sm:text-5xl">
              {kes.format(fundraiser.amountRaised)}
            </span>{" "}
            <span className="text-sm text-white/65">
              raised of {kes.format(fundraiser.goalAmount)}
            </span>
          </p>
          <div
            role="progressbar"
            aria-label="Progress toward the goal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-3 w-full overflow-hidden rounded-full bg-white/15"
          >
            <div
              className={`h-full rounded-full ${SIGNAL}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="flex justify-between text-sm text-white/65">
            <span>{progress}% of the goal</span>
            <span>
              {fundraiser.donorCount}{" "}
              {fundraiser.donorCount === 1 ? "donation" : "donations"}
            </span>
          </p>
        </div>

        <Link
          href={`/fundraiser/${fundraiser._id}`}
          className="inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-medium text-[rgb(7,43,25)] transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          View fundraiser
        </Link>
      </div>
    </article>
  );
}

/** Shown while there is no real fundraiser to feature. */
function Steps() {
  return (
    <ol className="grid gap-4 text-left md:grid-cols-3">
      {STEPS.map((step, index) => (
        <li key={step.title} className="space-y-3 rounded-lg bg-white/8 p-6">
          <span
            aria-hidden
            className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold text-[rgb(7,43,25)] ${SIGNAL}`}
          >
            {index + 1}
          </span>
          <p className="text-lg font-semibold">{step.title}</p>
          <p className="text-white/70">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

/**
 * The picture under the hero text. A real featured fundraiser when there is
 * one, so the page shows what GoUplift is rather than a stock photo, and the
 * three steps to start otherwise. Nothing here is made up.
 */
export function HeroStage({
  fundraiser,
}: {
  fundraiser: FundraiserCardData | undefined;
}) {
  return (
    <div
      className={`relative z-0 overflow-hidden rounded-xl border border-white/10 p-5 text-white shadow-2xl shadow-black/50 sm:p-8 lg:p-10 ${FOREST}`}
    >
      {fundraiser ? <Spotlight fundraiser={fundraiser} /> : <Steps />}
    </div>
  );
}
