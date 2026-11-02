"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminShell } from "@/components/web/admin/admin-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const me = useQuery(api.users.getCurrentUser); // undefined = loading, null = signed out
  const allowed = me?.role === "ADMIN" || me?.role === "MODERATOR";

  React.useEffect(() => {
    if (me !== undefined && !allowed) router.replace("/");
  }, [me, allowed, router]);

  if (!allowed) {
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
