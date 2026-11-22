"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { ShieldAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buttonVariants } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/lib/site";

/** Who is looking: anyone, the organizer (told why), or staff. */
export type UnderReviewViewer = "public" | "organizer" | "staff";

interface UnderReviewNoticeViewProps {
  viewer: UnderReviewViewer;
  fundraiserId: string;
  /** What staff wrote for the organizer. Only ever given to them and to staff. */
  reason: string | null;
  supportEmail: string | null;
}

/**
 * What the page says in place of a suspended fundraiser. It leaves out the
 * story, the photo and the title on purpose: a fundraiser is usually suspended
 * for something it says (an off-platform phone number, say), and that
 * shouldn't stay readable from here. It only draws what it is given, so it can
 * be previewed without a backend.
 */
export function UnderReviewNoticeView({
  viewer,
  fundraiserId,
  reason,
  supportEmail,
}: UnderReviewNoticeViewProps) {
  return (
    <div className="mx-auto max-w-xl space-y-6 rounded-xl border p-6 sm:p-8">
      <div className="space-y-3">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">
          This fundraiser is under review
        </h1>
        {viewer === "public" && (
          <p className="text-muted-foreground">
            Donations are paused while GoUplift looks into it. Please check back
            later.
          </p>
        )}
        {viewer === "organizer" && (
          <p className="text-muted-foreground">
            It is hidden from the public for now. It isn&apos;t taking
            donations, and donors aren&apos;t being emailed about it, until
            we&apos;re done.
          </p>
        )}
        {viewer === "staff" && (
          <p className="text-muted-foreground">
            It is suspended. The public sees only this notice. You can see why
            on the review page.
          </p>
        )}
      </div>

      {viewer !== "public" && reason && (
        <div className="space-y-1 rounded-lg bg-muted/50 p-4 text-sm">
          <p className="font-medium">
            {viewer === "organizer"
              ? "What we told you"
              : "Shown to the organizer"}
          </p>
          <p className="break-words whitespace-pre-line text-muted-foreground">
            {reason}
          </p>
        </div>
      )}

      {viewer === "organizer" && (
        <p className="text-sm text-muted-foreground">
          If you think this is a mistake, or you have fixed what we asked,{" "}
          {supportEmail ? (
            <>
              email{" "}
              <a
                href={`mailto:${supportEmail}`}
                className="underline underline-offset-4"
              >
                {supportEmail}
              </a>
              .
            </>
          ) : (
            <>
              get in touch from the{" "}
              <Link href="/help" className="underline underline-offset-4">
                Help page
              </Link>
              .
            </>
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {viewer === "staff" && (
          <Link
            href={`/admin/fundraisers/${fundraiserId}`}
            className={buttonVariants()}
          >
            Review in admin
          </Link>
        )}
        {viewer === "organizer" && (
          <Link
            href={`/fundraiser/${fundraiserId}/edit`}
            className={buttonVariants()}
          >
            Edit fundraiser
          </Link>
        )}
        <Link
          href="/fundraisers"
          className={buttonVariants({
            variant: viewer === "public" ? "default" : "outline",
          })}
        >
          Browse fundraisers
        </Link>
        {viewer === "public" && (
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            Home
          </Link>
        )}
      </div>
    </div>
  );
}

/** The notice on the fundraiser page, wired to the backend. */
export function UnderReviewNotice({
  fundraiserId,
}: {
  fundraiserId: Id<"fundraisers">;
}) {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
  // Null for everyone but the organizer and staff.
  const suspension = useQuery(
    api.fundraiserReports.mySuspension,
    isAuthenticated ? { fundraiserId } : "skip",
  );

  const isStaff = me?.role === "ADMIN" || me?.role === "MODERATOR";
  const viewer: UnderReviewViewer = isStaff
    ? "staff"
    : suspension
      ? "organizer"
      : "public";

  return (
    <UnderReviewNoticeView
      viewer={viewer}
      fundraiserId={fundraiserId}
      reason={suspension?.reason ?? null}
      supportEmail={SUPPORT_EMAIL}
    />
  );
}
