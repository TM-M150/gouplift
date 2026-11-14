"use client";

import { ErrorContent } from "@/components/web/error/error-content";

// A page in the public site failed. The layout above it, with the header and
// footer, is still standing, so only the page is replaced.
export default function PublicError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorContent error={error} onRetry={unstable_retry} />;
}
