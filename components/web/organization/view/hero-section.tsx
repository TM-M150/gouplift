import { HeroVideo } from "@/components/web/organization/view/hero-content";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function HeroSection() {
  return (
    <>
      <main className="overflow-x-hidden">
        <section>
          <div className="lg:min-h-200 sm:aspect-3/2 min-[1996px]:max-h-240 relative mx-auto flex aspect-square flex-col justify-end lg:aspect-auto xl:aspect-video">
            <div className="relative z-10 flex flex-col justify-end">
              <div className="mx-auto w-full max-w-7xl px-6 pb-6 lg:pb-12">
                <div className="flex flex-wrap items-end justify-between gap-4 lg:w-2/3">
                  <Avatar className="-mt-14 size-40 border-4 border-background shadow-sm">
                    <AvatarImage
                      src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80"
                      alt="Alex Morgan"
                    />
                    <AvatarFallback className="text-2xl font-medium">
                      AM
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-0">
              <HeroVideo />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
