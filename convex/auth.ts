import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { phoneNumber } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import { betterAuth } from "better-auth/minimal";
import { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { EMAIL_FROM, sendEmail } from "./lib/email";
import { emailConfirmationOptions } from "./lib/emailConfirmation";
import { signInRules } from "./lib/signInRules";

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// Resend password reset email
async function sendPasswordResetEmail(
  to: string,
  url: string,
  userName?: string,
) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing RESEND_API_KEY — set it with `npx convex env set`.",
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject: "Reset your GoUplift password",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Reset your GoUplift password</h2>

          <p>
            Hello ${userName || "there"},
          </p>

          <p>
            We received a request to reset your GoUplift password.
          </p>

          <p>
            Click the button below to choose a new password:
          </p>

          <p>
            <a
              href="${url}"
              style="
                display: inline-block;
                padding: 12px 20px;
                background-color: #16a34a;
                color: white;
                text-decoration: none;
                border-radius: 6px;
              "
            >
              Reset Password
            </a>
          </p>

          <p>
            This link expires in 1 hour.
            If you did not request a password reset,
            you can safely ignore this email.
          </p>

          <p>
            Regards,<br />
            GoUplift Team
          </p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Resend request failed (${response.status}): ${await response.text()}`,
    );
  }
}

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
        if (
          newDoc.email === oldDoc.email &&
          newDoc.name === oldDoc.name &&
          newDoc.image === oldDoc.image &&
          newDoc.phoneNumber === oldDoc.phoneNumber
        ) {
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

        if (user) {
          await ctx.db.delete(user._id);
        }
      },
    },
  },
});

// Expose trigger handlers
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

    // Where better-auth sends people when sign-in fails somewhere it can't
    // return them to the page they started from (a Google sign-in opened in a
    // different browser, say). The sign-in page explains it from the code.
    onAPIError: {
      errorURL: `${siteUrl}/sign-in`,
    },

    emailAndPassword: {
      enabled: true,
      // Not required to sign in: people get in straight away and confirm later.
      // Only withdrawals wait for a confirmed address (see emailConfirmed.ts).
      // It couldn't be a real lock anyway: signing in with a phone number and
      // password doesn't pass through this check.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url, user.name);
      },
      // Whoever resets a password is signed out everywhere else. If someone
      // else had got into the account, a reset now puts them out.
      revokeSessionsOnPasswordReset: true,
    },

    // The "confirm your email" message sent at sign-up and again from the
    // banner. See emailConfirmation.ts for the settings and for what happens
    // when sending fails.
    ...emailConfirmationOptions({
      consume: async (key, limit) => {
        // Only queries lack runMutation, and nothing here runs in a query.
        // If it ever did, nothing is sent rather than sending without a limit.
        if (!("runMutation" in ctx)) return { allowed: false, retryAfterMs: 0 };
        return await ctx.runMutation(internal.lib.rateLimit.consume, {
          key,
          ...limit,
        });
      },
      send: sendEmail,
    }),

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },

    // Google sign-in joining an account made with a password, and phone
    // numbers having to be Kenyan mobile numbers (see the files).
    ...signInRules,

    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },

    plugins: [phoneNumber(), convex({ authConfig })],
  });
};
