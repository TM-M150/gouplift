import { ConvexError } from "convex/values";

const TIME_ZONE = "Africa/Nairobi";

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Only http(s) URLs are safe to turn into a link. A website typed by an
 * organization could otherwise be a `javascript:` URL, and staff are the
 * people clicking these.
 */
export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
