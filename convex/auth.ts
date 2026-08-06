// convex/auth.ts
import { createClient, type AuthFunctions, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { phoneNumber } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import { betterAuth } from "better-auth/minimal";
import { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        const now = Date.now();
        await ctx.db.insert("users", {
          authUserId: authUser._id,
          email: authUser.email,
          displayName: authUser.name,
          image: authUser.image ?? undefined,
          phoneNumber: authUser.phoneNumber ?? undefined,
          username: undefined,
          bio: "",
          coverImage: undefined,
          courses: undefined,
          location: undefined,
          website: undefined,
          dateOfBirth: undefined,
          role: "USER",
          isPrivate: true,
          isVerified: false,
          createdAt: now,
          updatedAt: now,
        });
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        if (newDoc.email === oldDoc.email && newDoc.name === oldDoc.name && newDoc.image === oldDoc.image && newDoc.phoneNumber === oldDoc.phoneNumber) {
          return;
        }
        const user = await ctx.db
          .query("users")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", newDoc._id))
          .unique();
        if (user) {
          await ctx.db.patch(user._id, {
            email: newDoc.email,
            displayName: newDoc.name,
            image: newDoc.image ?? undefined,
            phoneNumber: newDoc.phoneNumber ?? undefined,
            updatedAt: Date.now(),
          });
        }
      },
      onDelete: async (ctx, authUser) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
          .unique();
        if (user) await ctx.db.delete(user._id);
      },
    },
  },
});

// Required: exposes the trigger handlers above as real callable Convex
// functions so the component can actually invoke them at runtime.
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) => {
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
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [phoneNumber(), convex({ authConfig })],
  });
};