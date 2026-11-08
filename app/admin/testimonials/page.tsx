"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TESTIMONIAL_TABS,
  TestimonialQueue,
} from "@/components/web/admin/testimonial-review";

export default function AdminTestimonialsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Testimonials</h1>
        <p className="text-sm text-muted-foreground">
          Messages from verified donors who chose to share them. Check each one
          for personal details, claims about a fundraiser, or anything
          unsuitable, then approve it for the homepage.
        </p>
      </div>

      <Tabs defaultValue="PENDING">
        <TabsList>
          {TESTIMONIAL_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TESTIMONIAL_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <TestimonialQueue status={tab.value} empty={tab.empty} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
