import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  HOME_COUNTRY,
  countryName,
  countryOptions,
  isCountryCode,
} from "../lib/countries";
import {
  HIGH_RISK_JURISDICTIONS,
  REVIEW_INTERVAL_DAYS,
  assessRisk,
  eddRecordProblem,
  expectedValueRisk,
  geographyRisk,
  hasNewEddReason,
  isEddOutstanding,
  maxRisk,
  nextReviewDue,
  type RiskInputs,
} from "../lib/risk";
import { tierPayoutLimitKes } from "../lib/kyc";

// The rules of AML policy 4.3, 5.10, 7 and 8, as lib/risk.ts states them. The
// backend and the review screen both use that file, so what is pinned here is
// what staff see and what the server enforces.

const DAY = 24 * 60 * 60 * 1000;

// A Kenyan, expecting a modest amount, who is not a PEP and behaves normally.
const ordinary: RiskInputs = {
  expectedAmountKes: 50_000,
  residenceCountry: "KE",
  pepOutcome: "NOT_PEP",
  behaviour: "LOW",
  tier: 1,
};

describe("countries", () => {
  it("has no duplicate or malformed codes", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("recognizes real codes and nothing else", () => {
    expect(isCountryCode("KE")).toBe(true);
    expect(isCountryCode("GB")).toBe(true);
    expect(isCountryCode("ke")).toBe(false); // callers upper-case first
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode("KEN")).toBe(false);
  });

  it("names a country, and falls back to the code for one it can't name", () => {
    expect(countryName("KE")).toBe("Kenya");
    expect(countryName("not a code")).toBe("not a code");
  });

  it("lists Kenya first and the rest from A to Z", () => {
    const options = countryOptions();
    expect(options).toHaveLength(COUNTRY_CODES.length);
    expect(options[0]).toEqual({ code: HOME_COUNTRY, name: "Kenya" });
    const names = options.slice(1).map((option) => option.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("only rates real countries as high risk, so a typo can't hide one", () => {
    for (const code of HIGH_RISK_JURISDICTIONS) {
      expect(isCountryCode(code), code).toBe(true);
    }
  });

  it("puts the FATF 'call for action' countries on the list", () => {
    for (const code of ["KP", "IR", "MM"]) {
      expect(HIGH_RISK_JURISDICTIONS.has(code)).toBe(true);
    }
  });
});

describe("maxRisk", () => {
  it("takes the highest level", () => {
    expect(maxRisk("LOW", "LOW")).toBe("LOW");
    expect(maxRisk("LOW", "MEDIUM")).toBe("MEDIUM");
    expect(maxRisk("HIGH", "LOW", "MEDIUM")).toBe("HIGH");
  });
});

describe("geographyRisk", () => {
  it("rates Kenya Low, as the policy's risk table does", () => {
    expect(geographyRisk("KE")).toBe("LOW");
  });

  it("rates another country Medium, and a listed one High", () => {
    expect(geographyRisk("GB")).toBe("MEDIUM");
    expect(geographyRisk("UG")).toBe("MEDIUM");
    expect(geographyRisk("KP")).toBe("HIGH");
    expect(geographyRisk("SS")).toBe("HIGH");
  });

  it("rates a missing country High rather than guessing", () => {
    expect(geographyRisk(null)).toBe("HIGH");
  });
});

describe("expectedValueRisk", () => {
  const level1 = tierPayoutLimitKes(1);
  const level2 = tierPayoutLimitKes(2);

  it("is Low up to the Level 1 limit, Medium up to Level 2's, High above", () => {
    expect(expectedValueRisk(1, 1)).toBe("LOW");
    expect(expectedValueRisk(level1, 1)).toBe("LOW");
    expect(expectedValueRisk(level1 + 1, 1)).toBe("MEDIUM");
    expect(expectedValueRisk(level2, 1)).toBe("MEDIUM");
    expect(expectedValueRisk(level2 + 1, 1)).toBe("HIGH");
  });

  it("is at least Medium for someone verified to Level 2", () => {
    expect(expectedValueRisk(10_000, 2)).toBe("MEDIUM");
    expect(expectedValueRisk(level2 + 1, 2)).toBe("HIGH");
  });

  it("is High when nothing was declared", () => {
    expect(expectedValueRisk(null, 1)).toBe("HIGH");
  });
});

describe("assessRisk", () => {
  it("rates an ordinary Kenyan fundraiser Low, with nothing extra to do", () => {
    const result = assessRisk(ordinary);
    expect(result).toMatchObject({
      rating: "LOW",
      computedRating: "LOW",
      isPep: false,
      nonResident: false,
      eddReasons: [],
      requiresEdd: false,
      factors: {
        customerType: "LOW",
        expectedValue: "LOW",
        geography: "LOW",
        behaviour: "LOW",
      },
    });
  });

  it("lets the highest factor set the rating", () => {
    expect(assessRisk({ ...ordinary, expectedAmountKes: 500_000 }).rating).toBe(
      "MEDIUM",
    );
    expect(assessRisk({ ...ordinary, behaviour: "MEDIUM" }).rating).toBe(
      "MEDIUM",
    );
    expect(assessRisk({ ...ordinary, tier: 2 }).rating).toBe("MEDIUM");

    const high = assessRisk({ ...ordinary, behaviour: "HIGH" });
    expect(high.rating).toBe("HIGH");
    expect(high.eddReasons).toEqual(["HIGH_RISK"]);
  });

  it("needs enhanced checks for expected funds above Level 2's limit", () => {
    const result = assessRisk({ ...ordinary, expectedAmountKes: 2_000_000 });
    expect(result.rating).toBe("HIGH");
    expect(result.requiresEdd).toBe(true);
  });

  it("always rates a PEP High and needs enhanced checks (policy 7.2)", () => {
    const result = assessRisk({ ...ordinary, pepOutcome: "PEP" });
    expect(result).toMatchObject({
      rating: "HIGH",
      isPep: true,
      factors: { customerType: "HIGH" },
      requiresEdd: true,
    });
    expect(result.eddReasons).toEqual(["HIGH_RISK", "PEP"]);
  });

  it("won't let an override lower a PEP", () => {
    const result = assessRisk({
      ...ordinary,
      pepOutcome: "PEP",
      overrideRating: "LOW",
    });
    expect(result.rating).toBe("HIGH");
  });

  it("treats someone who lives outside Kenya as a non-resident who needs enhanced checks (policy 5.8)", () => {
    const result = assessRisk({ ...ordinary, residenceCountry: "GB" });
    expect(result).toMatchObject({
      rating: "MEDIUM",
      nonResident: true,
      eddReasons: ["NON_RESIDENT"],
      requiresEdd: true,
    });
  });

  it("rates a high-risk jurisdiction High, on top of being a non-resident", () => {
    const result = assessRisk({ ...ordinary, residenceCountry: "IR" });
    expect(result.rating).toBe("HIGH");
    expect(result.eddReasons).toEqual([
      "HIGH_RISK",
      "NON_RESIDENT",
      "HIGH_RISK_JURISDICTION",
    ]);
  });

  it("treats a missing country as a non-resident in a high-risk place", () => {
    const result = assessRisk({ ...ordinary, residenceCountry: null });
    expect(result.rating).toBe("HIGH");
    expect(result.nonResident).toBe(true);
  });

  it("lets the MLRO override the computed rating, keeping both", () => {
    const lowered = assessRisk({
      ...ordinary,
      behaviour: "HIGH",
      overrideRating: "MEDIUM",
    });
    expect(lowered.rating).toBe("MEDIUM");
    expect(lowered.computedRating).toBe("HIGH");
    // The override is the final word, so it no longer asks for enhanced checks.
    expect(lowered.requiresEdd).toBe(false);

    const raised = assessRisk({ ...ordinary, overrideRating: "HIGH" });
    expect(raised.rating).toBe("HIGH");
    expect(raised.computedRating).toBe("LOW");
    expect(raised.eddReasons).toEqual(["HIGH_RISK"]);
  });

  it("lets the MLRO require enhanced checks whatever the rating", () => {
    const result = assessRisk({ ...ordinary, mlroFlagged: true });
    expect(result.rating).toBe("LOW");
    expect(result.eddReasons).toEqual(["MLRO_FLAGGED"]);
    expect(result.requiresEdd).toBe(true);
  });
});

describe("nextReviewDue (policy 5.10)", () => {
  it("reviews High risk yearly, Medium every two years and Low every three", () => {
    expect(REVIEW_INTERVAL_DAYS).toEqual({
      HIGH: 365,
      MEDIUM: 730,
      LOW: 1095,
    });
    const from = Date.UTC(2026, 10, 4);
    expect(nextReviewDue("HIGH", from)).toBe(from + 365 * DAY);
    expect(nextReviewDue("MEDIUM", from)).toBe(from + 730 * DAY);
    expect(nextReviewDue("LOW", from)).toBe(from + 1095 * DAY);
  });
});

describe("enhanced due diligence", () => {
  it("is outstanding while there are reasons and no record", () => {
    expect(isEddOutstanding({ eddReasons: [] })).toBe(false);
    expect(isEddOutstanding({ eddReasons: ["PEP"] })).toBe(true);
    expect(isEddOutstanding({ eddReasons: ["PEP"], eddCompletedAt: null })).toBe(
      true,
    );
    expect(isEddOutstanding({ eddReasons: ["PEP"], eddCompletedAt: 1 })).toBe(
      false,
    );
    expect(isEddOutstanding({ eddReasons: [], eddCompletedAt: null })).toBe(
      false,
    );
  });

  it("is reopened only by a reason the record didn't cover", () => {
    expect(hasNewEddReason(["PEP"], ["PEP"])).toBe(false);
    expect(hasNewEddReason(["PEP", "HIGH_RISK"], ["PEP"])).toBe(false);
    expect(hasNewEddReason(["PEP"], ["PEP", "MLRO_FLAGGED"])).toBe(true);
    expect(hasNewEddReason([], ["NON_RESIDENT"])).toBe(true);
  });

  it("needs the source of funds, and for a PEP the source of wealth too", () => {
    const funds = "Salary and savings, confirmed against bank statements.";
    expect(eddRecordProblem({ sourceOfFunds: funds, isPep: false })).toBeNull();
    expect(eddRecordProblem({ sourceOfFunds: "  short ", isPep: false })).toMatch(
      /where the funds come from/,
    );
    expect(eddRecordProblem({ sourceOfFunds: funds, isPep: true })).toMatch(
      /source of wealth/,
    );
    expect(
      eddRecordProblem({
        sourceOfFunds: funds,
        sourceOfWealth: "Farm income and a family business.",
        isPep: true,
      }),
    ).toBeNull();
  });
});
