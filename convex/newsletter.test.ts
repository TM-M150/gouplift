/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const subscribers = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("newsletterSignups").collect());

describe("newsletter.subscribe", () => {
  it("stores the address in lower case, with when and where they agreed", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.newsletter.subscribe, {
      email: "  Wanjiru@Example.COM ",
    });

    expect(result).toEqual({ status: "subscribed" });
    const rows = await subscribers(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "wanjiru@example.com",
      consentedAt: Date.now(),
      source: "footer",
    });
  });

  it("works without an account", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.newsletter.subscribe, { email: "guest@example.com" }),
    ).resolves.toEqual({ status: "subscribed" });
  });

  it("answers the same, and stores one row, when the address is already on the list", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.newsletter.subscribe, {
      email: "a@example.com",
    });
    const again = await t.mutation(api.newsletter.subscribe, {
      email: "A@EXAMPLE.com",
    });

    expect(again).toEqual(first);
    expect(await subscribers(t)).toHaveLength(1);
  });

  it("refuses things that aren't email addresses and stores nothing", async () => {
    const t = convexTest(schema, modules);
    for (const email of [
      "",
      "   ",
      "not-an-email",
      "missing@tld",
      "two@@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      await expect(
        t.mutation(api.newsletter.subscribe, { email }),
      ).rejects.toThrow();
    }
    expect(await subscribers(t)).toHaveLength(0);
  });

  it("tells the person what is wrong with the address", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.newsletter.subscribe, { email: "nope" }),
    ).rejects.toThrow("valid email");
  });

  it("looks like a success to a bot that fills the hidden field, but stores nothing", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(api.newsletter.subscribe, {
      email: "bot@example.com",
      website: "http://spam.example",
    });

    expect(result).toEqual({ status: "subscribed" });
    expect(await subscribers(t)).toHaveLength(0);
  });

  it("caps sign-ups for the whole form, then lets people in again later", async () => {
    const t = convexTest(schema, modules);

    for (let i = 0; i < 60; i++) {
      await t.mutation(api.newsletter.subscribe, {
        email: `person${i}@example.com`,
      });
    }
    await expect(
      t.mutation(api.newsletter.subscribe, { email: "one-too-many@example.com" }),
    ).rejects.toThrow("try again");
    expect(await subscribers(t)).toHaveLength(60);

    // Someone already on the list still gets the normal answer.
    await expect(
      t.mutation(api.newsletter.subscribe, { email: "person3@example.com" }),
    ).resolves.toEqual({ status: "subscribed" });

    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(
      t.mutation(api.newsletter.subscribe, { email: "later@example.com" }),
    ).resolves.toEqual({ status: "subscribed" });
    expect(await subscribers(t)).toHaveLength(61);
  });
});
