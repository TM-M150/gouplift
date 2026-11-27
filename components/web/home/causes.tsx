import {
  GraduationCap,
  HandHeart,
  HeartPulse,
  LifeBuoy,
  Palette,
  PawPrint,
  Siren,
  Sprout,
  Store,
  Trophy,
  Users,
  Flower2,
  type LucideIcon,
} from "lucide-react";

import { FUNDRAISER_TYPE_CHOICES } from "@/components/web/fundraiser/form-questions";
import { HomeSection, SectionHeading } from "@/components/web/home/section";

// One icon for each category on the fundraiser form. The words come from the
// form itself, so this list can't drift from what people can actually choose.
const ICONS: Record<string, LucideIcon> = {
  MEDICAL: HeartPulse,
  EDUCATION: GraduationCap,
  EMERGENCY: Siren,
  MEMORIAL_FUNERAL: Flower2,
  COMMUNITY_HARAMBEE: Users,
  BUSINESS_STARTUP: Store,
  SPORTS: Trophy,
  CREATIVE_ARTS: Palette,
  ANIMAL_WELFARE: PawPrint,
  ENVIRONMENT: Sprout,
  DISASTER_RELIEF: LifeBuoy,
  NONPROFIT: HandHeart,
};

const CAUSES = FUNDRAISER_TYPE_CHOICES.filter((choice) => ICONS[choice.value]);

export function Causes() {
  return (
    <HomeSection tone="mint" labelledBy="causes-title">
      <SectionHeading
        id="causes-title"
        title="What you can raise money for"
        lead="Pick the category that fits when you start. You can raise money for yourself, for someone else or for an organization."
      />

      <ul className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {CAUSES.map((cause) => {
          const Icon = ICONS[cause.value];
          return (
            <li
              key={cause.value}
              className="flex flex-col items-start gap-3 rounded-2xl bg-white p-4 sm:flex-row sm:gap-4 sm:p-5"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-secondary sm:size-11"
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{cause.label}</p>
                <p className="mt-1 hidden text-sm text-primary/70 sm:block">
                  {cause.description}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </HomeSection>
  );
}
