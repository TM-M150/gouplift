import { z } from "zod";
import {
  isPlausibleIdNumber,
  isValidKraPin,
  KYC_ID_TYPES,
  normalizeIdNumber,
  normalizeKenyanMobile,
  normalizeKraPin,
} from "../kyc";

// What Tier 1 asks for (policy 5.3): the ID, a mobile number in the
// fundraiser's own name, and the purpose of the campaign. The values come out
// normalized, so the same ID or number always compares equal.
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
              "Enter a Kenyan mobile number, like 0712 345 678. Fundraisers outside Kenya need approval from our compliance team.",
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
  })
  .superRefine((details, ctx) => {
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
