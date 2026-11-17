import { Suspense } from "react";
import { ProfileCard } from "@/components/web/profile/profile-card";
import { ProfileTabs } from "@/components/web/profile/profile-tabs";

export default function ProfilePage() {
  return (
    <main className="min-h-screen w-full pt-24 flex flex-col items-center px-4">
      <ProfileCard />
      {/* ProfileTabs reads the address (?tab=settings), which needs this. */}
      <Suspense fallback={null}>
        <ProfileTabs />
      </Suspense>
    </main>
  );
}