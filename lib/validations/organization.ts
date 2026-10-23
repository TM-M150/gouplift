import { z } from "zod";
import { ORGANIZATION_TYPES } from "../organization-verification";

// Empty optional inputs arrive as "" from forms; treat them as "not provided".
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const organizationDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name is required")
    .max(100, "Organization name must be less than 100 characters"),
  organizationType: z.enum(ORGANIZATION_TYPES, {
    error: "Choose what type of organization this is",
  }),
  registrationNumber: z
    .string()
    .trim()
    .min(2, "Enter your registration number")
    .max(60, "Registration number is too long"),
  description: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(2000, "Description is too long").optional(),
  ),
  website: z.preprocess(
    emptyToUndefined,
    z.url("Enter a valid website, including https://").optional(),
  ),
  contactEmail: z.preprocess(
    emptyToUndefined,
    z.email("Enter a valid contact email").optional(),
  ),
  contactPhone: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(20, "Phone number is too long").optional(),
  ),
});

export type OrganizationDetails = z.infer<typeof organizationDetailsSchema>;
