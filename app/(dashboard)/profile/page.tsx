import { Suspense } from "react";
import { ProfileCard } from "@/components/web/profile/profile-card";
import { ProfileTabs } from "@/components/web/profile/profile-tabs";

/**
 * The same colours as the homepage: a deep green band for who you are, then a
 * light green page with white cards for what you do.
 */
export default function ProfilePage() {
  return (
    <main className="min-h-screen w-full bg-mint">
      <div className="bg-primary px-4 pb-10 pt-28 text-primary-foreground sm:px-6 sm:pb-12 sm:pt-32">
        <ProfileCard />
      </div>

      <div className="px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-4xl">
          {/* ProfileTabs reads the address (?tab=settings), which needs this. */}
          <Suspense fallback={null}>
            <ProfileTabs />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
