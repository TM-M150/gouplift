// schemas/profile.ts
import { z } from "zod";
import { countWords } from "../utils";

export const profileSchema = z.object({
  username: z.string().trim().min(3).max(20).optional(),
  bio: z
    .string()
    .trim()
    .max(4000, "Bio is too long")
    .refine((val) => countWords(val) <= 500, "Bio must be 500 words or fewer")
    .optional(),
  location: z.string().trim().max(80).optional(),
  website: z.string().trim().url().optional().or(z.literal("")),
  courses: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  isPrivate: z.boolean().optional(),
});
