import { ProfileCard } from "@/components/web/profile/profile-card";
import { ProfileTabs } from "@/components/web/profile/profile-tabs";

export default function ProfilePage() {
  return (
    <main className="min-h-screen w-full pt-24 flex flex-col items-center px-4">
      <ProfileCard />
      <ProfileTabs />
    </main>
  );
}