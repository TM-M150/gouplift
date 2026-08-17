import { z } from "zod";

export const fundraiserObjectSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(40, "Title must be less than 40 characters"),
  tagline: z.string().trim().max(150).optional(),
  story: z
    .string()
    .trim()
    .min(50, "Tell your story in at least 50 characters")
    .max(20000, "Story is too long"),
  type: z.enum([
    "MEDICAL",
    "EDUCATION",
    "EMERGENCY",
    "MEMORIAL_FUNERAL",
    "COMMUNITY_HARAMBEE",
    "BUSINESS_STARTUP",
    "SPORTS",
    "CREATIVE_ARTS",
    "ANIMAL_WELFARE",
    "ENVIRONMENT",
    "DISASTER_RELIEF",
    "NONPROFIT",
    "OTHER",
  ]),
  tags: z.array(z.string().trim().max(30)).max(10, "Up to 10 tags").optional(),
  coverImage: z.url().optional(),
  goalAmount: z
    .number()
    .positive("Goal amount must be greater than 0")
    .max(1_000_000_000, "Goal amount is unrealistically high"),
  currency: z.enum(["KES"]),
  amountRaised: z.number().nonnegative().default(0),
  donorCount: z.number().int().nonnegative().default(0),
  status: z
    .enum([
      "DRAFT",
      "PENDING_REVIEW",
      "ACTIVE",
      "PAUSED",
      "COMPLETED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
    ])
    .default("ACTIVE"),
  country: z.string().trim().max(60).default("Kenya"),
  location: z.string().trim().max(120).optional(),
  beneficiaryType: z.enum(["SELF", "SOMEONE_ELSE", "ORGANIZATION"]),
  beneficiaryName: z.string().trim().max(100).optional(),
  beneficiaryRelationship: z.string().trim().max(60).optional(),
  organizationName: z.string().trim().max(120).optional(),
});

function requireBeneficiaryDetails(
  data: z.infer<typeof fundraiserObjectSchema>,
  ctx: z.RefinementCtx,
) {
  if (data.beneficiaryType === "SOMEONE_ELSE" && !data.beneficiaryName) {
    ctx.addIssue({
      code: "custom",
      path: ["beneficiaryName"],
      message: "Add who you're fundraising for",
    });
  }
  if (data.beneficiaryType === "ORGANIZATION" && !data.organizationName) {
    ctx.addIssue({
      code: "custom",
      path: ["organizationName"],
      message: "Add the organization's name",
    });
  }
}

export const fundraiserSchema = fundraiserObjectSchema.superRefine(
  requireBeneficiaryDetails,
);

export const fundraiserFrontend = fundraiserObjectSchema
  .extend({
    coverImageFile: z
      .custom<File>((val) => val instanceof File, "Please select an image file")
      .optional(),
  })
  .superRefine(requireBeneficiaryDetails);

export type FundraiserInput = z.infer<typeof fundraiserSchema>;
export type FundraiserFrontendInput = z.infer<typeof fundraiserFrontend>;
