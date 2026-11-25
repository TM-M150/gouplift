import { describe, expect, it } from "vitest";
import { formatKesWhole, fundraiserProgress } from "./fundraiser-progress";

describe("fundraiserProgress", () => {
  it.each([
    [0, 100000, 0],
    [25000, 100000, 25],
    [33333, 100000, 33],
    [99600, 100000, 100],
    [100000, 100000, 100],
    [250000, 100000, 100],
  ])("%d raised of %d is %d%%", (raised, goal, expected) => {
    expect(fundraiserProgress(raised, goal)).toBe(expected);
  });

  it("is 0 when there is no usable goal, rather than dividing by it", () => {
    expect(fundraiserProgress(500, 0)).toBe(0);
    expect(fundraiserProgress(500, -10)).toBe(0);
    expect(fundraiserProgress(500, Number.NaN)).toBe(0);
  });

  it("never goes below 0", () => {
    expect(fundraiserProgress(-50, 1000)).toBe(0);
  });
});

describe("formatKesWhole", () => {
  it("writes whole shillings with separators", () => {
    // The Kenyan locale writes "Ksh", with a non-breaking space after it, as
    // every other page of the site does.
    expect(formatKesWhole(1500).replace(/\s/g, " ")).toBe("Ksh 1,500");
    expect(formatKesWhole(0).replace(/\s/g, " ")).toBe("Ksh 0");
    expect(formatKesWhole(1234567).replace(/\s/g, " ")).toBe("Ksh 1,234,567");
  });
});
