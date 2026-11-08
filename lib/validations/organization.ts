import { z } from "zod";
import { isCountryCode } from "../countries";
import { ORGANIZATION_TYPES } from "../organization-verification";
import { EXPECTED_TIMELINES } from "../risk";
import { beneficialOwnersSchema } from "./beneficial-owner";
import { MAX_EXPECTED_AMOUNT_KES } from "./kyc";

// Empty optional inputs arrive as "" from forms; treat them as "not provided".
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

// What an organization declares about itself (policy 5.7, 5.8, 6, 7, 9): where
// it is registered, what it expects to raise, who owns or controls it, whether
// any of its people hold a senior public position, and that its purpose isn't
// a prohibited one.
export const organizationDetailsSchema = z
  .object({
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
  registeredCountry: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCountryCode, "Choose the country it is registered in"),
  expectedAmountKes: z
    .number({ error: "Enter how much you expect to raise" })
    .int("Enter a whole number of shillings")
    .min(1, "Enter how much you expect to raise")
    .max(MAX_EXPECTED_AMOUNT_KES, "That amount is too large"),
  expectedTimeline: z.enum(EXPECTED_TIMELINES, {
    error: "Choose how long you expect it to take",
  }),
  beneficialOwners: beneficialOwnersSchema,
  pepDeclared: z.boolean({ error: "Tell us whether this applies" }),
  pepDetails: z
    .string()
    .trim()
    .max(500, "Keep this under 500 characters")
    .optional(),
  prohibitedActivitiesAcknowledged: z.literal(true, {
    error: "Please confirm this before you continue",
  }),
})
  .superRefine((details, ctx) => {
    if (details.pepDeclared && (details.pepDetails?.length ?? 0) < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["pepDetails"],
        message: "Tell us who it is and what their role is",
      });
    }
    // An owner who says they are a PEP can't sit under an answer of "no".
    if (
      !details.pepDeclared &&
      details.beneficialOwners.some((owner) => owner.pepDeclared)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["pepDeclared"],
        message:
          "You said one of the owners holds a senior public position, so answer yes here",
      });
    }
  });

export type OrganizationDetails = z.infer<typeof organizationDetailsSchema>;
