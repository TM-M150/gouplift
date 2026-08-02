// convex/auth.ts
import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { phoneNumber } from "better-auth/plugins";
import { components } from "./_generated/api";
import { betterAuth } from "better-auth/minimal";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

export const authComponent = createClient(components.betterAuth);

export const createAuth = (ctx: GenericCtx) => {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [
      siteUrl,
      "http://localhost:3000",
      "https://localhost:3000",
      "https://psychic-guacamole-577gv46pgr92p4q4-3000.app.github.dev",
      "https://www.gouplift.africa",
      "https://gouplift.africa",
      "https://www.gouplift.co.ke",
      "https://gouplift.co.ke",
    ],
    // Extend user schema with custom fields
    user: {
      additionalFields: {
        bio: {
          type: "string",
          required: false,
          defaultValue: "",
          input: true, // Enables updating via client auth update calls
        },
        isPrivate: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: true,
        },
      },
    },
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      phoneNumber(),
      convex({ authConfig }),
    ],
  });
};