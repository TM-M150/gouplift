import { describe, expect, it } from "vitest";
import { signInErrorNotice } from "../lib/sign-in-errors";
import { signInHref } from "../lib/safe-redirect";

describe("coming back to sign-in without an error", () => {
  it("shows nothing for an ordinary visit", () => {
    expect(signInErrorNotice(null)).toBeNull();
    expect(signInErrorNotice(undefined)).toBeNull();
    expect(signInErrorNotice("")).toBeNull();
    expect(signInErrorNotice("   ")).toBeNull();
  });
});

describe("an email that already has a GoUplift account", () => {
  const notice = signInErrorNotice("account_not_linked");

  it("says so plainly, as a problem to fix", () => {
    expect(notice?.tone).toBe("error");
    expect(notice?.title).toBe(
      "You already have a GoUplift account with this email",
    );
  });

  it("says how to get in, and how to use Google afterwards", () => {
    expect(notice?.message).toMatch(/email and password/);
    expect(notice?.message).toMatch(/Settings/);
    expect(notice?.message).toMatch(/Sign-in methods/);
  });

  it("points at the way back for someone who forgot the password", () => {
    expect(notice?.message).toMatch(/Forgot password/);
  });

  it("is the same whatever case the code comes in", () => {
    expect(signInErrorNotice("ACCOUNT_NOT_LINKED")).toEqual(notice);
    expect(signInErrorNotice(" account_not_linked ")).toEqual(notice);
  });
});

describe("cancelling on Google's screen", () => {
  const notice = signInErrorNotice("access_denied");

  it("is not presented as a failure", () => {
    expect(notice?.tone).toBe("info");
  });

  it("says nothing was changed and offers another way in", () => {
    expect(notice?.title).toBe("You cancelled signing in with Google");
    expect(notice?.message).toMatch(/Nothing was changed/);
    expect(notice?.message).toMatch(/email or phone number/);
  });
});

describe("a sign-in that was started in one place and finished in another", () => {
  it("gives the same answer for each way better-auth can say it", () => {
    const expected = signInErrorNotice("state_mismatch");
    expect(expected?.tone).toBe("error");
    expect(expected?.message).toMatch(/different browser or app/);
    expect(expected?.message).toMatch(/try again/);
    expect(signInErrorNotice("state_not_found")).toEqual(expected);
    expect(signInErrorNotice("state_invalid")).toEqual(expected);
  });
});

describe("Google not giving an email address", () => {
  it("says why that matters and offers another way in", () => {
    const notice = signInErrorNotice("email_not_found");
    expect(notice?.tone).toBe("error");
    expect(notice?.title).toMatch(/email address/);
    expect(notice?.message).toMatch(/email or phone number/);
  });
});

describe("any other error", () => {
  it("gets a plain message that says to try again", () => {
    for (const code of [
      "invalid_code",
      "no_code",
      "unable_to_get_user_info",
      "unable_to_create_user",
      "signup_disabled",
      "internal_server_error",
    ]) {
      const notice = signInErrorNotice(code);
      expect(notice?.tone, code).toBe("error");
      expect(notice?.title, code).toBe("We couldn't sign you in with Google");
      expect(notice?.message, code).toMatch(/try again/);
    }
  });

  it("never shows what is in the address", () => {
    // Anyone can put anything in an address, so only our own words are shown.
    const hostile = [
      "<script>alert(1)</script>",
      "Your account has been suspended. Call 0700 000 000 to unlock it",
      "https://evil.test/login",
    ];
    for (const code of hostile) {
      const notice = signInErrorNotice(code);
      const text = `${notice?.title} ${notice?.message}`;
      expect(text).not.toContain(code);
      expect(text).not.toMatch(/script|suspended|evil\.test|0700/);
      expect(notice?.title).toBe("We couldn't sign you in with Google");
    }
  });
});

describe("every notice", () => {
  const codes = [
    "account_not_linked",
    "access_denied",
    "state_mismatch",
    "email_not_found",
    "anything_else",
  ];

  it("has a title and a message, and tells the person what to do next", () => {
    for (const code of codes) {
      const notice = signInErrorNotice(code);
      expect(notice?.title.length, code).toBeGreaterThan(0);
      expect(notice?.message.length, code).toBeGreaterThan(0);
      expect(notice?.message, code).toMatch(/sign in|try again|Sign-in/i);
    }
  });

  it("is red only when something went wrong", () => {
    for (const code of codes) {
      const expected = code === "access_denied" ? "info" : "error";
      expect(signInErrorNotice(code)?.tone, code).toBe(expected);
    }
  });
});

describe("the address Google errors come back to", () => {
  // The sign-in and sign-up pages ask better-auth to send errors to this
  // address, so the person lands back on a page that carries on where they were.
  it("is the sign-in page, keeping where they were going", () => {
    expect(signInHref(null)).toBe("/sign-in");
    expect(signInHref("/fundraiser/k17abc")).toBe(
      "/sign-in?next=%2Ffundraiser%2Fk17abc",
    );
  });

  it("will not carry an address that leaves the site", () => {
    expect(signInHref("https://evil.test/")).toBe("/sign-in");
    expect(signInHref("//evil.test/")).toBe("/sign-in");
  });
});
