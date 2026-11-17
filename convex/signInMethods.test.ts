import { describe, expect, it } from "vitest";
import {
  GOOGLE_CONNECTED_PATH,
  SETTINGS_PATH,
  describeSignInMethods,
  isLastWayIn,
  linkErrorMessage,
  needsFreshSignIn,
  readLinkReturn,
} from "../lib/sign-in-methods";
import { profileTabFromParam } from "../lib/profile-tabs";
import { safeNextPath, signInHref } from "../lib/safe-redirect";

// (These live here because vitest only looks under convex/.)

const accounts = (...providerIds: string[]) =>
  providerIds.map((providerId) => ({ providerId }));

const params = (query: string) => new URLSearchParams(query);

describe("which ways a person can sign in", () => {
  it("knows a password, Google, both, or neither", () => {
    expect(describeSignInMethods([])).toEqual({
      hasPassword: false,
      hasGoogle: false,
      canDisconnectGoogle: false,
    });
    expect(describeSignInMethods(accounts("credential"))).toEqual({
      hasPassword: true,
      hasGoogle: false,
      canDisconnectGoogle: false,
    });
    expect(describeSignInMethods(accounts("google"))).toMatchObject({
      hasPassword: false,
      hasGoogle: true,
    });
    expect(describeSignInMethods(accounts("credential", "google"))).toEqual({
      hasPassword: true,
      hasGoogle: true,
      canDisconnectGoogle: true,
    });
  });

  it("does not let Google be disconnected when it is the only way in", () => {
    expect(describeSignInMethods(accounts("google")).canDisconnectGoogle).toBe(
      false,
    );
  });

  it("lets Google be disconnected once there is a password", () => {
    expect(
      describeSignInMethods(accounts("google", "credential"))
        .canDisconnectGoogle,
    ).toBe(true);
    // In either order.
    expect(
      describeSignInMethods(accounts("credential", "google"))
        .canDisconnectGoogle,
    ).toBe(true);
  });

  it("counts any other way in, not just a password", () => {
    expect(
      describeSignInMethods(accounts("google", "github")).canDisconnectGoogle,
    ).toBe(true);
  });

  it("is not fooled by a second Google account", () => {
    // Two rows for the same provider are still one way in.
    expect(
      describeSignInMethods(accounts("google", "google")).canDisconnectGoogle,
    ).toBe(false);
  });

  it("offers nothing to disconnect when Google isn't connected", () => {
    expect(
      describeSignInMethods(accounts("credential")).canDisconnectGoogle,
    ).toBe(false);
  });
});

describe("coming back from Google", () => {
  it("says nothing for an ordinary visit to the profile", () => {
    expect(readLinkReturn(params(""))).toBeNull();
    expect(readLinkReturn(params("tab=settings"))).toBeNull();
    expect(readLinkReturn(params("google=maybe"))).toBeNull();
  });

  it("recognises a successful connection", () => {
    expect(readLinkReturn(params("tab=settings&google=connected"))).toEqual({
      kind: "connected",
    });
    // The very address the card asks Google to send people back to.
    const back = new URL(GOOGLE_CONNECTED_PATH, "https://example.test");
    expect(readLinkReturn(back.searchParams)).toEqual({ kind: "connected" });
  });

  it("explains each way it can fail", () => {
    const message = (code: string) => {
      const result = readLinkReturn(params(`tab=settings&error=${code}`));
      expect(result?.kind).toBe("error");
      return result?.kind === "error" ? result.message : "";
    };

    expect(message("access_denied")).toMatch(/cancelled/);
    expect(message("account_already_linked_to_different_user")).toMatch(
      /already connected to a different/,
    );
    expect(message("unable_to_link_account")).toMatch(/try again/);
  });

  it("explains a mismatched email, whichever way better-auth spells it", () => {
    const encoded = encodeURIComponent("email_doesn't_match");
    for (const code of [encoded, "email_does_not_match"]) {
      const result = readLinkReturn(params(`error=${code}`));
      expect(result).toEqual({
        kind: "error",
        message: expect.stringMatching(/different email address/),
      });
    }
  });

  it("reports an error before a success if the address somehow has both", () => {
    expect(
      readLinkReturn(params("google=connected&error=access_denied")),
    ).toMatchObject({ kind: "error" });
  });

  it("never repeats text from the address back to the person", () => {
    // Anyone can write an address, so a made-up error can't be put in the
    // page's mouth.
    const hostile = "Your account is locked. Call 0700 000 000 now";
    const result = readLinkReturn(
      params(
        `error=${encodeURIComponent(hostile)}&error_description=${encodeURIComponent(hostile)}`,
      ),
    );
    expect(result).toEqual({
      kind: "error",
      message: linkErrorMessage("anything else"),
    });
    expect(JSON.stringify(result)).not.toContain("0700");
  });
});

describe("disconnecting", () => {
  it("recognises a sign-in that is too old", () => {
    expect(needsFreshSignIn({ code: "SESSION_NOT_FRESH" })).toBe(true);
    expect(needsFreshSignIn({ message: "Session is not fresh" })).toBe(true);
    expect(needsFreshSignIn({ message: "SESSION IS NOT FRESH" })).toBe(true);
  });

  it("doesn't mistake other problems for it", () => {
    expect(needsFreshSignIn(null)).toBe(false);
    expect(needsFreshSignIn(undefined)).toBe(false);
    expect(needsFreshSignIn({})).toBe(false);
    expect(needsFreshSignIn({ code: "ACCOUNT_NOT_FOUND" })).toBe(false);
    expect(
      needsFreshSignIn({ message: "You can't unlink your last account" }),
    ).toBe(false);
  });

  it("recognises the refusal to remove the last way in", () => {
    expect(isLastWayIn({ code: "FAILED_TO_UNLINK_LAST_ACCOUNT" })).toBe(true);
    expect(isLastWayIn({ message: "You can't unlink your last account" })).toBe(
      true,
    );
    expect(isLastWayIn(null)).toBe(false);
    expect(isLastWayIn({ code: "SESSION_NOT_FRESH" })).toBe(false);
    expect(isLastWayIn({ message: "Session is not fresh" })).toBe(false);
  });
});

describe("the Settings tab and the addresses that lead to it", () => {
  it("opens the tab the address names", () => {
    for (const tab of ["additional", "fundraisers", "impact", "settings"]) {
      expect(profileTabFromParam(tab)).toBe(tab);
    }
  });

  it("opens the first tab for anything else", () => {
    for (const value of [
      null,
      undefined,
      "",
      "Settings",
      "nope",
      "__proto__",
      "toString",
    ]) {
      expect(profileTabFromParam(value)).toBe("additional");
    }
  });

  it("returns people from Google to Settings", () => {
    const back = new URL(GOOGLE_CONNECTED_PATH, "https://example.test");
    expect(back.pathname).toBe("/profile");
    expect(profileTabFromParam(back.searchParams.get("tab"))).toBe("settings");
    expect(
      profileTabFromParam(
        new URL(SETTINGS_PATH, "https://example.test").searchParams.get("tab"),
      ),
    ).toBe("settings");
  });

  it("returns people from signing in again to Settings too", () => {
    // The sign-in page only follows a path it considers safe, and keeps the query.
    expect(safeNextPath(SETTINGS_PATH)).toBe(SETTINGS_PATH);
    expect(signInHref(SETTINGS_PATH)).toBe(
      `/sign-in?next=${encodeURIComponent(SETTINGS_PATH)}`,
    );
  });
});
