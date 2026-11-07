import { describe, expect, it } from "vitest";
import {
  BENEFICIAL_OWNER_THRESHOLD_PERCENT,
  MAX_BENEFICIAL_OWNERS,
  hasNoIdentifiedOwner,
  ownershipProblem,
  type OwnerLike,
} from "../lib/beneficial-ownership";
import {
  ORGANIZATION_REVIEW_CHECKS,
  ORGANIZATION_REVIEW_CHECK_LABELS,
  getDocumentSlots,
} from "../lib/organization-verification";
import {
  assessOrganizationRisk,
  organizationCustomerTypeRisk,
  type OrganizationRiskInputs,
} from "../lib/risk";
import { beneficialOwnerSchema, beneficialOwnersSchema } from "../lib/validations/beneficial-owner";
import { organizationDetailsSchema } from "../lib/validations/organization";
import { ORG_DECLARATIONS, OWNER_MAJORITY, OWNER_MINORITY } from "./org.fixtures";

// The rules of AML policy 4.3, 6, 7 and 8 for organizations, as lib/ states
// them. The backend and the screens both use those files, so what is pinned
// here is what staff see and what the server enforces.

const owner = (
  basis: OwnerLike["basis"],
  ownershipPercent?: number,
): OwnerLike => ({ basis, ownershipPercent });

describe("ownershipProblem (policy 6)", () => {
  it("accepts one majority owner", () => {
    expect(ownershipProblem([owner("OWNERSHIP", 60)])).toBeNull();
  });

  it("accepts owners whose shares add up to exactly 100%", () => {
    expect(
      ownershipProblem([owner("OWNERSHIP", 60), owner("OWNERSHIP", 40)]),
    ).toBeNull();
  });

  it("accepts a person who controls it without owning a share", () => {
    expect(ownershipProblem([owner("CONTROL")])).toBeNull();
    expect(ownershipProblem([owner("CONTROL", 5)])).toBeNull();
  });

  it("accepts a senior managing official when nobody else is listed", () => {
    expect(ownershipProblem([owner("SENIOR_MANAGING_OFFICIAL")])).toBeNull();
  });

  it("asks for someone when the list is empty", () => {
    expect(ownershipProblem([])).toMatch(/senior managing official/);
  });

  it(`wants at least ${BENEFICIAL_OWNER_THRESHOLD_PERCENT}% from someone who owns it`, () => {
    expect(ownershipProblem([owner("OWNERSHIP", 9.99)])).toMatch(/10%/);
    expect(ownershipProblem([owner("OWNERSHIP", BENEFICIAL_OWNER_THRESHOLD_PERCENT)])).toBeNull();
    expect(ownershipProblem([owner("OWNERSHIP")])).toMatch(/10%/);
  });

  it("refuses shares above 100% in one person or across several", () => {
    expect(ownershipProblem([owner("OWNERSHIP", 101)])).toMatch(/10%/);
    expect(
      ownershipProblem([owner("OWNERSHIP", 60), owner("OWNERSHIP", 41)]),
    ).toMatch(/more than 100%/);
  });

  it("refuses a control share that makes no sense", () => {
    expect(ownershipProblem([owner("CONTROL", 0)])).toMatch(/between 0% and 100%/);
    expect(ownershipProblem([owner("CONTROL", 120)])).toMatch(/between 0% and 100%/);
  });

  it("only names a senior managing official when nobody owns or controls it", () => {
    expect(
      ownershipProblem([owner("SENIOR_MANAGING_OFFICIAL"), owner("OWNERSHIP", 60)]),
    ).toMatch(/only recorded when nobody/);
    expect(
      ownershipProblem([
        owner("SENIOR_MANAGING_OFFICIAL"),
        owner("SENIOR_MANAGING_OFFICIAL"),
      ]),
    ).toMatch(/one senior managing official/);
    expect(
      ownershipProblem([owner("SENIOR_MANAGING_OFFICIAL", 10)]),
    ).toMatch(/no ownership share/);
  });

  it("stops at a sane number of people", () => {
    const many = Array.from({ length: MAX_BENEFICIAL_OWNERS + 1 }, () =>
      owner("CONTROL"),
    );
    expect(ownershipProblem(many)).toMatch(/at most/);
    expect(ownershipProblem(many.slice(0, MAX_BENEFICIAL_OWNERS))).toBeNull();
  });
});

describe("hasNoIdentifiedOwner (policy 6.2)", () => {
  it("is true only when the senior managing official stands in", () => {
    expect(hasNoIdentifiedOwner([owner("SENIOR_MANAGING_OFFICIAL")])).toBe(true);
    expect(hasNoIdentifiedOwner([])).toBe(true);
    expect(hasNoIdentifiedOwner([owner("OWNERSHIP", 60)])).toBe(false);
    expect(hasNoIdentifiedOwner([owner("CONTROL")])).toBe(false);
  });
});

describe("beneficialOwnerSchema", () => {
  it("accepts a person and normalizes their ID number", () => {
    const parsed = beneficialOwnerSchema.parse({
      ...OWNER_MAJORITY,
      idType: "PASSPORT",
      idNumber: " ab 123456 ",
      residenceCountry: "ke",
    });
    expect(parsed.idNumber).toBe("AB123456");
    expect(parsed.residenceCountry).toBe("KE");
  });

  it("checks the ID number against its type", () => {
    const result = beneficialOwnerSchema.safeParse({
      ...OWNER_MAJORITY,
      idNumber: "123",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a country that doesn't exist and a missing PEP answer", () => {
    expect(
      beneficialOwnerSchema.safeParse({ ...OWNER_MAJORITY, residenceCountry: "ZZ" })
        .success,
    ).toBe(false);
    expect(
      beneficialOwnerSchema.safeParse({ ...OWNER_MAJORITY, pepDeclared: undefined })
        .success,
    ).toBe(false);
  });

  it("refuses a register that lists the same person twice", () => {
    const result = beneficialOwnersSchema.safeParse([
      { ...OWNER_MAJORITY, ownershipPercent: 30 },
      { ...OWNER_MAJORITY, fullName: "W. Kamau", ownershipPercent: 30 },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/more than once/);
  });

  it("refuses a register that isn't acceptable as a whole", () => {
    const result = beneficialOwnersSchema.safeParse([]);
    expect(result.success).toBe(false);
  });
});

describe("organizationDetailsSchema declarations", () => {
  const valid = {
    name: "Nakuru Youth Trust",
    organizationType: "OTHER" as const,
    registrationNumber: "CPR/2020/1234",
    ...ORG_DECLARATIONS,
  };

  it("accepts a complete application", () => {
    expect(organizationDetailsSchema.safeParse(valid).success).toBe(true);
  });

  it("needs the registration country, an amount and a timeline", () => {
    expect(
      organizationDetailsSchema.safeParse({ ...valid, registeredCountry: "ZZ" }).success,
    ).toBe(false);
    expect(
      organizationDetailsSchema.safeParse({ ...valid, expectedAmountKes: 0 }).success,
    ).toBe(false);
    expect(
      organizationDetailsSchema.safeParse({ ...valid, expectedAmountKes: 1.5 }).success,
    ).toBe(false);
    expect(
      organizationDetailsSchema.safeParse({ ...valid, expectedTimeline: "SOON" }).success,
    ).toBe(false);
  });

  it("needs the purpose confirmation to be ticked", () => {
    expect(
      organizationDetailsSchema.safeParse({
        ...valid,
        prohibitedActivitiesAcknowledged: false,
      }).success,
    ).toBe(false);
  });

  it("wants details from an organization that names a PEP", () => {
    expect(
      organizationDetailsSchema.safeParse({ ...valid, pepDeclared: true }).success,
    ).toBe(false);
    expect(
      organizationDetailsSchema.safeParse({
        ...valid,
        pepDeclared: true,
        pepDetails: "The treasurer is a county assembly member",
      }).success,
    ).toBe(true);
  });

  it("won't let an owner be a PEP under an answer of no", () => {
    const result = organizationDetailsSchema.safeParse({
      ...valid,
      beneficialOwners: [{ ...OWNER_MAJORITY, pepDeclared: true }, OWNER_MINORITY],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "pepDeclared")).toBe(true);
  });
});

describe("the owners' ID document", () => {
  it("is optional for every kind of organization", () => {
    for (const type of ["REGISTERED_COMPANY", "PBO", "SOCIETY", "TRUST", "CBO_SELF_HELP", "OTHER"] as const) {
      const slots = getDocumentSlots(type);
      const slot = slots.find((s) => s.documentType === "BENEFICIAL_OWNER_IDS");
      expect(slot?.required).toBe(false);
    }
  });
});

describe("what a reviewer confirms before verifying an organization", () => {
  it("has a label for every check", () => {
    for (const check of ORGANIZATION_REVIEW_CHECKS) {
      expect(ORGANIZATION_REVIEW_CHECK_LABELS[check].length).toBeGreaterThan(20);
    }
  });
});

// A registered Kenyan body expecting a modest amount, with a clear owner, no
// PEP, and nothing odd about how it has dealt with us.
const ordinary: OrganizationRiskInputs = {
  expectedAmountKes: 500_000,
  residenceCountry: "KE",
  pepOutcome: "NOT_PEP",
  behaviour: "LOW",
  complexStructure: false,
  highRiskSector: false,
  noOwnerIdentified: false,
};

describe("organizationCustomerTypeRisk (policy 4.3)", () => {
  it("rates a registered body Medium", () => {
    expect(organizationCustomerTypeRisk(ordinary)).toBe("MEDIUM");
  });

  it.each([
    ["a PEP", { pepOutcome: "PEP" as const }],
    ["a complex structure", { complexStructure: true }],
    ["a high-risk sector", { highRiskSector: true }],
  ])("rates %s High", (_name, change) => {
    expect(organizationCustomerTypeRisk({ ...ordinary, ...change })).toBe("HIGH");
  });

  it("keeps an organization with no identified owner at Medium (policy 6.2)", () => {
    expect(
      organizationCustomerTypeRisk({ ...ordinary, noOwnerIdentified: true }),
    ).toBe("MEDIUM");
  });
});

describe("assessOrganizationRisk", () => {
  it("rates an ordinary Kenyan body Medium with no enhanced due diligence", () => {
    const result = assessOrganizationRisk(ordinary);
    expect(result.rating).toBe("MEDIUM");
    expect(result.requiresEdd).toBe(false);
    expect(result.eddReasons).toEqual([]);
    expect(result.nonResident).toBe(false);
  });

  it("never rates a registered body below Medium, however small", () => {
    expect(
      assessOrganizationRisk({ ...ordinary, expectedAmountKes: 1_000 }).rating,
    ).toBe("MEDIUM");
  });

  it("rates a body expecting more than the Level 2 limit High", () => {
    const result = assessOrganizationRisk({
      ...ordinary,
      expectedAmountKes: 5_000_000,
    });
    expect(result.factors.expectedValue).toBe("HIGH");
    expect(result.rating).toBe("HIGH");
    expect(result.eddReasons).toEqual(["HIGH_RISK"]);
  });

  it("treats a body that declared nothing as High", () => {
    expect(
      assessOrganizationRisk({ ...ordinary, expectedAmountKes: null }).rating,
    ).toBe("HIGH");
    expect(
      assessOrganizationRisk({ ...ordinary, residenceCountry: null }).rating,
    ).toBe("HIGH");
  });

  it("needs enhanced due diligence for a body registered abroad (policy 5.8)", () => {
    const result = assessOrganizationRisk({ ...ordinary, residenceCountry: "GB" });
    expect(result.nonResident).toBe(true);
    expect(result.factors.geography).toBe("MEDIUM");
    expect(result.rating).toBe("MEDIUM");
    expect(result.eddReasons).toEqual(["NON_RESIDENT"]);
  });

  it("rates a body in a high-risk jurisdiction High", () => {
    const result = assessOrganizationRisk({ ...ordinary, residenceCountry: "IR" });
    expect(result.rating).toBe("HIGH");
    expect(result.eddReasons).toEqual([
      "HIGH_RISK",
      "NON_RESIDENT",
      "HIGH_RISK_JURISDICTION",
    ]);
  });

  it("rates a body with a PEP High and wants EDD, whatever else is true (policy 7.2)", () => {
    const result = assessOrganizationRisk({
      ...ordinary,
      pepOutcome: "PEP",
      overrideRating: "LOW",
    });
    expect(result.isPep).toBe(true);
    expect(result.rating).toBe("HIGH");
    expect(result.eddReasons).toContain("PEP");
  });

  it("rates a complex structure High", () => {
    const result = assessOrganizationRisk({ ...ordinary, complexStructure: true });
    expect(result.rating).toBe("HIGH");
    expect(result.requiresEdd).toBe(true);
  });

  it("takes the reviewer's view of behaviour", () => {
    expect(
      assessOrganizationRisk({ ...ordinary, behaviour: "HIGH" }).rating,
    ).toBe("HIGH");
  });

  it("lets the MLRO set the rating, and flag EDD whatever it says", () => {
    expect(
      assessOrganizationRisk({ ...ordinary, expectedAmountKes: 5_000_000, overrideRating: "MEDIUM" })
        .rating,
    ).toBe("MEDIUM");
    const flagged = assessOrganizationRisk({ ...ordinary, mlroFlagged: true });
    expect(flagged.rating).toBe("MEDIUM");
    expect(flagged.eddReasons).toEqual(["MLRO_FLAGGED"]);
  });
});
