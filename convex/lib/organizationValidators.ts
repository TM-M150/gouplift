import { v } from "convex/values";
import {
  DOCUMENT_TYPES,
  ORGANIZATION_TYPES,
} from "../../lib/organization-verification";

// Builds a `v.union` of literals from a const tuple so the Convex validators
// are derived from the same lists the form and zod schema use. Adding a
// document or organization type in lib/organization-verification.ts is all
// it takes — the schema and function args follow.
function literalUnion<T extends string>(values: readonly [T, T, ...T[]]) {
  const [first, second, ...rest] = values;
  return v.union(
    v.literal(first),
    v.literal(second),
    ...rest.map((value) => v.literal(value)),
  );
}

export const documentTypeValidator = literalUnion(DOCUMENT_TYPES);
export const organizationTypeValidator = literalUnion(ORGANIZATION_TYPES);
