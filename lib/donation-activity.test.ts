import { describe, expect, it } from "vitest";
import {
  latestDonations,
  MAX_DONOR_NAME_LENGTH,
  normalizeDonorName,
  publicDonorName,
  RECENT_DONATIONS_SHOWN,
  timeAgo,
  trackNewDonations,
  UNNAMED_DONOR_NAME,
} from "./donation-activity";

describe("normalizeDonorName", () => {
  it("tidies spaces and control characters", () => {
    expect(normalizeDonorName("  Wanjiru   Kamau ")).toBe("Wanjiru Kamau");
    expect(normalizeDonorName("Wanjiru\nKamau\t")).toBe("Wanjiru Kamau");
    expect(normalizeDonorName("Wan\u0000jiru")).toBe("Wan jiru");
  });

  it("gives nothing for no name", () => {
    expect(normalizeDonorName(undefined)).toBeUndefined();
    expect(normalizeDonorName(null)).toBeUndefined();
    expect(normalizeDonorName("")).toBeUndefined();
    expect(normalizeDonorName("   \n ")).toBeUndefined();
  });

  it("cuts a long name, without splitting an emoji", () => {
    const long = normalizeDonorName("A".repeat(200));
    expect(Array.from(long ?? "")).toHaveLength(MAX_DONOR_NAME_LENGTH);

    const emoji = normalizeDonorName("😀".repeat(200));
    expect(Array.from(emoji ?? "")).toHaveLength(MAX_DONOR_NAME_LENGTH);
  });

  // The name is shown to everyone who opens the fundraiser.
  it.each([
    "jane@example.com",
    "Jane jane@example.com",
    "0712345678",
    "0712 345 678",
    "+254 712 345 678",
    "call 712-345-678",
    "https://example.com",
    "www.example.com",
  ])("refuses an email address, phone number or web address: %s", (typed) => {
    expect(normalizeDonorName(typed)).toBeUndefined();
  });

  it("keeps ordinary names that happen to have a number in them", () => {
    expect(normalizeDonorName("Class of 2026")).toBe("Class of 2026");
    expect(normalizeDonorName("Kamau & Sons")).toBe("Kamau & Sons");
    expect(normalizeDonorName("Wanjiru K.")).toBe("Wanjiru K.");
    expect(normalizeDonorName("Muthoni wa Njeri")).toBe("Muthoni wa Njeri");
  });
});

describe("publicDonorName", () => {
  it("names a donor like a comment does: first name and last initial", () => {
    expect(
      publicDonorName({ isAnonymous: false, donorName: "Wanjiru Kamau" }),
    ).toBe("Wanjiru K.");
    expect(
      publicDonorName({
        isAnonymous: false,
        donorName: "Mary Wanjiku Kamau Njeri",
      }),
    ).toBe("Mary N.");
    expect(publicDonorName({ isAnonymous: false, donorName: "Brian" })).toBe(
      "Brian",
    );
  });

  it("never shows a name for an anonymous gift", () => {
    expect(
      publicDonorName({ isAnonymous: true, donorName: "Wanjiru Kamau" }),
    ).toBe("Anonymous donor");
    expect(publicDonorName({ isAnonymous: true })).toBe("Anonymous donor");
  });

  it("says Someone when there is no usable name", () => {
    expect(publicDonorName({ isAnonymous: false })).toBe(UNNAMED_DONOR_NAME);
    expect(publicDonorName({ isAnonymous: false, donorName: null })).toBe(
      "Someone",
    );
    expect(publicDonorName({ isAnonymous: false, donorName: "  " })).toBe(
      "Someone",
    );
  });

  // A value that got stored before names were checked is not shown either.
  it("does not show a stored email address or phone number", () => {
    expect(
      publicDonorName({ isAnonymous: false, donorName: "jane@example.com" }),
    ).toBe("Someone");
    expect(
      publicDonorName({ isAnonymous: false, donorName: "0712345678" }),
    ).toBe("Someone");
  });
});

describe("latestDonations", () => {
  const donation = (id: string, createdAt: number, completedAt?: number) => ({
    id,
    createdAt,
    completedAt,
  });

  it("puts the newest first and keeps only the number asked for", () => {
    const result = latestDonations([
      donation("a", 1, 10),
      donation("b", 2, 20),
      donation("c", 3, 30),
      donation("d", 4, 40),
    ]);
    expect(result.map((d) => d.id)).toEqual(["d", "c", "b"]);
    expect(result).toHaveLength(RECENT_DONATIONS_SHOWN);
  });

  it("goes by when a donation was paid, not when it was started", () => {
    // "slow" was started first but paid last.
    const result = latestDonations([
      donation("fast", 5, 6),
      donation("slow", 1, 9),
    ]);
    expect(result.map((d) => d.id)).toEqual(["slow", "fast"]);
  });

  it("falls back to when it was started if the payment time wasn't recorded", () => {
    const result = latestDonations([
      donation("old", 1),
      donation("new", 8),
      donation("paid", 2, 5),
    ]);
    expect(result.map((d) => d.id)).toEqual(["new", "paid", "old"]);
  });

  it("keeps the order it was given for donations paid at the same moment", () => {
    const result = latestDonations([
      donation("first", 3, 7),
      donation("second", 2, 7),
    ]);
    expect(result.map((d) => d.id)).toEqual(["first", "second"]);
  });

  it("does not change the list it was given", () => {
    const input = [donation("a", 1, 1), donation("b", 2, 2)];
    latestDonations(input);
    expect(input.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("copes with fewer than asked for, and with none", () => {
    expect(latestDonations([donation("a", 1)])).toHaveLength(1);
    expect(latestDonations([])).toEqual([]);
  });
});

describe("trackNewDonations", () => {
  const item = (id: string) => ({ id });

  it("treats the first result as already there, so nothing is new", () => {
    const first = trackNewDonations(null, [item("a"), item("b")]);
    expect(first.fresh).toEqual([]);
    expect([...first.seen].sort()).toEqual(["a", "b"]);
  });

  it("reports a donation that arrives later, once", () => {
    const first = trackNewDonations(null, [item("a"), item("b")]);
    const second = trackNewDonations(first.seen, [
      item("c"),
      item("a"),
      item("b"),
    ]);
    expect(second.fresh.map((d) => d.id)).toEqual(["c"]);

    const third = trackNewDonations(second.seen, [
      item("c"),
      item("a"),
      item("b"),
    ]);
    expect(third.fresh).toEqual([]);
  });

  it("reports several that arrive at once, in the order given", () => {
    const first = trackNewDonations(null, [item("a")]);
    const second = trackNewDonations(first.seen, [
      item("c"),
      item("b"),
      item("a"),
    ]);
    expect(second.fresh.map((d) => d.id)).toEqual(["c", "b"]);
  });

  it("never announces the same donation twice, even if it drops out and returns", () => {
    const first = trackNewDonations(null, [item("a")]);
    const second = trackNewDonations(first.seen, [item("b")]);
    expect(second.fresh.map((d) => d.id)).toEqual(["b"]);
    const third = trackNewDonations(second.seen, [item("a"), item("b")]);
    expect(third.fresh).toEqual([]);
  });

  it("does not change the set it was given", () => {
    const seen = new Set(["a"]);
    trackNewDonations(seen, [item("a"), item("b")]);
    expect([...seen]).toEqual(["a"]);
  });
});

describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  const ago = (ms: number) => timeAgo(now - ms, now);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [MIN, "1 min ago"],
    [5 * MIN + 30_000, "5 min ago"],
    [59 * MIN, "59 min ago"],
    [HOUR, "1 hr ago"],
    [23 * HOUR, "23 hr ago"],
    [DAY, "yesterday"],
    [2 * DAY, "2 days ago"],
    [6 * DAY, "6 days ago"],
    [7 * DAY, "1 wk ago"],
    [20 * DAY, "2 wk ago"],
    [30 * DAY, "1 mo ago"],
    [200 * DAY, "6 mo ago"],
    [365 * DAY, "1 yr ago"],
  ])("%d ms ago reads %s", (elapsed, expected) => {
    expect(ago(elapsed)).toBe(expected);
  });

  it("does not go odd when the clocks disagree and it is in the future", () => {
    expect(timeAgo(now + 5 * MIN, now)).toBe("just now");
  });
});
