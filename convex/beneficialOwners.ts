import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { MAX_BENEFICIAL_OWNERS } from "../lib/beneficial-ownership";
import { beneficialOwnerSchema } from "../lib/validations/beneficial-owner";
import { logAction } from "./lib/adminAudit";
import { beneficialOwnerInputValidator } from "./lib/beneficialOwnerValidators";
import {
  getOrganizationRiskProfile,
  listBeneficialOwners,
  ownersLockedReason,
} from "./lib/organizationRisk";
import { requireStaff } from "./lib/staff";

// Staff keeping an organization's register of owners (AML policy 5.4, 6). The
// organization names its owners when it applies, and the reviewer corrects the
// list against the registry documents and the IDs. These only check what can
// be wrong whatever is added next; whether the whole register is acceptable
// (nobody listed, a senior managing official alongside owners) is checked when
// the organization is verified or rated.

export const addBeneficialOwner = mutation({
  args: {
    organizationId: v.id("organizations"),
    owner: beneficialOwnerInputValidator,
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new ConvexError("Organization not found.");
    const locked = ownersLockedReason(
      organization,
      staff,
      (await getOrganizationRiskProfile(ctx, organization._id)) !== null,
    );
    if (locked) throw new ConvexError(locked);

    const parsed = beneficialOwnerSchema.safeParse(args.owner);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Check the details you entered.",
      );
    }
    const owner = parsed.data;

    const existing = await listBeneficialOwners(ctx, organization._id);
    if (existing.length >= MAX_BENEFICIAL_OWNERS) {
      throw new ConvexError(`List at most ${MAX_BENEFICIAL_OWNERS} people.`);
    }
    if (
      existing.some(
        (e) => e.idType === owner.idType && e.idNumber === owner.idNumber,
      )
    ) {
      throw new ConvexError("That person is already listed.");
    }
    if (owner.basis === "OWNERSHIP") {
      const total = existing
        .filter((e) => e.basis === "OWNERSHIP")
        .reduce((sum, e) => sum + (e.ownershipPercent ?? 0), 0);
      if (total + (owner.ownershipPercent ?? 0) > 100 + 1e-9) {
        throw new ConvexError("The ownership shares would add up to more than 100%.");
      }
    }

    await ctx.db.insert("organizationBeneficialOwners", {
      organizationId: organization._id,
      ...owner,
      addedBy: staff._id,
      createdAt: Date.now(),
    });

    // The ID number is left out of the log: it is kept on the register only.
    await logAction(ctx, {
      actorId: staff._id,
      action: "BENEFICIAL_OWNER_ADDED",
      organizationId: organization._id,
      note: `${owner.fullName} (${owner.basis})`,
    });
  },
});

export const removeBeneficialOwner = mutation({
  args: { ownerId: v.id("organizationBeneficialOwners") },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);

    const owner = await ctx.db.get(args.ownerId);
    if (!owner) throw new ConvexError("That person isn't on the list.");
    const organization = await ctx.db.get(owner.organizationId);
    if (!organization) throw new ConvexError("Organization not found.");
    const locked = ownersLockedReason(
      organization,
      staff,
      (await getOrganizationRiskProfile(ctx, organization._id)) !== null,
    );
    if (locked) throw new ConvexError(locked);

    await ctx.db.delete(owner._id);

    await logAction(ctx, {
      actorId: staff._id,
      action: "BENEFICIAL_OWNER_REMOVED",
      organizationId: organization._id,
      note: `${owner.fullName} (${owner.basis})`,
    });
  },
});
