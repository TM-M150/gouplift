import { APIError, createAuthMiddleware } from "better-auth/api";
import { KENYAN_MOBILE_MESSAGE, normalizeKenyanMobile } from "../../lib/phone";

// Phone numbers on accounts must be Kenyan mobile numbers, kept as
// +254XXXXXXXXX. The sign-up and sign-in forms say so, but a form can't stop a
// request that doesn't come from it, so the same rule is enforced here, inside
// better-auth, for every way a number can arrive:
//
// - a request hook tidies and checks the number on email sign-up and on
//   sign-in by phone (signing in compares the typed number with the stored one
//   exactly, so it must be typed in the stored form);
// - database hooks check it again whenever an account's number is stored or
//   changed, so no other route can put in another country's number or an
//   unusual spelling of a Kenyan one (better-auth's profile update refuses to
//   change a phone number at all today; this is what keeps that true of any
//   route that is switched on later);
// - the phone plugin's other routes (one-time codes, which aren't switched on)
//   are held to the same rule, so they can't be used around it.
//
// Accounts made with Google have no phone number, and keep having none.

export const PHONE_TAKEN_MESSAGE =
  "That phone number is already used by another account. Sign in with it, or use a different number.";

const EMAIL_SIGN_UP = "/sign-up/email";
const PHONE_SIGN_IN = "/sign-in/phone-number";
const PHONE_PLUGIN_ROUTES = "/phone-number/";

const invalidNumber = () =>
  new APIError("BAD_REQUEST", {
    message: KENYAN_MOBILE_MESSAGE,
    code: "INVALID_PHONE_NUMBER",
  });

/** The part of better-auth's request context the database hooks use. */
export interface PhoneHookContext {
  context: {
    adapter: {
      findOne<T>(query: {
        model: string;
        where: Array<{ field: string; value: string }>;
      }): Promise<T | null>;
    };
  };
}

/**
 * Sign-up needs a Kenyan mobile number, and signing in by phone needs one to
 * look for. Either way the request carries it in the stored form from here on.
 * The phone plugin's other routes only have to be given a Kenyan one if they
 * are given one at all.
 */
export async function beforeRequest(ctx: {
  path?: string;
  body?: unknown;
}): Promise<{ context: { body: Record<string, unknown> } } | void> {
  const path = ctx.path ?? "";
  const mustHaveNumber = path === EMAIL_SIGN_UP || path === PHONE_SIGN_IN;
  if (!mustHaveNumber && !path.startsWith(PHONE_PLUGIN_ROUTES)) return;

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (!mustHaveNumber && body.phoneNumber === undefined) return;

  const phoneNumber =
    typeof body.phoneNumber === "string"
      ? normalizeKenyanMobile(body.phoneNumber)
      : null;
  if (!phoneNumber) throw invalidNumber();

  return { context: { body: { ...body, phoneNumber } } };
}

/**
 * Refuses a number another account already holds, in words a person can act
 * on, when someone is signing up. (The database refuses it too, with a message
 * nobody would understand.) Outside a request there is nobody to tell, so the
 * database check stands alone.
 */
async function refuseIfTaken(
  ctx: PhoneHookContext | null,
  phoneNumber: string,
): Promise<void> {
  if (!ctx) return;
  const holder = await ctx.context.adapter.findOne<{ id: string }>({
    model: "user",
    where: [{ field: "phoneNumber", value: phoneNumber }],
  });
  if (holder) {
    throw new APIError("BAD_REQUEST", {
      message: PHONE_TAKEN_MESSAGE,
      code: "PHONE_NUMBER_TAKEN",
    });
  }
}

/** Runs just before an account is stored. */
export async function beforeUserCreated(
  user: { phoneNumber?: unknown } & Record<string, unknown>,
  ctx: PhoneHookContext | null,
): Promise<{ data: Record<string, unknown> } | void> {
  // Signed in with Google: no number to check.
  if (user.phoneNumber === undefined || user.phoneNumber === null) return;

  const phoneNumber =
    typeof user.phoneNumber === "string"
      ? normalizeKenyanMobile(user.phoneNumber)
      : null;
  if (!phoneNumber) throw invalidNumber();

  await refuseIfTaken(ctx, phoneNumber);
  return { data: { ...user, phoneNumber } };
}

/**
 * Runs just before an account's details are changed. Only a change to the
 * number matters here; the database refuses a number someone else holds.
 */
export async function beforeUserUpdated(
  changes: { phoneNumber?: unknown } & Record<string, unknown>,
): Promise<{ data: Record<string, unknown> } | void> {
  // Not touching the number: nothing to check.
  if (changes.phoneNumber === undefined) return;

  const phoneNumber =
    typeof changes.phoneNumber === "string"
      ? normalizeKenyanMobile(changes.phoneNumber)
      : null;
  if (!phoneNumber) throw invalidNumber();

  return { data: { ...changes, phoneNumber } };
}

/** The rules as better-auth settings. */
export const kenyanPhoneRules = {
  databaseHooks: {
    user: {
      create: { before: beforeUserCreated },
      update: { before: beforeUserUpdated },
    },
  },
  hooks: {
    before: createAuthMiddleware(beforeRequest),
  },
};
