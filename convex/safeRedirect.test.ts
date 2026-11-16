import { describe, expect, it } from "vitest";
import {
  AFTER_SIGN_IN_DEFAULT,
  safeNextPath,
  signInHref,
  signUpHref,
} from "../lib/safe-redirect";

describe("where to go after signing in", () => {
  it("goes to the profile when nothing was asked for", () => {
    expect(safeNextPath(null)).toBe(AFTER_SIGN_IN_DEFAULT);
    expect(safeNextPath(undefined)).toBe(AFTER_SIGN_IN_DEFAULT);
    expect(safeNextPath("")).toBe(AFTER_SIGN_IN_DEFAULT);
    expect(AFTER_SIGN_IN_DEFAULT).toBe("/profile");
  });

  it("follows a path on this site, keeping its query and its #section", () => {
    expect(safeNextPath("/fundraiser/abc123")).toBe("/fundraiser/abc123");
    expect(safeNextPath("/fundraiser/abc123#comments")).toBe(
      "/fundraiser/abc123#comments",
    );
    expect(safeNextPath("/organizations/hope?tab=fundraisers")).toBe(
      "/organizations/hope?tab=fundraisers",
    );
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/profile")).toBe("/profile");
  });

  it("refuses another website, however it is written", () => {
    for (const next of [
      "https://evil.example/phish",
      "http://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "evil.example/path",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:someone@example.com",
    ]) {
      expect(safeNextPath(next), next).toBe(AFTER_SIGN_IN_DEFAULT);
    }
  });

  it("refuses a path that tidies itself into another website", () => {
    for (const next of [
      "/.//evil.example",
      "/a/..//evil.example",
      "/./\u0001/x",
    ]) {
      expect(safeNextPath(next), next).toBe(AFTER_SIGN_IN_DEFAULT);
    }
  });

  it("does not treat an encoded slash as a way off the site", () => {
    // Stays a path on this site: the browser doesn't read %2F as a slash here.
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });

  it("refuses control characters and backslashes anywhere in it", () => {
    for (const next of [
      "/fundraiser/\u0000abc",
      "/fundraiser/abc\u007f",
      "/fundraiser/a\\b",
      "/fundraiser/abc\u001f#x",
    ]) {
      expect(safeNextPath(next), JSON.stringify(next)).toBe(
        AFTER_SIGN_IN_DEFAULT,
      );
    }
  });

  it("refuses the sign-in pages themselves, so nobody is sent round in a circle", () => {
    for (const next of [
      "/sign-in",
      "/sign-in?next=/profile",
      "/sign-up",
      "/forgot-password",
      "/reset-password",
      "/reset-password/abc",
    ]) {
      expect(safeNextPath(next), next).toBe(AFTER_SIGN_IN_DEFAULT);
    }
    // A page that only starts with the same letters is fine.
    expect(safeNextPath("/sign-in-guide")).toBe("/sign-in-guide");
  });

  it("refuses an absurdly long one", () => {
    expect(safeNextPath(`/${"a".repeat(499)}`)).toBe(`/${"a".repeat(499)}`);
    expect(safeNextPath(`/${"a".repeat(500)}`)).toBe(AFTER_SIGN_IN_DEFAULT);
  });

  it("uses the fallback it is given", () => {
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
    expect(safeNextPath(null, "")).toBe("");
  });
});

describe("links to the sign-in and sign-up pages", () => {
  it("carry the page to come back to, encoded", () => {
    expect(signInHref("/fundraiser/abc123#comments")).toBe(
      "/sign-in?next=%2Ffundraiser%2Fabc123%23comments",
    );
    expect(signUpHref("/fundraiser/abc123#comments")).toBe(
      "/sign-up?next=%2Ffundraiser%2Fabc123%23comments",
    );
  });

  it("are plain when there is nothing safe to come back to", () => {
    expect(signInHref(null)).toBe("/sign-in");
    expect(signInHref(undefined)).toBe("/sign-in");
    expect(signInHref("https://evil.example")).toBe("/sign-in");
    expect(signInHref("/sign-up")).toBe("/sign-in");
    expect(signUpHref("//evil.example")).toBe("/sign-up");
  });

  it("round-trip: what a link carries is what the page goes back to", () => {
    const href = signInHref("/fundraiser/abc123?donation=xyz#comments");
    const next = new URL(href, "https://x.test").searchParams.get("next");
    expect(safeNextPath(next)).toBe("/fundraiser/abc123?donation=xyz#comments");
  });
});
