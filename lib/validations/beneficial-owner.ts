import { z } from "zod";
import { isCountryCode } from "../countries";
import {
  BENEFICIAL_OWNER_BASES,
  MAX_BENEFICIAL_OWNERS,
  ownershipProblem,
} from "../beneficial-ownership";
import {
  isPlausibleIdNumber,
  KYC_ID_TYPES,
  normalizeIdNumber,
} from "../kyc";

// One person on an organization's beneficial ownership register (policy 6).
// The ID number comes out normalized, like a fundraiser's, so the same ID
// always compares equal.
export const beneficialOwnerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter the person's full name as it appears on their ID")
      .max(100, "That name is too long"),
    idType: z.enum(KYC_ID_TYPES, { error: "Choose the type of ID" }),
    idNumber: z
      .string()
      .trim()
      .min(1, "Enter the person's ID number")
      .max(30, "That ID number is too long")
      .transform(normalizeIdNumber),
    basis: z.enum(BENEFICIAL_OWNER_BASES, {
      error: "Say how this person owns or controls the organization",
    }),
    ownershipPercent: z
      .number({ error: "Enter the ownership share as a number" })
      .max(100, "An ownership share is at most 100%")
      .optional(),
    role: z
      .string()
      .trim()
      .max(100, "Keep this under 100 characters")
      .optional(),
    residenceCountry: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountryCode, "Choose the country this person lives in"),
    pepDeclared: z.boolean({
      error: "Say whether this person holds a senior public position",
    }),
  })
  .superRefine((owner, ctx) => {
    if (!isPlausibleIdNumber(owner.idType, owner.idNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["idNumber"],
        message:
          owner.idType === "NATIONAL_ID"
            ? "A National ID number is 6 to 10 digits"
            : "Check the passport number",
      });
    }
  });
export type BeneficialOwnerInput = z.infer<typeof beneficialOwnerSchema>;

/** A whole register: each person valid, and the list as a whole acceptable. */
export const beneficialOwnersSchema = z
  .array(beneficialOwnerSchema)
  .max(MAX_BENEFICIAL_OWNERS, `List at most ${MAX_BENEFICIAL_OWNERS} people`)
  .superRefine((owners, ctx) => {
    const problem = ownershipProblem(owners);
    if (problem) ctx.addIssue({ code: "custom", message: problem });

    // The same person twice would let one share count as two.
    const seen = new Set<string>();
    for (const owner of owners) {
      const key = `${owner.idType}:${owner.idNumber}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "The same person is listed more than once.",
        });
        break;
      }
      seen.add(key);
    }
  });
