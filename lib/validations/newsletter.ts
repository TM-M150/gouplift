import { z } from "zod";

// Shared by the footer form (to tell people straight away) and the Convex
// mutation (which never trusts the form), so both accept the same addresses.
export const newsletterEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254, "That email address is too long")
  .pipe(z.string().email("Please enter a valid email address"));
