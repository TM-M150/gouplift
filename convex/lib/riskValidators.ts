import { v } from "convex/values";
import {
  EDD_REASONS,
  EXPECTED_TIMELINES,
  PEP_OUTCOMES,
  RISK_LEVELS,
} from "../../lib/risk";
import { literalUnion } from "./organizationValidators";

// Derived from the lists in lib/risk.ts, which the form and the review screen
// also use, so adding a level, a reason or a timeline there is all it takes.
export const riskLevelValidator = literalUnion(RISK_LEVELS);
export const pepOutcomeValidator = literalUnion(PEP_OUTCOMES);
export const expectedTimelineValidator = literalUnion(EXPECTED_TIMELINES);
export const eddReasonValidator = literalUnion(EDD_REASONS);

export const riskFactorsValidator = v.object({
  customerType: riskLevelValidator,
  expectedValue: riskLevelValidator,
  geography: riskLevelValidator,
  behaviour: riskLevelValidator,
});

// The enhanced due diligence record the MLRO writes (policy 7.2, 8.2).
export const eddRecordValidator = v.object({
  sourceOfFunds: v.string(),
  sourceOfWealth: v.optional(v.string()),
  note: v.optional(v.string()),
});
