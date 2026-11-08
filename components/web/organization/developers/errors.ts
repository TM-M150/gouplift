import { ConvexError } from "convex/values";

// Messages the backend throws on purpose (a ConvexError carrying a string) are
// written for the person using the page, so they are shown as they are.
// Anything else is a bug or an outage, and gets a generic line.
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return "Something went wrong. Please try again.";
}
