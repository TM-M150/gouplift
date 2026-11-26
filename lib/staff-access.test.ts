import { describe, expect, it } from "vitest";
import {
  emailDomain,
  STAFF_BLOCK_MESSAGES,
  staffAccessBlock,
  staffEmailRule,
} from "./staff-access";

describe("staffEmailRule", () => {
  it("is off when the setting is empty or missing", () => {
    for (const raw of [undefined, null, "", "   ", "\n"]) {
      expect(staffEmailRule(raw)).toEqual({ enforced: false, domains: [] });
    }
  });

  it("reads one domain", () => {
    expect(staffEmailRule("gouplift.co.ke")).toEqual({
      enforced: true,
      domains: ["gouplift.co.ke"],
    });
  });

  it("reads several, separated by commas, spaces or semicolons", () => {
    const expected = {
      enforced: true,
      domains: ["gouplift.co.ke", "gouplift.africa"],
    };
    expect(staffEmailRule("gouplift.co.ke,gouplift.africa")).toEqual(expected);
    expect(staffEmailRule("gouplift.co.ke, gouplift.africa")).toEqual(expected);
    expect(staffEmailRule("gouplift.co.ke gouplift.africa")).toEqual(expected);
    expect(staffEmailRule("gouplift.co.ke;gouplift.africa;")).toEqual(expected);
  });

  it("ignores case, a leading @ and repeats", () => {
    expect(staffEmailRule("@GoUplift.CO.KE, gouplift.co.ke")).toEqual({
      enforced: true,
      domains: ["gouplift.co.ke"],
    });
  });

  // A typo must not switch the protection off. It switches it on with nobody
  // allowed, which is noticed at once and fixed by correcting the setting.
  it.each([
    "gouplift",
    "*.gouplift.co.ke",
    "https://gouplift.co.ke",
    "staff@gouplift.co.ke",
    "gouplift..co.ke",
    "-gouplift.co.ke",
    ",",
  ])("is on, with nothing allowed, for an unusable setting: %s", (raw) => {
    expect(staffEmailRule(raw)).toEqual({ enforced: true, domains: [] });
  });

  it("keeps the usable domains when another entry is a typo", () => {
    expect(staffEmailRule("gouplift, gouplift.co.ke")).toEqual({
      enforced: true,
      domains: ["gouplift.co.ke"],
    });
  });
});

describe("emailDomain", () => {
  it("is the part after the @, in lower case", () => {
    expect(emailDomain("Tommy@GoUplift.co.ke")).toBe("gouplift.co.ke");
    expect(emailDomain("  tommy@gouplift.co.ke ")).toBe("gouplift.co.ke");
  });

  it.each([
    undefined,
    null,
    "",
    "no-at-sign",
    "@gouplift.co.ke",
    "a@",
    "a@b@c.com",
  ])("is nothing for %s", (email) => {
    expect(emailDomain(email)).toBeNull();
  });
});

describe("staffAccessBlock", () => {
  const off = staffEmailRule(undefined);
  const company = staffEmailRule("gouplift.co.ke");

  it("lets a confirmed address through while the company-domain rule is off", () => {
    expect(
      staffAccessBlock({
        email: "tommy@gmail.com",
        emailConfirmed: true,
        rule: off,
      }),
    ).toBeNull();
  });

  it("blocks an unconfirmed address, even with the rule off", () => {
    expect(
      staffAccessBlock({
        email: "tommy@gmail.com",
        emailConfirmed: false,
        rule: off,
      }),
    ).toBe("EMAIL_NOT_CONFIRMED");
  });

  it("lets a confirmed company address through when the rule is on", () => {
    expect(
      staffAccessBlock({
        email: "Tommy@Gouplift.co.ke",
        emailConfirmed: true,
        rule: company,
      }),
    ).toBeNull();
  });

  it("blocks another domain when the rule is on, confirmed or not", () => {
    for (const emailConfirmed of [true, false]) {
      expect(
        staffAccessBlock({
          email: "tommy@gmail.com",
          emailConfirmed,
          rule: company,
        }),
      ).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
    }
  });

  it("blocks an unconfirmed company address", () => {
    expect(
      staffAccessBlock({
        email: "tommy@gouplift.co.ke",
        emailConfirmed: false,
        rule: company,
      }),
    ).toBe("EMAIL_NOT_CONFIRMED");
  });

  // Only the exact domain counts.
  it.each([
    "tommy@mail.gouplift.co.ke",
    "tommy@gouplift.co.ke.example.com",
    "tommy@notgouplift.co.ke",
    "tommy@gouplift.co.ke@example.com",
    "gouplift.co.ke",
    "",
  ])("does not accept a look-alike: %s", (email) => {
    expect(
      staffAccessBlock({ email, emailConfirmed: true, rule: company }),
    ).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
  });

  it("blocks everyone when the rule is on but holds no usable domain", () => {
    expect(
      staffAccessBlock({
        email: "tommy@gouplift.co.ke",
        emailConfirmed: true,
        rule: staffEmailRule("gouplift"),
      }),
    ).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
  });

  it("allows any of several domains", () => {
    const both = staffEmailRule("gouplift.co.ke, gouplift.africa");
    for (const email of ["a@gouplift.co.ke", "b@gouplift.africa"]) {
      expect(
        staffAccessBlock({ email, emailConfirmed: true, rule: both }),
      ).toBeNull();
    }
  });

  it("has a message for every reason", () => {
    expect(STAFF_BLOCK_MESSAGES.EMAIL_NOT_CONFIRMED).toMatch(/confirm/i);
    expect(STAFF_BLOCK_MESSAGES.EMAIL_DOMAIN_NOT_ALLOWED).toMatch(/company/i);
  });
});
