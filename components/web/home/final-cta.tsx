import { CtaButtons } from "@/components/web/home/cta-buttons";
import { HomeSection } from "@/components/web/home/section";

export function FinalCta() {
  return (
    <HomeSection tone="forest" labelledBy="start-title">
      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-16">
        <h2
          id="start-title"
          className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
        >
          Start a fundraiser for a cause you care about.
        </h2>
        <div>
          <p className="max-w-md text-pretty text-lg text-white/75">
            It&apos;s free to start, and your page can be live in minutes.
          </p>
          <CtaButtons className="mt-7" />
        </div>
      </div>
    </HomeSection>
  );
}
