import { HeroMedia } from "@/components/web/organization/view/hero-media";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface HeroSectionProps {
  organization: {
    name: string;
    logoUrl?: string;
    heroVideoUrl?: string;
    heroImageUrl?: string;
  };
}

export function HeroSection({ organization }: HeroSectionProps) {
  // Extract dynamic fields with fallbacks
  const { name, logoUrl, heroVideoUrl, heroImageUrl } = organization;

  // Generate fallback initials for Avatar
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "ORG";

  return (
    <main className="overflow-x-hidden">
      <section>
        <div className="lg:min-h-200 sm:aspect-3/2 min-[1996px]:max-h-240 relative mx-auto flex aspect-square flex-col justify-end lg:aspect-auto xl:aspect-video">
          <div className="relative z-10 flex flex-col justify-end">
            <div className="mx-auto w-full max-w-7xl px-6 pb-6 lg:pb-12">
              <div className="flex flex-wrap items-end justify-between gap-4 lg:w-2/3">
                <Avatar className="-mt-14 size-40 border-4 border-background shadow-sm">
                  <AvatarImage src={logoUrl} alt={name} />
                  <AvatarFallback className="text-2xl font-medium">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0">
            <HeroMedia videoUrl={heroVideoUrl} imageUrl={heroImageUrl} />
          </div>
        </div>
      </section>
    </main>
  );
}
