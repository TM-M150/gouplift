import { z } from "zod";
import { isCountryCode } from "../countries";
import { EXPECTED_TIMELINES } from "../risk";
import {
  isPlausibleIdNumber,
  isValidKraPin,
  KYC_ID_TYPES,
  normalizeIdNumber,
  normalizeKenyanMobile,
  normalizeKraPin,
} from "../kyc";

// The largest amount we'll take as a declaration. Only a sanity limit: it
// keeps typos (and numbers Convex can't store exactly) out of the risk rating.
export const MAX_EXPECTED_AMOUNT_KES = 1_000_000_000;

// What Tier 1 asks for (policy 5.3, 5.7, 7, 9): the ID, a mobile number in the
// fundraiser's own name, the purpose of the campaign, where they live, how much
// they expect to raise and by when, whether they are a PEP, and that the money
// isn't for anything we prohibit. The values come out normalized, so the same
// ID or number always compares equal.
export const kycTier1DetailsSchema = z
  .object({
    legalName: z
      .string()
      .trim()
      .min(2, "Enter your full name as it appears on your ID")
      .max(100, "Your name is too long"),
    idType: z.enum(KYC_ID_TYPES, { error: "Choose the type of ID" }),
    idNumber: z
      .string()
      .trim()
      .min(1, "Enter your ID number")
      .max(30, "That ID number is too long")
      .transform(normalizeIdNumber),
    phoneNumber: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const normalized = normalizeKenyanMobile(value);
        if (!normalized) {
          ctx.addIssue({
            code: "custom",
            message:
              "Enter a Kenyan mobile number, like 0712 345 678. Payouts are made to M-Pesa.",
          });
          return z.NEVER;
        }
        return normalized;
      }),
    campaignPurpose: z
      .string()
      .trim()
      .min(10, "Tell us briefly what the money is for")
      .max(500, "Keep this under 500 characters"),
    residenceCountry: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountryCode, "Choose the country you live in"),
    expectedAmountKes: z
      .number({ error: "Enter how much you expect to raise" })
      .int("Enter a whole number of shillings")
      .min(1, "Enter how much you expect to raise")
      .max(MAX_EXPECTED_AMOUNT_KES, "That amount is too large"),
    expectedTimeline: z.enum(EXPECTED_TIMELINES, {
      error: "Choose how long you expect it to take",
    }),
    pepDeclared: z.boolean({ error: "Tell us whether this applies to you" }),
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
        message:
          "Tell us who it is and what their role is (a position, or how you are related)",
      });
    }
    if (!isPlausibleIdNumber(details.idType, details.idNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["idNumber"],
        message:
          details.idType === "NATIONAL_ID"
            ? "A National ID number is 6 to 10 digits"
            : "Check your passport number",
      });
    }
  });
export type KycTier1Details = z.infer<typeof kycTier1DetailsSchema>;

// What Tier 2 adds on top of an approved Tier 1.
export const kycTier2DetailsSchema = z.object({
  kraPin: z
    .string()
    .trim()
    .transform(normalizeKraPin)
    .refine(isValidKraPin, "Enter your KRA PIN, like A123456789Z"),
});
export type KycTier2Details = z.infer<typeof kycTier2DetailsSchema>;
