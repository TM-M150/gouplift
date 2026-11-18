import { describe, expect, it } from "vitest";
import {
  AUTH_NOTICE_COOKIE,
  GOOGLE_LINKED_NOTICE,
  authNoticeFromCookies,
  clearAuthNoticeCookie,
} from "../lib/auth-notices";

describe("the note left for the next page", () => {
  it("says Google is connected, what changed, and how to get a password back", () => {
    const notice = authNoticeFromCookies(
      `${AUTH_NOTICE_COOKIE}=${GOOGLE_LINKED_NOTICE}`,
    );
    expect(notice?.title).toBe("Google is now connected");
    expect(notice?.message).toMatch(/sign in with Google/);
    expect(notice?.message).toMatch(/removed your old password/);
    expect(notice?.message).toMatch(/signed out any other devices/);
    expect(notice?.message).toMatch(/phone number/);
    expect(notice?.message).toMatch(/Forgot password/);
  });

  it("finds it among other cookies", () => {
    const cookies = `theme=dark; ${AUTH_NOTICE_COOKIE}=${GOOGLE_LINKED_NOTICE}; other=1`;
    expect(authNoticeFromCookies(cookies)?.title).toBe(
      "Google is now connected",
    );
  });

  it("shows nothing when there is no note", () => {
    expect(authNoticeFromCookies("")).toBeNull();
    expect(authNoticeFromCookies("theme=dark; other=1")).toBeNull();
  });

  it("is not fooled by a cookie that only ends the same way", () => {
    expect(
      authNoticeFromCookies(`x${AUTH_NOTICE_COOKIE}=${GOOGLE_LINKED_NOTICE}`),
    ).toBeNull();
    expect(
      authNoticeFromCookies(`${AUTH_NOTICE_COOKIE}x=${GOOGLE_LINKED_NOTICE}`),
    ).toBeNull();
  });

  it("shows only our own words, whatever the cookie says", () => {
    for (const value of [
      "<script>alert(1)</script>",
      "Your account is suspended",
      "constructor",
      "__proto__",
      "toString",
      "",
    ]) {
      expect(
        authNoticeFromCookies(`${AUTH_NOTICE_COOKIE}=${value}`),
        value,
      ).toBeNull();
    }
  });

  it("ignores a cookie with no equals sign", () => {
    expect(authNoticeFromCookies(AUTH_NOTICE_COOKIE)).toBeNull();
  });

  it("carries on past a cookie it can't read", () => {
    expect(
      authNoticeFromCookies(
        `flag; ${AUTH_NOTICE_COOKIE}=${GOOGLE_LINKED_NOTICE}`,
      )?.title,
    ).toBe("Google is now connected");
  });

  it("clears with the same name and path it was set with", () => {
    const clear = clearAuthNoticeCookie();
    expect(clear.startsWith(`${AUTH_NOTICE_COOKIE}=;`)).toBe(true);
    expect(clear).toMatch(/Max-Age=0/);
    expect(clear).toMatch(/Path=\/(;|$)/);
  });
});
