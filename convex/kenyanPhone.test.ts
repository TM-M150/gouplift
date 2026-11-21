// @vitest-environment node
//
// Phone numbers on accounts must be Kenyan mobile numbers, kept as
// +254XXXXXXXXX. These run better-auth's real sign-up, sign-in and
// profile-update code against an in-memory database, with the same hooks the
// real sign-in setup uses, so they show what happens to a request rather than
// what we hope the settings do.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { phoneNumber } from "better-auth/plugins";
import { signInRules } from "./lib/signInRules";
import {
  PHONE_TAKEN_MESSAGE,
  beforeRequest,
  beforeUserCreated,
  beforeUserUpdated,
} from "./lib/kenyanPhone";
import {
  KENYAN_MOBILE_MESSAGE,
  SIGN_IN_IDENTIFIER_MESSAGE,
  parseSignInIdentifier,
} from "../lib/phone";
import { signInSchema, signUpSchema } from "../lib/validations/auth";

const BASE = "http://localhost:3000";
const PASSWORD = "Sup3r-secret-pw";

type Row = Record<string, unknown>;

function makeAuth() {
  const db: Record<string, Row[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: BASE,
    secret: "a-test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter(db),
    trustedOrigins: [BASE],
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
    plugins: [phoneNumber()],
    // The same Google and phone number settings as the real sign-in setup.
    ...signInRules,
  });
  return { auth, db };
}
type Auth = ReturnType<typeof makeAuth>["auth"];

// ---- Helpers ---------------------------------------------------------------

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .filter((line) => !/max-age=0/i.test(line))
    .map((line) => line.split(";")[0])
    .join("; ");
}

function post(path: string, body: unknown, cookie = "") {
  return new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function send(auth: Auth, path: string, body: unknown, cookie = "") {
  const res = await auth.handler(post(path, body, cookie));
  const json = (await res.json().catch(() => null)) as {
    message?: string;
    code?: string;
    user?: { phoneNumber?: string | null };
  } | null;
  return { status: res.status, json, cookie: cookieHeader(res.headers) };
}

let counter = 0;
const signUp = (auth: Auth, body: Record<string, unknown> = {}) =>
  send(auth, "/sign-up/email", {
    name: "Wanjiru Kamau",
    email: `wanjiru${++counter}@example.test`,
    password: PASSWORD,
    phoneNumber: "0712 345 678",
    ...body,
  });

const signInByPhone = (auth: Auth, phone: string, password = PASSWORD) =>
  send(auth, "/sign-in/phone-number", { phoneNumber: phone, password });

const storedNumbers = (db: Record<string, Row[]>) =>
  db.user.map((user) => user.phoneNumber);

// ---------------------------------------------------------------------------

describe("what counts as a Kenyan mobile number when signing in", () => {
  it("turns any usual way of typing a Kenyan mobile into +254XXXXXXXXX", () => {
    for (const typed of [
      "0712345678",
      "0712 345 678",
      "+254712345678",
      "+254 712 345 678",
      "254712345678",
      "0712-345-678",
      " (0712) 345678 ",
    ]) {
      expect(parseSignInIdentifier(typed), typed).toEqual({
        kind: "phone",
        phoneNumber: "+254712345678",
      });
    }
    expect(parseSignInIdentifier("0112345678")).toEqual({
      kind: "phone",
      phoneNumber: "+254112345678",
    });
  });

  it("takes an email address as it is", () => {
    expect(parseSignInIdentifier("  wanjiru@example.test ")).toEqual({
      kind: "email",
      email: "wanjiru@example.test",
    });
  });

  it("turns away numbers that aren't Kenyan mobiles", () => {
    for (const typed of [
      "+14155550123", // American
      "+255712345678", // Tanzanian
      "+256712345678", // Ugandan
      "0212345678", // a Nairobi landline
      "0812345678",
      "+25471234567", // one digit short
      "+2547123456789", // one digit long
      "712345678", // no prefix
      "abc",
      "",
      "   ",
    ]) {
      expect(parseSignInIdentifier(typed), typed).toBeNull();
    }
  });
});

describe("the sign-up and sign-in forms", () => {
  const signUpInput = {
    firstName: "Wanjiru",
    middleName: "",
    lastName: "Kamau",
    email: "wanjiru@example.test",
    phoneNumber: "0712 345 678",
    password: "Sup3rsecret",
    confirmPassword: "Sup3rsecret",
  };

  it("sign-up keeps the number as +254XXXXXXXXX", () => {
    const parsed = signUpSchema.safeParse(signUpInput);
    expect(parsed.success && parsed.data.phoneNumber).toBe("+254712345678");
  });

  it("sign-up asks for a Kenyan mobile number, and says what that looks like", () => {
    for (const phoneNumber of [
      "",
      "+14155550123",
      "0212345678",
      "12345678901",
    ]) {
      const parsed = signUpSchema.safeParse({ ...signUpInput, phoneNumber });
      expect(parsed.success, phoneNumber).toBe(false);
      expect(
        !parsed.success && parsed.error.issues.map((issue) => issue.message),
      ).toContain(KENYAN_MOBILE_MESSAGE);
    }
  });

  it("the messages tell a person what to type", () => {
    // These are the words people see, so they are pinned here rather than
    // compared with themselves.
    expect(KENYAN_MOBILE_MESSAGE).toBe(
      "Enter a Kenyan mobile number, like 0712 345 678.",
    );
    expect(SIGN_IN_IDENTIFIER_MESSAGE).toBe(
      "Enter your email address or a Kenyan mobile number, like 0712 345 678.",
    );
  });

  it("sign-in accepts an email or a Kenyan mobile number", () => {
    for (const identifier of [
      "wanjiru@example.test",
      "0712345678",
      "+254712345678",
    ]) {
      expect(
        signInSchema.safeParse({ identifier, password: "x" }).success,
        identifier,
      ).toBe(true);
    }
  });

  it("sign-in turns away another country's number before anything is sent", () => {
    const parsed = signInSchema.safeParse({
      identifier: "+14155550123",
      password: "x",
    });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0].message).toBe(
      SIGN_IN_IDENTIFIER_MESSAGE,
    );
    // Left empty it says what is missing rather than what is wrong.
    const empty = signInSchema.safeParse({ identifier: "", password: "x" });
    expect(!empty.success && empty.error.issues[0].message).toBe(
      "Email or phone number is required",
    );
  });
});

describe("signing up", () => {
  it("stores a Kenyan mobile number as +254XXXXXXXXX, however it was typed", async () => {
    const cases: Array<[typed: string, stored: string]> = [
      ["0712345678", "+254712345678"],
      ["0722 000 111", "+254722000111"],
      ["+254 733 000 111", "+254733000111"],
      ["254744000111", "+254744000111"],
      ["0112-345-678", "+254112345678"],
    ];
    const { auth, db } = makeAuth();
    for (const [typed, stored] of cases) {
      const res = await signUp(auth, { phoneNumber: typed });
      expect(res.status, typed).toBe(200);
      expect(res.json?.user?.phoneNumber, typed).toBe(stored);
    }
    expect(storedNumbers(db)).toEqual(cases.map(([, stored]) => stored));
  });

  it("turns away a number that isn't a Kenyan mobile, and makes no account", async () => {
    const { auth, db } = makeAuth();
    for (const phoneNumber of [
      "+14155550123",
      "+255712345678",
      "0212345678",
      "+25471234567",
      "not a number",
    ]) {
      const res = await signUp(auth, { phoneNumber });
      expect(res.status, phoneNumber).toBe(400);
      expect(res.json?.message, phoneNumber).toBe(KENYAN_MOBILE_MESSAGE);
    }
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
  });

  it("needs a number", async () => {
    const { auth, db } = makeAuth();
    const missing = await send(auth, "/sign-up/email", {
      name: "Wanjiru Kamau",
      email: "no-phone@example.test",
      password: PASSWORD,
    });
    expect(missing.status).toBe(400);
    expect(missing.json?.message).toBe(KENYAN_MOBILE_MESSAGE);

    for (const phoneNumber of ["", "   ", 712345678, null]) {
      const res = await signUp(auth, { phoneNumber });
      expect(res.status, String(phoneNumber)).toBe(400);
    }
    expect(db.user).toHaveLength(0);
  });

  it("won't give two accounts the same number, however it is typed", async () => {
    const { auth, db } = makeAuth();
    expect((await signUp(auth, { phoneNumber: "0712 345 678" })).status).toBe(
      200,
    );

    for (const typed of ["0712345678", "+254712345678", "254 712 345 678"]) {
      const again = await signUp(auth, { phoneNumber: typed });
      expect(again.status, typed).toBe(400);
      expect(again.json?.message, typed).toBe(PHONE_TAKEN_MESSAGE);
    }
    expect(db.user).toHaveLength(1);
    expect(storedNumbers(db)).toEqual(["+254712345678"]);
  });
});

describe("signing in by phone", () => {
  it("finds the account however the number is typed", async () => {
    const { auth } = makeAuth();
    // Signed up as "0712 345 678".
    await signUp(auth);

    for (const typed of [
      "0712345678",
      "0712 345 678",
      "+254712345678",
      "+254 712 345 678",
      "254712345678",
    ]) {
      const res = await signInByPhone(auth, typed);
      expect(res.status, typed).toBe(200);
      expect(res.cookie, typed).toContain("session_token");
    }
  });

  it("still needs the right password", async () => {
    const { auth } = makeAuth();
    await signUp(auth);
    const res = await signInByPhone(auth, "0712345678", "wrong-Password-1");
    expect(res.status).toBe(401);
    expect(res.cookie).toBe("");
  });

  it("says nothing about whether a Kenyan number has an account", async () => {
    const { auth } = makeAuth();
    await signUp(auth);
    const wrongPassword = await signInByPhone(
      auth,
      "0712345678",
      "nope-nope-1",
    );
    const noSuchNumber = await signInByPhone(auth, "0799999999", "nope-nope-1");
    expect(noSuchNumber.status).toBe(wrongPassword.status);
    expect(noSuchNumber.json?.message).toBe(wrongPassword.json?.message);
  });

  it("turns away a number from another country, whoever holds it", async () => {
    const { auth } = makeAuth();
    await signUp(auth);
    for (const typed of ["+14155550123", "+255712345678", "0212345678", ""]) {
      const res = await signInByPhone(auth, typed);
      expect(res.status, typed).toBe(400);
      expect(res.json?.message, typed).toBe(KENYAN_MOBILE_MESSAGE);
      expect(res.cookie, typed).toBe("");
    }
  });

  it("leaves signing in with an email address as it was", async () => {
    const { auth } = makeAuth();
    await signUp(auth, { email: "wanjiru@example.test" });
    const res = await send(auth, "/sign-in/email", {
      email: "wanjiru@example.test",
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.cookie).toContain("session_token");
  });
});

describe("changing the number on an account", () => {
  async function signedUp() {
    const world = makeAuth();
    const first = await signUp(world.auth, { phoneNumber: "0712345678" });
    const { internalAdapter } = await world.auth.$context;
    return {
      ...world,
      cookie: first.cookie,
      internalAdapter,
      id: world.db.user[0].id as string,
    };
  }

  it("isn't something the profile route does at all", async () => {
    // better-auth leaves a phone number to its own code-by-SMS flow, which
    // isn't switched on. This is what keeps another country's number from
    // getting in that way, so a library upgrade that changes it shows up here.
    const { auth, db, cookie } = await signedUp();
    for (const phoneNumber of ["0722 000 111", "+14155550123", ""]) {
      const res = await send(auth, "/update-user", { phoneNumber }, cookie);
      expect(res.status, phoneNumber).toBe(400);
    }
    expect(storedNumbers(db)).toEqual(["+254712345678"]);
  });

  it("keeps a new Kenyan number in the stored form, whatever changes it", async () => {
    const { db, internalAdapter, id } = await signedUp();
    await internalAdapter.updateUser(id, { phoneNumber: "0722 000 111" });
    expect(storedNumbers(db)).toEqual(["+254722000111"]);
  });

  it("refuses a number from another country, whatever changes it", async () => {
    const { db, internalAdapter, id } = await signedUp();
    await expect(
      internalAdapter.updateUser(id, { phoneNumber: "+14155550123" }),
    ).rejects.toThrow();
    expect(storedNumbers(db)).toEqual(["+254712345678"]);
  });

  it("refuses to clear the number, whatever changes it", async () => {
    const { db, internalAdapter, id } = await signedUp();
    for (const phoneNumber of ["", null]) {
      await expect(
        internalAdapter.updateUser(id, { phoneNumber }),
      ).rejects.toThrow();
    }
    expect(storedNumbers(db)).toEqual(["+254712345678"]);
  });

  it("doesn't get in the way of changing anything else", async () => {
    const { auth, db, cookie } = await signedUp();
    const res = await send(
      auth,
      "/update-user",
      { name: "Wanjiru N. Kamau" },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(db.user[0].name).toBe("Wanjiru N. Kamau");
    expect(storedNumbers(db)).toEqual(["+254712345678"]);
  });
});

describe("accounts that have no number, or an older one", () => {
  it("lets someone in with Google, who has no phone number at all", async () => {
    const { auth, db } = makeAuth();
    const { internalAdapter } = await auth.$context;
    const user = await internalAdapter.createUser({
      email: "google-person@example.test",
      name: "Google Person",
      emailVerified: true,
    });
    expect(user.id).toBeTruthy();
    expect(db.user).toHaveLength(1);
    expect(db.user[0].phoneNumber ?? null).toBeNull();
  });

  it("doesn't lock out an account saved with a number from another country", async () => {
    const { auth, db } = makeAuth();
    const made = await signUp(auth, { email: "old@example.test" });
    expect(made.status).toBe(200);
    // How it would have been stored before this rule.
    db.user[0].phoneNumber = "+14155550123";

    // Email still works, and so does changing anything but the number.
    const login = await send(auth, "/sign-in/email", {
      email: "old@example.test",
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    const renamed = await send(
      auth,
      "/update-user",
      { name: "Old Account" },
      login.cookie,
    );
    expect(renamed.status).toBe(200);
    expect(db.user[0].phoneNumber).toBe("+14155550123");

    // Signing in by that number is what is closed.
    expect((await signInByPhone(auth, "+14155550123")).status).toBe(400);
  });

  it("can't find an account whose number was saved the old way, until it is tidied", async () => {
    const { auth, db } = makeAuth();
    await signUp(auth, { email: "old@example.test" });
    // Saved as typed, before numbers were kept as +254XXXXXXXXX.
    db.user[0].phoneNumber = "0712 345 678";

    expect((await signInByPhone(auth, "0712 345 678")).status).toBe(401);

    // Tidying it (see the clean-up in phoneNumbers.ts) is what fixes that.
    db.user[0].phoneNumber = "+254712345678";
    expect((await signInByPhone(auth, "0712 345 678")).status).toBe(200);
  });
});

describe("the settings that carry the rules", () => {
  it("keep Google's linking hooks alongside the phone rules", () => {
    // Both use better-auth's hook slots: neither may replace the other.
    expect(signInRules.hooks.before).toBeDefined();
    expect(signInRules.hooks.after).toBeDefined();
    expect(signInRules.databaseHooks.user.create.before).toBeDefined();
    expect(signInRules.databaseHooks.user.update.before).toBeDefined();
    expect(signInRules.databaseHooks.account.create.before).toBeDefined();
    expect(signInRules.account.accountLinking.enabled).toBe(true);
  });
});

// The rules on their own, so each one is checked directly and not only through
// the layer in front of it (a request is tidied before the account is stored,
// which would hide a gap in the second).

describe("the request rule", () => {
  const refusal = {
    statusCode: 400,
    body: { code: "INVALID_PHONE_NUMBER", message: KENYAN_MOBILE_MESSAGE },
  };

  it("turns away a foreign or missing number at sign-up and sign-in by phone", async () => {
    for (const path of ["/sign-up/email", "/sign-in/phone-number"]) {
      for (const body of [
        { phoneNumber: "+14155550123" },
        { phoneNumber: "" },
        { phoneNumber: 712345678 }, // not even text
        { phoneNumber: null },
        {},
      ]) {
        await expect(beforeRequest({ path, body }), path).rejects.toMatchObject(
          refusal,
        );
      }
    }
    await expect(
      beforeRequest({ path: "/sign-up/email" }),
    ).rejects.toMatchObject(refusal);
  });

  it("hands on a Kenyan number in the stored form, with the rest of the request as it was", async () => {
    const body = { email: "a@example.test", phoneNumber: "0712 345 678" };
    for (const path of ["/sign-up/email", "/sign-in/phone-number"]) {
      expect(await beforeRequest({ path, body }), path).toEqual({
        context: {
          body: { email: "a@example.test", phoneNumber: "+254712345678" },
        },
      });
    }
  });

  it("holds the phone plugin's other routes to the same rule when they are given a number", async () => {
    await expect(
      beforeRequest({
        path: "/phone-number/send-otp",
        body: { phoneNumber: "+14155550123" },
      }),
    ).rejects.toMatchObject(refusal);
    expect(
      await beforeRequest({
        path: "/phone-number/verify",
        body: { phoneNumber: "0712345678", code: "123456" },
      }),
    ).toEqual({
      context: { body: { phoneNumber: "+254712345678", code: "123456" } },
    });
  });

  it("leaves alone requests that aren't about a number", async () => {
    expect(
      await beforeRequest({ path: "/phone-number/verify", body: {} }),
    ).toBeUndefined();
    expect(
      await beforeRequest({ path: "/phone-number/verify" }),
    ).toBeUndefined();
    for (const path of [
      "/sign-in/email",
      "/update-user",
      "/sign-out",
      "/sign-in/social",
    ]) {
      expect(
        await beforeRequest({ path, body: { phoneNumber: "+14155550123" } }),
        path,
      ).toBeUndefined();
    }
    expect(await beforeRequest({})).toBeUndefined();
  });
});

describe("the rule when an account is stored", () => {
  const refusal = {
    statusCode: 400,
    body: { code: "INVALID_PHONE_NUMBER", message: KENYAN_MOBILE_MESSAGE },
  };
  const asking = (holder: unknown) => {
    const looked: unknown[] = [];
    return {
      looked,
      ctx: {
        context: {
          adapter: {
            findOne: async (query: unknown) => {
              looked.push(query);
              return holder as never;
            },
          },
        },
      },
    };
  };

  it("lets through an account with no number at all, which is what Google sign-in makes", async () => {
    const { ctx, looked } = asking({ id: "someone" });
    for (const phoneNumber of [undefined, null]) {
      expect(
        await beforeUserCreated({ name: "G", phoneNumber }, ctx),
        String(phoneNumber),
      ).toBeUndefined();
    }
    expect(await beforeUserCreated({ name: "G" }, ctx)).toBeUndefined();
    expect(looked).toEqual([]);
  });

  it("turns away a number that isn't a Kenyan mobile, or isn't text", async () => {
    const { ctx } = asking(null);
    for (const phoneNumber of [
      "+14155550123",
      "",
      "0212345678",
      712345678,
      false,
    ]) {
      await expect(
        beforeUserCreated({ name: "G", phoneNumber }, ctx),
        String(phoneNumber),
      ).rejects.toMatchObject(refusal);
    }
  });

  it("stores a Kenyan number in the stored form, with the rest of the account as it was", async () => {
    const { ctx } = asking(null);
    expect(
      await beforeUserCreated(
        { name: "W", email: "w@example.test", phoneNumber: "0712 345 678" },
        ctx,
      ),
    ).toEqual({
      data: {
        name: "W",
        email: "w@example.test",
        phoneNumber: "+254712345678",
      },
    });
  });

  it("tells someone signing up that the number is already used, whichever way they typed it", async () => {
    const { ctx, looked } = asking({ id: "holder" });
    await expect(
      beforeUserCreated({ name: "W", phoneNumber: "0712 345 678" }, ctx),
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "PHONE_NUMBER_TAKEN", message: PHONE_TAKEN_MESSAGE },
    });
    // It looked for the number as it is stored, on the account's number.
    expect(looked).toEqual([
      {
        model: "user",
        where: [{ field: "phoneNumber", value: "+254712345678" }],
      },
    ]);
  });

  it("has nobody to tell outside a request, and leaves a duplicate to the database", async () => {
    expect(
      await beforeUserCreated({ name: "W", phoneNumber: "0712345678" }, null),
    ).toEqual({ data: { name: "W", phoneNumber: "+254712345678" } });
    await expect(
      beforeUserCreated({ name: "W", phoneNumber: "+14155550123" }, null),
    ).rejects.toMatchObject(refusal);
  });

  it("applies whichever way an account is made", async () => {
    const { auth, db } = makeAuth();
    const { internalAdapter } = await auth.$context;
    await expect(
      internalAdapter.createUser({
        email: "us@example.test",
        name: "Overseas",
        emailVerified: true,
        phoneNumber: "+14155550123",
      }),
    ).rejects.toThrow();
    expect(db.user).toHaveLength(0);

    await internalAdapter.createUser({
      email: "ke@example.test",
      name: "Wanjiru",
      emailVerified: true,
      phoneNumber: "0712 345 678",
    });
    expect(storedNumbers(db)).toEqual(["+254712345678"]);
  });
});

describe("the rule when an account's details are changed", () => {
  const refusal = {
    statusCode: 400,
    body: { code: "INVALID_PHONE_NUMBER", message: KENYAN_MOBILE_MESSAGE },
  };

  it("has nothing to check when the number isn't being changed", async () => {
    expect(await beforeUserUpdated({ name: "New name" })).toBeUndefined();
    expect(await beforeUserUpdated({})).toBeUndefined();
    // A change that mentions the number without giving one is not a change to it.
    expect(
      await beforeUserUpdated({ name: "New name", phoneNumber: undefined }),
    ).toBeUndefined();
  });

  it("keeps a new Kenyan number in the stored form, with the rest of the change as it was", async () => {
    expect(
      await beforeUserUpdated({
        name: "New name",
        phoneNumber: "0722 000 111",
      }),
    ).toEqual({
      data: { name: "New name", phoneNumber: "+254722000111" },
    });
  });

  it("refuses a number that isn't a Kenyan mobile, isn't text, or is empty", async () => {
    for (const phoneNumber of [
      "+14155550123",
      "0212345678",
      "",
      null,
      254712345678,
      false,
    ]) {
      await expect(
        beforeUserUpdated({ phoneNumber }),
        String(phoneNumber),
      ).rejects.toMatchObject(refusal);
    }
  });
});

describe("the real sign-in setup", () => {
  // These tests build their own better-auth from `signInRules`. That only
  // means something if the real one is built from it too.
  const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");

  it("uses the same rules as these tests", () => {
    expect(source).toContain("...signInRules");
  });

  it("has no hooks of its own that could replace them", () => {
    expect(source).not.toMatch(/databaseHooks/);
    expect(source).not.toMatch(/\bhooks:/);
  });

  it("doesn't switch the phone plugin's one-time-code sign-in on", () => {
    // Codes by SMS would be a second way to put a number on an account.
    expect(source).toMatch(/phoneNumber\(\)/);
    expect(source).not.toMatch(/sendOTP/);
  });
});
