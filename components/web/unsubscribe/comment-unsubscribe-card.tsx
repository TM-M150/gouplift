"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/components/web/admin/utils";
import { cn } from "@/lib/utils";

export interface CommentUnsubscribeViewProps {
  /** What the link points at: null for a link that isn't valid. */
  link: { fundraiserTitle: string; alreadyStopped: boolean } | null;
  working: boolean;
  error: string | null;
  onUnsubscribe: () => void;
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
export function CommentUnsubscribeView({
  link,
  working,
  error,
  onUnsubscribe,
}: CommentUnsubscribeViewProps) {
  if (link === null) {
    return (
      <Panel title="This link isn't valid">
        <p className="text-muted-foreground">
          It may have been copied incompletely. You can use the unsubscribe link
          in any comment email we sent you, or turn these emails off in the
          settings on your profile.
        </p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to the homepage
        </Link>
      </Panel>
    );
  }

  const settingsNote =
    "You can turn them back on any time in the settings on your profile.";

  if (link.alreadyStopped) {
    return (
      <Panel title="You're unsubscribed">
        <p className="text-muted-foreground">
          {`You won't get emails about new comments on your fundraisers. Comments still appear on your fundraiser pages. ${settingsNote}`}
        </p>
        <Link
          href="/profile"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Go to your profile
        </Link>
      </Panel>
    );
  }

  return (
    <Panel title="Stop emails about new comments?">
      <p className="text-muted-foreground">
        {`You'll no longer get an email when donors comment on your fundraisers, including "${link.fundraiserTitle}". Comments still appear on your fundraiser pages. ${settingsNote}`}
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button disabled={working} onClick={onUnsubscribe}>
        {working ? "Working…" : "Unsubscribe"}
      </Button>
    </Panel>
  );
}

/** The unsubscribe page's content, wired to Convex. */
export function CommentUnsubscribeCard({ token }: { token: string }) {
  const link = useQuery(api.commentUnsubscribe.lookup, { token });
  const confirm = useMutation(api.commentUnsubscribe.confirm);
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

  async function handleUnsubscribe() {
    setError(null);
    setWorking(true);
    try {
      // The page updates by itself: the query above now says it is done.
      await confirm({ token });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <CommentUnsubscribeView
      link={link}
      working={working}
      error={error}
      onUnsubscribe={handleUnsubscribe}
    />
  );
}
