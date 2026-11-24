"use client";

import { SystemAlerts } from "@/components/web/admin/system-alerts";

export default function AdminAlertsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">System alerts</h1>
        <p className="text-sm text-muted-foreground">
          Payment notifications from SasaPay and PayPal that were turned away or
          couldn&apos;t be recorded, and background jobs that failed, with what
          to do about each. A donor may have paid when a payment alert is open.
          This page can&apos;t tell you about a notification that never arrived,
          so if donors say they paid and donations stay pending, check the
          SasaPay and PayPal dashboards too. A job alert closes by itself once
          the job next runs.
        </p>
      </div>

      <SystemAlerts />
    </div>
  );
}
