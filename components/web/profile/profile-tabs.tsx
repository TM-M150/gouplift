// components/web/profile/profile-tabs.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdditionalInfoTab } from "./additional-info-tab";
import { FundraisersTab } from "./fundraisers-tab";
import { ImpactTab } from "./impact-tab";
import { SettingsTab } from "./settings-tab";
import { profileTabFromParam } from "@/lib/profile-tabs";

export function ProfileTabs() {
  // The address can ask for a tab, e.g. coming back from Google on Settings.
  const tab = profileTabFromParam(useSearchParams().get("tab"));

  return (
    <section className="w-full max-w-4xl pt-6">
      <Tabs defaultValue={tab} className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="additional">Additional</TabsTrigger>
          <TabsTrigger value="fundraisers">Fundraisers</TabsTrigger>
          <TabsTrigger value="impact">Impact</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
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
