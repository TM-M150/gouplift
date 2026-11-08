import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAdmin } from "./staff";

// The MLRO is the one person who can approve a PEP, a non-resident or any other
// customer who needs enhanced due diligence (AML policy 3.3, 7.2, 8). Until
// there is a dedicated MLRO role (step 7 of the AML plan), the MLRO is whoever
// is an admin. Every check goes through here, so that change is made in one
// place.

/** Whether this user can act as the MLRO. */
export function isMlro(user: Pick<Doc<"users">, "role">): boolean {
  return user.role === "ADMIN";
}

/** The signed-in MLRO. Throws for everyone else, including other staff. */
export async function requireMlro(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  try {
    return await requireAdmin(ctx);
  } catch {
    throw new ConvexError("Only the MLRO can do that.");
  }
}
