// components/web/profile/profile-tabs.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdditionalInfoTab } from "./additional-info-tab";
import { FundraisersTab } from "./fundraisers-tab";
import { ImpactTab } from "./impact-tab";
import { SettingsTab } from "./settings-tab";
import { profileTabFromParam } from "@/lib/profile-tabs";

// The tab you are on is the logo's deep green with the bright green on top
// (7.2:1); the others are deep green at 70% on white (5.8:1).
const TAB =
  "h-10 rounded-full px-1.5 text-[13px] font-semibold text-primary/70 hover:text-primary data-active:bg-primary data-active:text-secondary data-active:hover:text-secondary focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-3 sm:text-base";

export function ProfileTabs() {
  // The address can ask for a tab, e.g. coming back from Google on Settings.
  const tab = profileTabFromParam(useSearchParams().get("tab"));

  return (
    <section className="w-full">
      <Tabs defaultValue={tab} className="w-full gap-6">
        <TabsList className="w-full rounded-full bg-background p-1 shadow-sm ring-1 ring-primary/10 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="additional" className={TAB}>
            Additional
          </TabsTrigger>
          <TabsTrigger value="fundraisers" className={TAB}>
            Fundraisers
          </TabsTrigger>
          <TabsTrigger value="impact" className={TAB}>
            Impact
          </TabsTrigger>
          <TabsTrigger value="settings" className={TAB}>
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="additional">
          <AdditionalInfoTab />
        </TabsContent>
        <TabsContent value="fundraisers">
          <FundraisersTab />
        </TabsContent>
        <TabsContent value="impact">
          <ImpactTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </section>
  );
}
