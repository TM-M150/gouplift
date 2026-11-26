"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminShell } from "@/components/web/admin/admin-shell";
import { StaffBlockedNotice } from "@/components/web/admin/staff-blocked-notice";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  // undefined = loading. A staff role isn't enough on its own: the account's
  // email must be confirmed (and a company address once that rule is on), so
  // the server says whether this person is allowed in, held back, or not staff.
  const access = useQuery(api.admin.getStaffAccess);
  const leave = access?.state === "NOT_STAFF";

  React.useEffect(() => {
    if (leave) router.replace("/");
  }, [leave, router]);

  if (access?.state === "BLOCKED") {
    return (
      <StaffBlockedNotice
        message={access.message}
        canConfirmEmail={access.block === "EMAIL_NOT_CONFIRMED"}
      />
    );
  }

  if (access?.state !== "ALLOWED") {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminShell>{children}</AdminShell>
    </div>
  );
}
