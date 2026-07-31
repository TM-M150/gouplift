import { z } from "zod";

export const signUpSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, "First name must be at least 2 characters")
      .max(50, "First name is too long"),
    middleName: z
      .string()
      .trim()
      .max(50, "Middle name is too long")
      .optional()
      .or(z.literal("")),
    lastName: z
      .string()
      .trim()
      .min(2, "Last name must be at least 2 characters")
      .max(50, "Last name is too long"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.string().email("Please enter a valid email address")),
    phoneNumber: z
      .string()
      .trim()
      .min(10, "Phone number must be at least 10 digits")
      .regex(/^[+0-9\s-]+$/, "Please enter a valid phone number"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignUpValues = z.infer<typeof signUpSchema>;
