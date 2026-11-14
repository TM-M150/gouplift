"use client";

import { ErrorContent } from "@/components/web/error/error-content";

// Everything outside the public pages (sign-in, the admin area, organization
// dashboards) and the public layout itself. No site header here, so the page
// stands on its own.
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorContent error={error} onRetry={unstable_retry} standalone />;
}
