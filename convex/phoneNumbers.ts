import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { createAuth } from "./auth";
import { runPhoneBackfill, type StoredPhone } from "./lib/phoneBackfill";

const PAGE_SIZE = 500;

/** One page of the accounts that have a phone number. */
export const listStoredPhones = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    page: v.array(
      v.object({ authUserId: v.string(), phoneNumber: v.string() }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("users")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor });
    return {
      page: result.page.flatMap((user) =>
        user.phoneNumber
          ? [{ authUserId: user.authUserId, phoneNumber: user.phoneNumber }]
          : [],
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Rewrites the phone numbers of existing accounts as +254XXXXXXXXX, so signing
 * in by phone finds them however the number is typed. See lib/phoneBackfill.ts.
 *
 * It changes nothing unless told to:
 *
 *   npx convex run phoneNumbers:normalizeStoredPhoneNumbers
 *   npx convex run phoneNumbers:normalizeStoredPhoneNumbers '{"apply": true}'
 *
 * Run the first and read the result, then the second. Safe to run again.
 */
export const normalizeStoredPhoneNumbers = internalAction({
  args: { apply: v.optional(v.boolean()) },
  returns: v.object({
    applied: v.boolean(),
    checked: v.number(),
    alreadyTidy: v.number(),
    toUpdate: v.number(),
    updated: v.number(),
    notKenyan: v.array(v.string()),
    clashes: v.array(v.string()),
    failed: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // The accounts are updated through better-auth itself, so its rules run and
    // the copy of the number on the profile is kept in step.
    const { internalAdapter } = await createAuth(ctx).$context;

    const summary = await runPhoneBackfill(
      {
        listPhones: async () => {
          const phones: StoredPhone[] = [];
          let cursor: string | null = null;
          for (;;) {
            const page: {
              page: StoredPhone[];
              isDone: boolean;
              continueCursor: string;
            } = await ctx.runQuery(internal.phoneNumbers.listStoredPhones, {
              cursor,
            });
            phones.push(...page.page);
            if (page.isDone) return phones;
            cursor = page.continueCursor;
          }
        },
        setPhone: async (authUserId, phoneNumber) => {
          await internalAdapter.updateUser(authUserId, { phoneNumber });
        },
      },
      { apply: args.apply ?? false },
    );

    console.log("Phone number clean-up", {
      ...summary,
      notKenyan: summary.notKenyan.length,
      clashes: summary.clashes.length,
      failed: summary.failed.length,
    });
    return summary;
  },
});
