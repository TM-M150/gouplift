"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/components/web/admin/utils";
import { cn } from "@/lib/utils";

type Scope = "FUNDRAISER" | "ALL";

export interface UnsubscribeViewProps {
  /** What the link points at: null for a link that isn't valid. */
  link: {
    fundraiserTitle: string;
    stoppedForFundraiser: boolean;
    stoppedForAll: boolean;
  } | null;
  working: boolean;
  error: string | null;
  onUnsubscribe: (scope: Scope) => void;
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-background p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      {children}
    </div>
  );
}

/**
 * The words and buttons, apart from Convex. The copy is built as strings so an
 * apostrophe next to a fundraiser's title can't trip the JSX text handling.
 */
export function UnsubscribeView({
  link,
  working,
  error,
  onUnsubscribe,
}: UnsubscribeViewProps) {
  if (link === null) {
    return (
      <Panel title="This link isn't valid">
        <p className="text-muted-foreground">
          It may have been copied incompletely. You can use the unsubscribe link
          in any update email we sent you.
        </p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to the homepage
        </Link>
      </Panel>
    );
  }

  const receiptNote =
    "Receipts for your donations are not affected: you will still get those.";

  if (link.stoppedForAll) {
    return (
      <Panel title="You're unsubscribed">
        <p className="text-muted-foreground">
          {`You won't get update emails from any fundraiser. ${receiptNote}`}
        </p>
      </Panel>
    );
  }

  const title = link.stoppedForFundraiser
    ? "You're unsubscribed from this fundraiser"
    : "Stop emails about this fundraiser?";
  const intro = link.stoppedForFundraiser
    ? `You won't get an email when the organizer of "${link.fundraiserTitle}" posts an update. ${receiptNote}`
    : `You'll no longer get an email when the organizer of "${link.fundraiserTitle}" posts an update. ${receiptNote}`;

  return (
    <Panel title={title}>
      <p className="text-muted-foreground">{intro}</p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!link.stoppedForFundraiser && (
          <Button
            disabled={working}
            onClick={() => onUnsubscribe("FUNDRAISER")}
          >
            {working ? "Working…" : "Unsubscribe"}
          </Button>
        )}
        <Button
          variant={link.stoppedForFundraiser ? "default" : "ghost"}
          disabled={working}
          onClick={() => onUnsubscribe("ALL")}
        >
          Stop update emails from every fundraiser
        </Button>
      </div>
    </Panel>
  );
}

/** The unsubscribe page's content, wired to Convex. */
export function UnsubscribeCard({ token }: { token: string }) {
  const link = useQuery(api.unsubscribe.lookup, { token });
  const confirm = useMutation(api.unsubscribe.confirm);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (link === undefined) {
    return (
      <div className="space-y-4 rounded-xl border bg-background p-6">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  async function handleUnsubscribe(scope: Scope) {
    setError(null);
    setWorking(true);
    try {
      // The page updates by itself: the query above now says it is done.
      await confirm({ token, scope });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <UnsubscribeView
      link={link}
      working={working}
      error={error}
      onUnsubscribe={handleUnsubscribe}
    />
  );
}
