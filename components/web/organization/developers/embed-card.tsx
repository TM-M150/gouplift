"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "./copy-button";

// The page's origin never changes while it is open, so there is nothing to
// subscribe to.
const subscribeToNothing = () => () => {};

const LIMITS = [3, 6, 12, 24] as const;
type Theme = "light" | "dark";

export function EmbedCard({
  slug,
  isVerified,
}: {
  slug: string;
  isVerified: boolean;
}) {
  const [limit, setLimit] = React.useState<(typeof LIMITS)[number]>(6);
  const [theme, setTheme] = React.useState<Theme>("light");

  // The address the snippet points at is wherever this dashboard is served
  // from, which is only known in the browser (empty while rendering on the
  // server, so the first paint matches and the real address fills in after).
  const origin = React.useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );

  const snippet = [
    `<div data-gouplift-org="${slug}" data-limit="${limit}"${
      theme === "dark" ? ' data-theme="dark"' : ""
    }></div>`,
    `<script async src="${origin || "https://your-gouplift-domain"}/embed.js"></script>`,
  ].join("\n");

  const previewSrc = `/embed/organizations/${slug}?limit=${limit}${
    theme === "dark" ? "&theme=dark" : ""
  }`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Show your fundraisers on your website</CardTitle>
        <CardDescription>
          Paste this where you want the widget to appear. It always shows your
          current active fundraisers, and donating opens GoUplift in a new tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isVerified && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            The widget only shows once your organization is verified. Until
            then it will say it isn&apos;t available.
          </p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">How many</legend>
            <div className="flex gap-1.5">
              {LIMITS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={limit === value ? "default" : "outline"}
                  aria-pressed={limit === value}
                  onClick={() => setLimit(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Theme</legend>
            <div className="flex gap-1.5">
              {(["light", "dark"] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={theme === value ? "default" : "outline"}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                  className="capitalize"
                >
                  {value}
                </Button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="space-y-2">
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
            <code>{snippet}</code>
          </pre>
          <CopyButton value={snippet} label="Copy snippet" />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Preview</p>
          <iframe
            key={previewSrc}
            src={previewSrc}
            title="Widget preview"
            className="h-[480px] w-full rounded-lg border bg-background"
          />
        </div>
      </CardContent>
    </Card>
  );
}
