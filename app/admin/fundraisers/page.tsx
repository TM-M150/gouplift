"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FundraiserLookup,
  ReportedFundraiserQueue,
  SuspendedFundraiserList,
} from "@/components/web/admin/fundraiser-reports";

export default function AdminFundraisersPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Fundraisers</h1>
        <p className="text-sm text-muted-foreground">
          Fundraisers that donors have reported, and the ones that are
          suspended. A report only asks staff to look: open the fundraiser to
          see who is behind it, then suspend it or close the reports. A
          suspended fundraiser comes off the public site and takes no donations.
        </p>
      </div>

      <FundraiserLookup />

      <Tabs defaultValue="reported">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="reported">Reported</TabsTrigger>
            <TabsTrigger value="suspended">Suspended</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="reported">
          <ReportedFundraiserQueue />
        </TabsContent>
        <TabsContent value="suspended">
          <SuspendedFundraiserList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
