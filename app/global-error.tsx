"use client";

import "./globals.css";

// The last resort: the root layout itself failed, so there are no providers,
// no header and nothing the rest of the site relies on. This replaces the whole
// document, so it needs its own <html> and <body>, and it keeps to plain
// elements that can't fail for the same reason. A plain link, too, rather than
// the router's.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en-GB">
      <body
        // The site's fonts are set up in the layout this page replaces, so
        // name a system font outright instead of relying on them.
        style={{
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
        className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground antialiased"
      >
        <title>Something went wrong | GoUplift</title>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-4 max-w-md text-pretty text-lg text-muted-foreground">
          That was on our side, not yours. Please try again. If it keeps
          happening, wait a few minutes and come back.
        </p>
        <p className="mt-3 max-w-md text-pretty text-sm text-muted-foreground">
          If you were in the middle of a donation, check your phone or email for
          a confirmation before you try again, so you don&apos;t give twice.
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="inline-flex h-9 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            Try again
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-2xl px-4 text-sm font-medium hover:bg-muted"
          >
            Go to the homepage
          </a>
        </div>
        {error.digest && (
          <p className="mt-8 text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
