import { describe, expect, it } from "vitest";
import {
  SHARE_CARD_MAX_TITLE_CHARS,
  SHARE_CARD_SIZE,
  shareCardFigures,
  shareCardKind,
  shareCardPath,
  shareCardTitle,
  shareCardTitleSize,
} from "./share-card";

const KES = "KES" as const;

describe("the shape of a fundraiser's share card", () => {
  it("is 1.91 to 1, the shape link previews are made for", () => {
    expect(SHARE_CARD_SIZE.width / SHARE_CARD_SIZE.height).toBeCloseTo(
      1.905,
      2,
    );
  });
});

describe("where a fundraiser's share card is served from", () => {
  const fundraiser = {
    _id: "jh7cygrfjexkqqv7etgb4ecqn98cmbkv",
    updatedAt: 1795000000000,
    amountRaised: 184500,
    donorCount: 61,
  };

  it("is the fundraiser's own address, then share-image", () => {
    expect(shareCardPath(fundraiser)).toMatch(
      /^\/fundraiser\/jh7cygrfjexkqqv7etgb4ecqn98cmbkv\/share-image\?v=/,
    );
  });

  it("changes when the total, the number of donations or the fundraiser changes, so no cache serves a stale card", () => {
    const base = shareCardPath(fundraiser);
    expect(shareCardPath({ ...fundraiser, amountRaised: 190000 })).not.toBe(
      base,
    );
    expect(shareCardPath({ ...fundraiser, donorCount: 62 })).not.toBe(base);
    expect(shareCardPath({ ...fundraiser, updatedAt: 1795000000001 })).not.toBe(
      base,
    );
    expect(shareCardPath({ ...fundraiser })).toBe(base);
  });

  it("escapes an id so it can't change the path", () => {
    expect(shareCardPath({ ...fundraiser, _id: "a/b?c" })).toContain(
      "/fundraiser/a%2Fb%3Fc/share-image",
    );
  });
});

describe("what the card says about the money", () => {
  it("shows what has been raised against the goal, with the progress", () => {
    const figures = shareCardFigures({
      amountRaised: 184500,
      goalAmount: 400000,
      donorCount: 61,
      currency: KES,
    });
    expect(figures.headline).toMatch(/^Ksh\s184,500$/);
    expect(figures.caption).toMatch(/^raised of Ksh\s400,000$/);
    expect(figures.status).toBe("46% funded");
    expect(figures.donations).toBe("61 donations");
    expect(figures.barPercent).toBe(46);
  });

  it("uses the fundraiser's own currency", () => {
    const figures = shareCardFigures({
      amountRaised: 1240,
      goalAmount: 3000,
      donorCount: 23,
      currency: "USD",
    });
    expect(figures.headline).toBe("US$1,240");
    expect(figures.caption).toBe("raised of US$3,000");
  });

  it("says one donation, not 1 donations", () => {
    const figures = shareCardFigures({
      amountRaised: 500,
      goalAmount: 1000,
      donorCount: 1,
      currency: KES,
    });
    expect(figures.donations).toBe("1 donation");
  });

  it("fills the bar, and no more, once the goal is passed, and still says the real figure", () => {
    const figures = shareCardFigures({
      amountRaised: 135400,
      goalAmount: 120000,
      donorCount: 118,
      currency: KES,
    });
    expect(figures.barPercent).toBe(100);
    expect(figures.status).toBe("113% funded");
  });

  it("shows a sliver of the bar for a gift too small to move it, and doesn't call it 0%", () => {
    const figures = shareCardFigures({
      amountRaised: 500,
      goalAmount: 900000,
      donorCount: 1,
      currency: KES,
    });
    expect(figures.barPercent).toBe(3);
    expect(figures.status).toBe("Under 1% funded");
  });

  it("leads with the goal and an invitation until the first gift, not with 'Ksh 0 raised'", () => {
    const figures = shareCardFigures({
      amountRaised: 0,
      goalAmount: 80000,
      donorCount: 0,
      currency: KES,
    });
    expect(figures.headline).toMatch(/^Ksh\s80,000$/);
    expect(figures.caption).toBe("goal");
    expect(figures.status).toBe("Be the first to give");
    expect(figures.donations).toBeNull();
    expect(figures.barPercent).toBe(0);
  });

  it("copes with a goal of nothing, or a negative total, without NaN or an overfull bar", () => {
    const noGoal = shareCardFigures({
      amountRaised: 500,
      goalAmount: 0,
      donorCount: 1,
      currency: KES,
    });
    expect(noGoal.status).not.toContain("NaN");
    expect(noGoal.barPercent).toBeLessThanOrEqual(100);

    const negative = shareCardFigures({
      amountRaised: -50,
      goalAmount: 1000,
      donorCount: 2,
      currency: KES,
    });
    expect(negative.barPercent).toBe(0);
    expect(negative.headline).not.toContain("-");
  });
});

describe("the title on the card", () => {
  it("is set smaller the longer it is, never larger than before", () => {
    const sizes = [10, 34, 40, 52, 60, 66, 70, 140].map((length) =>
      shareCardTitleSize("x".repeat(length)),
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    }
    expect(sizes[0]).toBeGreaterThan(sizes[sizes.length - 1]);
  });

  it("is squeezed onto one line of text and capped, with the cut marked", () => {
    expect(shareCardTitle("  Water   for\nKajiado ")).toBe("Water for Kajiado");

    const capped = shareCardTitle("word ".repeat(100));
    expect(Array.from(capped)).toHaveLength(SHARE_CARD_MAX_TITLE_CHARS);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("never cuts an emoji in half", () => {
    const capped = shareCardTitle("🙏".repeat(300));
    expect(capped).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(capped).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });
});

describe("the kind line under the title", () => {
  it("says the kind of fundraiser and where", () => {
    expect(shareCardKind({ type: "MEDICAL", location: "Kajiado" })).toBe(
      "Medical · Kajiado",
    );
  });

  it("leaves out a place that isn't there or is blank", () => {
    expect(shareCardKind({ type: "SPORTS" })).toBe("Sports");
    expect(shareCardKind({ type: "SPORTS", location: "   " })).toBe("Sports");
    expect(shareCardKind({ type: "SPORTS", location: null })).toBe("Sports");
  });

  it("has a plain word for a kind it doesn't know", () => {
    expect(shareCardKind({ type: "SOMETHING_NEW" })).toBe("Fundraiser");
  });
});
