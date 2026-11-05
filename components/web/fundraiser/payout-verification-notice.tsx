"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ShieldAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buttonVariants } from "@/components/ui/button";

interface PayoutVerificationNoticeProps {
  creatorId: Id<"users">;
  organizationId?: Id<"organizations">;
}

// Shown to the owner of a personal fundraiser who hasn't been verified yet.
// An organization's fundraiser is paid out through the organization, which is
// verified separately, so it never shows this.
export function PayoutVerificationNotice({
  creatorId,
  organizationId,
}: PayoutVerificationNoticeProps) {
  const currentUser = useQuery(api.users.getCurrentUser);
  const kyc = useQuery(
    api.kyc.getMyKyc,
    currentUser && currentUser._id === creatorId && !organizationId
      ? {}
      : "skip",
  );

  if (!kyc || kyc.tier > 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium">
            {kyc.pending
              ? "Your verification is being reviewed"
              : "Verify your identity to receive payouts"}
          </p>
          <p className="text-muted-foreground">
            Only you can see this. Donations can come in, but nothing is paid
            out until you&apos;re verified.
          </p>
        </div>
      </div>
      <Link
        href="/verification"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        {kyc.pending ? "View status" : "Verify now"}
      </Link>
    </div>
  );
}
