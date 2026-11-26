/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { canViewFundraiser } from "./lib/fundraiserAccess";
import {
  activeStaffRole,
  getAdminUser,
  getStaffUser,
  requireAdmin,
  requireStaff,
} from "./lib/staff";
import { insertPayout, seedPayoutWorld, type T } from "./payouts.fixtures";

// Who may use a staff role. A role is granted by hand, and holding it is not
// enough: the account's email must be confirmed, and, once STAFF_EMAIL_DOMAINS
// is set, be on a company domain (lib/staff-access.ts has the rules). These
// tests check that the server applies them everywhere it decides "is this
// person staff?", including the places that used to read the role directly,
// and that roles can only be given to an account that could use them.

// The real auth component needs a running Better Auth deployment. Everyone's
// account is confirmed and has the address on their profile row unless a test
// says otherwise. `emailOf` gives an account a different address (what the
// sign-in service holds) and `noRecord` removes it altogether.
const unconfirmed = vi.hoisted(() => new Set<string>());
const emailOf = vi.hoisted(() => new Map<string, string>());
const noRecord = vi.hoisted(() => new Set<string>());
vi.mock("./auth", () => ({
  authComponent: {
    safeGetAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
    }) => {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity || noRecord.has(identity.subject)) return null;
      return {
        _id: identity.subject,
        email: emailOf.get(identity.subject),
        emailVerified: !unconfirmed.has(identity.subject),
      };
    },
    getAnyUserById: async (_ctx: unknown, id: string) =>
      noRecord.has(id)
        ? null
        : {
            _id: id,
            email: emailOf.get(id),
            emailVerified: !unconfirmed.has(id),
          },
  },
}));

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  unconfirmed.clear();
  emailOf.clear();
  noRecord.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// The world's people have addresses like auth_admin@example.test.
const COMPANY = "example.test";

async function setup() {
  return await seedPayoutWorld(convexTest(schema, modules));
}
type World = Awaited<ReturnType<typeof setup>>;

const NOT_ALLOWED = /You don't have permission to do that\./;
const CONFIRM = /Confirm your email address/;
const COMPANY_ONLY = /GoUplift company email address/;

// ---- Confirmed email --------------------------------------------------

describe("a staff role needs a confirmed email", () => {
  it("lets a confirmed admin and a confirmed moderator in", async () => {
    const w = await setup();
    const admin = await w.asAdmin.run((ctx) => requireAdmin(ctx));
    expect(admin._id).toBe(w.ids.admin);
    expect((await w.asAdmin.run((ctx) => requireStaff(ctx)))._id).toBe(
      w.ids.admin,
    );
    expect((await w.asModerator.run((ctx) => requireStaff(ctx)))._id).toBe(
      w.ids.moderator,
    );
    expect(await w.asAdmin.run((ctx) => getStaffUser(ctx))).not.toBeNull();
    expect(await w.asAdmin.run((ctx) => getAdminUser(ctx))).not.toBeNull();
  });

  it("keeps a moderator out of admin-only things, as before", async () => {
    const w = await setup();
    await expect(w.asModerator.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      NOT_ALLOWED,
    );
    expect(await w.asModerator.run((ctx) => getAdminUser(ctx))).toBeNull();
    expect(await w.asModerator.run((ctx) => getStaffUser(ctx))).not.toBeNull();
  });

  it("turns an admin with an unconfirmed email away, and says why", async () => {
    const w = await setup();
    unconfirmed.add("auth_admin");
    await expect(w.asAdmin.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      CONFIRM,
    );
    await expect(w.asAdmin.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      CONFIRM,
    );
    expect(await w.asAdmin.run((ctx) => getStaffUser(ctx))).toBeNull();
    expect(await w.asAdmin.run((ctx) => getAdminUser(ctx))).toBeNull();
    expect(
      await w.asAdmin.run(async (ctx) =>
        activeStaffRole(ctx, (await ctx.db.get(w.ids.admin))!),
      ),
    ).toBeNull();
  });

  it("turns an unconfirmed moderator away too", async () => {
    const w = await setup();
    unconfirmed.add("auth_mod");
    await expect(w.asModerator.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      CONFIRM,
    );
    expect(await w.asModerator.run((ctx) => getStaffUser(ctx))).toBeNull();
  });

  it("treats a signed-in account the sign-in service has no record of as unconfirmed", async () => {
    const w = await setup();
    noRecord.add("auth_admin");
    // With no record the person isn't signed in at all.
    await expect(w.asAdmin.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      /signed in/,
    );
  });

  // Someone without a role must not learn anything from the refusal.
  it("gives an ordinary user the plain refusal, confirmed or not", async () => {
    const w = await setup();
    await expect(w.asStranger.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      NOT_ALLOWED,
    );
    unconfirmed.add("auth_stranger");
    for (const check of [requireStaff, requireAdmin]) {
      const error = await w.asStranger.run((ctx) => check(ctx)).catch((e) => e);
      expect(String(error)).toMatch(NOT_ALLOWED);
      expect(String(error)).not.toMatch(CONFIRM);
    }
  });

  it("says 'sign in' to someone signed out", async () => {
    const w = await setup();
    await expect(w.t.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      /You must be signed in\./,
    );
    await expect(w.t.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      NOT_ALLOWED,
    );
  });
});

// ---- The company-domain rule -----------------------------------------

describe("the company-domain rule", () => {
  it("is off until STAFF_EMAIL_DOMAINS is set", async () => {
    const w = await setup();
    emailOf.set("auth_admin", "tommy@gmail.com");
    await expect(
      w.asAdmin.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();
  });

  it("lets a confirmed company address in and keeps a personal one out", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", COMPANY);
    await expect(
      w.asAdmin.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();

    emailOf.set("auth_admin", "tommy@gmail.com");
    await expect(w.asAdmin.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
    await expect(w.asAdmin.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
    expect(await w.asAdmin.run((ctx) => getStaffUser(ctx))).toBeNull();
  });

  it("ignores case and accepts any listed domain", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", `other.test, ${COMPANY.toUpperCase()}`);
    emailOf.set("auth_admin", "Tommy@EXAMPLE.test");
    await expect(
      w.asAdmin.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();
    emailOf.set("auth_admin", "tommy@other.test");
    await expect(
      w.asAdmin.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();
  });

  it.each([
    "tommy@mail.example.test",
    "tommy@example.test.evil.com",
    "tommy@notexample.test",
    "tommy@example.test@evil.com",
  ])("does not accept a look-alike domain: %s", async (address) => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", COMPANY);
    emailOf.set("auth_admin", address);
    await expect(w.asAdmin.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
  });

  it("takes effect as soon as the setting changes", async () => {
    const w = await setup();
    emailOf.set("auth_admin", "tommy@gmail.com");
    await expect(
      w.asAdmin.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", COMPANY);
    await expect(w.asAdmin.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
    vi.stubEnv("STAFF_EMAIL_DOMAINS", "");
    await expect(
      w.asAdmin.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();
  });

  // A typo must not quietly switch the protection off.
  it("blocks everyone, rather than switching off, when the setting is a typo", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", "example");
    await expect(w.asAdmin.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
    await expect(w.asModerator.run((ctx) => requireStaff(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
  });

  it("reports the domain problem before the confirmation one", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", COMPANY);
    emailOf.set("auth_admin", "tommy@gmail.com");
    unconfirmed.add("auth_admin");
    await expect(w.asAdmin.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      COMPANY_ONLY,
    );
  });
});

// ---- What the admin area is told -------------------------------------

describe("getStaffAccess", () => {
  it("says allowed, with the name, to a staff member who may come in", async () => {
    const w = await setup();
    expect(await w.asAdmin.query(api.admin.getStaffAccess, {})).toEqual({
      state: "ALLOWED",
      role: "ADMIN",
      name: "auth_admin",
    });
    expect(await w.asModerator.query(api.admin.getStaffAccess, {})).toEqual({
      state: "ALLOWED",
      role: "MODERATOR",
      name: "auth_mod",
    });
  });

  it("says blocked, with the reason in words, to one who may not", async () => {
    const w = await setup();
    unconfirmed.add("auth_admin");
    const unconfirmedAnswer = await w.asAdmin.query(
      api.admin.getStaffAccess,
      {},
    );
    expect(unconfirmedAnswer).toMatchObject({
      state: "BLOCKED",
      role: "ADMIN",
      block: "EMAIL_NOT_CONFIRMED",
    });
    expect((unconfirmedAnswer as { message: string }).message).toMatch(CONFIRM);

    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    const domainAnswer = await w.asModerator.query(
      api.admin.getStaffAccess,
      {},
    );
    expect(domainAnswer).toMatchObject({
      state: "BLOCKED",
      role: "MODERATOR",
      block: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
    expect((domainAnswer as { message: string }).message).toMatch(COMPANY_ONLY);
  });

  it("says not staff to everyone else, and tells them nothing more", async () => {
    const w = await setup();
    unconfirmed.add("auth_stranger");
    expect(await w.asStranger.query(api.admin.getStaffAccess, {})).toEqual({
      state: "NOT_STAFF",
    });
    expect(await w.t.query(api.admin.getStaffAccess, {})).toEqual({
      state: "NOT_STAFF",
    });
  });
});

// ---- Places that used to read the role directly ----------------------

describe("everything that asks 'is this person staff?' obeys the rules", () => {
  /** The fundraiser, taken off the public site so only its creator and staff can see it. */
  async function hide(w: World) {
    await w.t.run((ctx) =>
      ctx.db.patch(w.ids.fundraiser, { status: "PENDING_REVIEW" }),
    );
  }
  const canSee = (w: World, as: typeof w.asAdmin) =>
    as.run(async (ctx) =>
      canViewFundraiser(ctx, (await ctx.db.get(w.ids.fundraiser))!),
    );

  it("lets only staff who may come in see a fundraiser that isn't public", async () => {
    const w = await setup();
    await hide(w);
    expect(await canSee(w, w.asAdmin)).toBe(true);
    expect(await canSee(w, w.asModerator)).toBe(true);
    expect(await canSee(w, w.asOwner)).toBe(true);
    expect(await canSee(w, w.asStranger)).toBe(false);

    unconfirmed.add("auth_admin");
    expect(await canSee(w, w.asAdmin)).toBe(false);

    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    expect(await canSee(w, w.asModerator)).toBe(false);
    // The owner is not staff and is not affected.
    expect(await canSee(w, w.asOwner)).toBe(true);
  });

  it("shows donors' contact details for refunds only to an admin who may come in", async () => {
    const w = await setup();
    const ask = (as: typeof w.asAdmin) =>
      as.query(api.refunds.listDonationsForRefund, {
        fundraiser: w.ids.fundraiser,
      });
    expect(await ask(w.asAdmin)).not.toBeNull();
    expect(await ask(w.asModerator)).toBeNull();

    unconfirmed.add("auth_admin");
    expect(await ask(w.asAdmin)).toBeNull();
    unconfirmed.delete("auth_admin");

    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    expect(await ask(w.asAdmin)).toBeNull();
  });

  it("shows payout details only to an admin who may come in", async () => {
    const w = await setup();
    const payoutId = await insertPayout(w.t, w, {
      amount: 1000,
      status: "REQUESTED",
    });
    const queue = (as: typeof w.asAdmin) =>
      as.query(api.payouts.listPayoutsForStaff, { status: "REQUESTED" });
    const one = (as: typeof w.asAdmin) =>
      as.query(api.payouts.getPayoutForStaff, { payoutId });

    expect(await queue(w.asAdmin)).toHaveLength(1);
    expect(await one(w.asAdmin)).not.toBeNull();

    unconfirmed.add("auth_admin");
    expect(await queue(w.asAdmin)).toEqual([]);
    expect(await one(w.asAdmin)).toBeNull();
    unconfirmed.delete("auth_admin");

    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    expect(await queue(w.asAdmin)).toEqual([]);
    expect(await one(w.asAdmin)).toBeNull();
  });

  it("does not cost an ordinary visitor a look-up of their sign-in record", async () => {
    // A person with no staff role is turned away before anything else is read.
    const w = await setup();
    noRecord.add("auth_stranger");
    const stranger = await w.t.run(async (ctx) => ctx.db.get(w.ids.stranger));
    expect(
      await w.asStranger.run((ctx) => activeStaffRole(ctx, stranger!)),
    ).toBeNull();
  });
});

// ---- Giving and taking away a role ----------------------------------

describe("setUserRole", () => {
  const STRANGER = "auth_stranger@example.test";
  const grant = (
    w: World,
    role: "USER" | "MODERATOR" | "ADMIN",
    email = STRANGER,
  ) => w.t.mutation(internal.admin.setUserRole, { email, role });
  const roleOf = async (w: World, id: Id<"users">) =>
    (await w.t.run((ctx) => ctx.db.get(id)))!.role;
  const changes = (w: World) =>
    w.t.run((ctx) => ctx.db.query("staffRoleChanges").collect());
  const alerts = (w: World) =>
    w.t.run((ctx) => ctx.db.query("systemAlerts").collect());

  it("gives a role to a confirmed account, and records it", async () => {
    const w = await setup();
    expect(await grant(w, "ADMIN")).toEqual({
      email: STRANGER,
      role: "ADMIN",
      changed: true,
    });
    expect(await roleOf(w, w.ids.stranger)).toBe("ADMIN");

    expect(await changes(w)).toEqual([
      expect.objectContaining({
        userId: w.ids.stranger,
        email: STRANGER,
        roleBefore: "USER",
        roleAfter: "ADMIN",
        emailConfirmed: true,
        changedAt: expect.any(Number),
      }),
    ]);
    expect(await alerts(w)).toEqual([
      expect.objectContaining({
        kind: "STAFF_ROLE_CHANGED",
        status: "OPEN",
        reference: w.ids.stranger,
        detail: "auth_stranger: USER to ADMIN",
      }),
    ]);
  });

  it("records the role the person had before", async () => {
    const w = await setup();
    await grant(w, "ADMIN", "auth_mod@example.test");
    expect(await changes(w)).toEqual([
      expect.objectContaining({ roleBefore: "MODERATOR", roleAfter: "ADMIN" }),
    ]);
  });

  it("refuses an account whose email isn't confirmed, and changes nothing", async () => {
    const w = await setup();
    unconfirmed.add("auth_stranger");
    for (const role of ["MODERATOR", "ADMIN"] as const) {
      await expect(grant(w, role)).rejects.toThrow(/isn't confirmed yet/);
    }
    expect(await roleOf(w, w.ids.stranger)).toBe("USER");
    expect(await changes(w)).toEqual([]);
    expect(await alerts(w)).toEqual([]);
  });

  it("refuses an account the sign-in service has no record of", async () => {
    const w = await setup();
    noRecord.add("auth_stranger");
    await expect(grant(w, "ADMIN")).rejects.toThrow(/isn't confirmed yet/);
    expect(await roleOf(w, w.ids.stranger)).toBe("USER");
  });

  it("refuses a personal address once the company-domain rule is on, and names the domain", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    await expect(grant(w, "ADMIN")).rejects.toThrow(
      /only allows addresses at gouplift\.co\.ke/,
    );
    expect(await roleOf(w, w.ids.stranger)).toBe("USER");
    expect(await changes(w)).toEqual([]);
  });

  it("gives a role to a company address once the rule is on", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", COMPANY);
    expect((await grant(w, "MODERATOR")).changed).toBe(true);
    expect(await roleOf(w, w.ids.stranger)).toBe("MODERATOR");
  });

  it("explains a setting with no usable domain", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift");
    await expect(grant(w, "ADMIN")).rejects.toThrow(/holds no usable domain/);
  });

  // Whoever is leaving must always be removable.
  it("always lets a role be taken away, even from an unconfirmed or off-domain account", async () => {
    const w = await setup();
    unconfirmed.add("auth_admin2");
    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    const result = await grant(w, "USER", "auth_admin2@example.test");
    expect(result).toEqual({
      email: "auth_admin2@example.test",
      role: "USER",
      changed: true,
    });
    expect(await roleOf(w, w.ids.admin2)).toBe("USER");
    expect(await changes(w)).toEqual([
      expect.objectContaining({
        roleBefore: "ADMIN",
        roleAfter: "USER",
        emailConfirmed: false,
      }),
    ]);
  });

  it("does nothing, and records nothing, when the role is already that", async () => {
    const w = await setup();
    expect(await grant(w, "ADMIN", "auth_admin@example.test")).toEqual({
      email: "auth_admin@example.test",
      role: "ADMIN",
      changed: false,
    });
    expect(await changes(w)).toEqual([]);
    expect(await alerts(w)).toEqual([]);
  });

  it("finds the person whatever the case or spacing of the address", async () => {
    const w = await setup();
    const result = await grant(w, "MODERATOR", "  Auth_Stranger@Example.TEST ");
    expect(result.email).toBe(STRANGER);
    expect(await roleOf(w, w.ids.stranger)).toBe("MODERATOR");
  });

  it("says so when there is no such person", async () => {
    const w = await setup();
    await expect(grant(w, "ADMIN", "nobody@example.test")).rejects.toThrow(
      /No user found/,
    );
  });

  // `api` answers for any name at run time, so this is checked by the compiler:
  // each line below stops compiling (and `tsc` fails) the day one of these
  // becomes a public function that a browser could call.
  it("can't be called by anyone from outside", () => {
    // @ts-expect-error setUserRole is an internalMutation, not on `api`
    void api.admin.setUserRole;
    // @ts-expect-error listStaff is an internalQuery, not on `api`
    void api.admin.listStaff;
    // They are on `internal`, which only our own code and the command line use.
    void internal.admin.setUserRole;
    void internal.admin.listStaff;
  });
});

// ---- Checking the staff before changing the rule ---------------------

describe("listStaff", () => {
  const list = (w: World, domains?: string) =>
    w.t.query(internal.admin.listStaff, domains ? { domains } : {});

  it("lists admins and moderators, not ordinary users", async () => {
    const w = await setup();
    const result = await list(w);
    expect(result.truncated).toBe(false);
    expect(result.staff.map((s) => [s.name, s.role]).sort()).toEqual([
      ["auth_admin", "ADMIN"],
      ["auth_admin2", "ADMIN"],
      ["auth_mod", "MODERATOR"],
    ]);
    expect(result.rule).toEqual({ enforced: false, domains: [] });
    expect(result.staff.every((s) => s.access === "OK")).toBe(true);
    expect(result.anAdminCanStillSignIn).toBe(true);
  });

  it("shows who is unconfirmed", async () => {
    const w = await setup();
    unconfirmed.add("auth_mod");
    const mod = (await list(w)).staff.find((s) => s.name === "auth_mod");
    expect(mod).toMatchObject({
      emailConfirmed: false,
      access: "EMAIL_NOT_CONFIRMED",
      email: "auth_mod@example.test",
    });
  });

  it("shows who a setting would lock out, without applying it", async () => {
    const w = await setup();
    emailOf.set("auth_admin2", "someone@gmail.com");

    const trial = await list(w, COMPANY);
    expect(trial.rule).toEqual({ enforced: true, domains: [COMPANY] });
    const byName = Object.fromEntries(
      trial.staff.map((s) => [s.name, s.access]),
    );
    expect(byName).toEqual({
      auth_admin: "OK",
      auth_admin2: "EMAIL_DOMAIN_NOT_ALLOWED",
      auth_mod: "OK",
    });
    expect(trial.anAdminCanStillSignIn).toBe(true);

    // Nothing was actually switched on.
    await expect(
      w.asAdmin2.run((ctx) => requireAdmin(ctx)),
    ).resolves.toBeDefined();
  });

  it("warns when a setting would leave no admin able to sign in", async () => {
    const w = await setup();
    const trial = await list(w, "gouplift.co.ke");
    expect(trial.staff.filter((s) => s.role === "ADMIN")).toHaveLength(2);
    expect(trial.anAdminCanStillSignIn).toBe(false);
  });

  it("uses the setting in force when no trial value is given", async () => {
    const w = await setup();
    vi.stubEnv("STAFF_EMAIL_DOMAINS", "gouplift.co.ke");
    const result = await list(w);
    expect(result.rule.enforced).toBe(true);
    expect(result.anAdminCanStillSignIn).toBe(false);
  });

  it("says when each person's role last changed", async () => {
    const w = await setup();
    await w.t.mutation(internal.admin.setUserRole, {
      email: "auth_mod@example.test",
      role: "MODERATOR",
    });
    await w.t.mutation(internal.admin.setUserRole, {
      email: "auth_stranger@example.test",
      role: "MODERATOR",
    });
    const staff = (await list(w)).staff;
    expect(
      staff.find((s) => s.name === "auth_stranger")?.lastChangedAt,
    ).toEqual(expect.any(Number));
    // Roles set before changes were recorded have no date.
    expect(
      staff.find((s) => s.name === "auth_admin")?.lastChangedAt,
    ).toBeNull();
  });

  it("says when there are more staff than it lists", async () => {
    const w = await setup();
    await w.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 51; i++) {
        await ctx.db.insert("users", {
          authUserId: `auth_extra_${i}`,
          email: `extra${i}@example.test`,
          displayName: `Extra ${i}`,
          role: "MODERATOR",
          isPrivate: false,
          isVerified: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await list(w);
    expect(result.truncated).toBe(true);
    expect(result.staff.filter((s) => s.role === "MODERATOR")).toHaveLength(50);
  });

  it("reports an empty team plainly", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.admin.listStaff, {})).toEqual({
      rule: { enforced: false, domains: [] },
      anAdminCanStillSignIn: false,
      truncated: false,
      staff: [],
    });
  });
});

// Keeps the T import honest for helpers shared with the fixtures.
export type { T };
