import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  getKycDocumentSlots,
  maskIdNumber,
  tierPayoutLimitKes,
  type KycDocumentSlot,
  type KycDocumentType,
} from "../lib/kyc";
import {
  kycTier1DetailsSchema,
  kycTier2DetailsSchema,
} from "../lib/validations/kyc";
import {
  checkStoredDocument,
  describeFileProblem,
  findPendingUpload,
} from "./lib/documentFiles";
import { getApprovedKycSubmissions, highestKycTier } from "./lib/kycTier";
import {
  kycDocumentTypeValidator,
  kycIdTypeValidator,
} from "./lib/kycValidators";
import { expectedTimelineValidator } from "./lib/riskValidators";
import { getCurrentUserDoc } from "./lib/staff";

// Individual fundraisers are verified in tiers (AML policy 5.3). Each tier is
// one submission: the details and documents it asks for, reviewed by staff (see
// kycReview.ts). A user's tier is the highest one with an approved submission.
// The files are uploaded and registered first (documentUploads.ts) and claimed
// here, exactly as an organization's documents are.

const MAX_DOCUMENT_FILE_NAME_LENGTH = 200;

const submittedDocumentsValidator = v.array(
  v.object({
    documentType: kycDocumentTypeValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
  }),
);

type SubmittedDocument = {
  documentType: KycDocumentType;
  storageId: Id<"_storage">;
  fileName: string;
};

// What a person can see of their own verification. The full ID number never
// goes back to the browser, only its last three characters, and a rejection
// carries only the reason staff wrote for the applicant.
export const getMyKyc = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;

    const approved = await getApprovedKycSubmissions(ctx, user._id);
    const tier = highestKycTier(approved);
    const nextTier = tier === 0 ? 1 : tier === 1 ? 2 : null;

    const limit = tierPayoutLimitKes(tier);
    const tierOne = approved.find((s) => s.requestedTier === 1);

    const latest = await ctx.db
      .query("kycSubmissions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    return {
      tier,
      // null: no fixed cap (Tier 3).
      payoutLimitKes: Number.isFinite(limit) ? limit : null,
      nextTier,
      identity:
        tierOne?.legalName && tierOne.idType && tierOne.idNumber
          ? {
              legalName: tierOne.legalName,
              idType: tierOne.idType,
              idNumberMasked: maskIdNumber(tierOne.idNumber),
              phoneNumber: tierOne.phoneNumber ?? null,
            }
          : null,
      pending:
        latest?.status === "PENDING_REVIEW"
          ? {
              requestedTier: latest.requestedTier,
              submittedAt: latest.submittedAt,
            }
          : null,
      // Only the latest attempt at the tier they are working towards.
      rejection:
        latest?.status === "REJECTED" && latest.requestedTier === nextTier
          ? {
              requestedTier: latest.requestedTier,
              reason: latest.rejectionReason ?? null,
              reviewedAt: latest.reviewedAt ?? null,
            }
          : null,
    };
  },
});

async function requireUserForSubmission(ctx: MutationCtx) {
  const user = await getCurrentUserDoc(ctx);
  if (!user) {
    throw new ConvexError("You must be signed in to verify your identity.");
  }
  return user;
}

// One application at a time. Two submissions racing past this check conflict on
// the index range they both read, so one of them is retried and then refused.
async function assertNothingPending(ctx: MutationCtx, userId: Id<"users">) {
  const pending = await ctx.db
    .query("kycSubmissions")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", "PENDING_REVIEW"),
    )
    .first();
  if (pending) {
    throw new ConvexError("Your verification is already being reviewed.");
  }
}

// Same three steps as createOrganization: check the shape against the tier's
// slots, check every file is one this user registered and still passes the
// file rules in storage, then (once the caller has saved the submission) the
// returned pending rows are deleted so the files stop being "pending".
async function verifyDocuments(
  ctx: MutationCtx,
  userId: Id<"users">,
  slots: KycDocumentSlot[],
  documents: SubmittedDocument[],
) {
  const slotByType = new Map(slots.map((slot) => [slot.documentType, slot]));
  const countByType = new Map<KycDocumentType, number>();
  const seenStorageIds = new Set<string>();

  for (const doc of documents) {
    const slot = slotByType.get(doc.documentType);
    if (!slot) {
      throw new ConvexError(
        "A document was attached that isn't needed for this step.",
      );
    }

    const count = (countByType.get(doc.documentType) ?? 0) + 1;
    if (count > slot.maxFiles) {
      throw new ConvexError(
        `${slot.label}: you can upload at most ${slot.maxFiles} file${slot.maxFiles === 1 ? "" : "s"}.`,
      );
    }
    countByType.set(doc.documentType, count);

    if (seenStorageIds.has(doc.storageId)) {
      throw new ConvexError("The same file was attached more than once.");
    }
    seenStorageIds.add(doc.storageId);
  }

  const missing = slots.filter(
    (slot) => slot.required && !countByType.has(slot.documentType),
  );
  if (missing.length > 0) {
    throw new ConvexError(
      `Missing required documents: ${missing.map((slot) => slot.label).join(", ")}.`,
    );
  }

  const verified: Array<{
    documentType: KycDocumentType;
    storageId: Id<"_storage">;
    fileName: string;
    contentType: string;
    size: number;
  }> = [];
  const claimedUploads: Array<Id<"pendingUploads">> = [];

  for (const doc of documents) {
    const fileName =
      doc.fileName.trim().slice(0, MAX_DOCUMENT_FILE_NAME_LENGTH) ||
      "document";

    const pending = await findPendingUpload(ctx, doc.storageId);
    if (!pending || pending.userId !== userId) {
      throw new ConvexError(describeFileProblem("MISSING", fileName));
    }

    const check = await checkStoredDocument(ctx, doc.storageId);
    if (!check.ok) {
      throw new ConvexError(describeFileProblem(check.reason, fileName));
    }

    verified.push({
      documentType: doc.documentType,
      storageId: doc.storageId,
      fileName,
      contentType: check.contentType,
      size: check.size,
    });
    claimedUploads.push(pending._id);
  }

  return { verified, claimedUploads };
}

async function saveDocuments(
  ctx: MutationCtx,
  submissionId: Id<"kycSubmissions">,
  userId: Id<"users">,
  checked: Awaited<ReturnType<typeof verifyDocuments>>,
) {
  const now = Date.now();
  for (const doc of checked.verified) {
    await ctx.db.insert("kycDocuments", {
      submissionId,
      userId,
      ...doc,
      createdAt: now,
    });
  }
  for (const pendingId of checked.claimedUploads) {
    await ctx.db.delete(pendingId);
  }
}

// Tier 1: who you are (policy 5.3). ID photo(s), the ID's details, a mobile
// number in your own name, what the money is for, and the declarations the risk
// rating starts from (policy 5.7, 7, 9): where you live, what you expect to
// raise, whether you are a PEP, and that the purpose isn't a prohibited one.
export const submitKycTier1 = mutation({
  args: {
    legalName: v.string(),
    idType: kycIdTypeValidator,
    idNumber: v.string(),
    phoneNumber: v.string(),
    campaignPurpose: v.string(),
    residenceCountry: v.string(),
    expectedAmountKes: v.number(),
    expectedTimeline: expectedTimelineValidator,
    pepDeclared: v.boolean(),
    pepDetails: v.optional(v.string()),
    prohibitedActivitiesAcknowledged: v.boolean(),
    documents: submittedDocumentsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUserForSubmission(ctx);

    const tier = highestKycTier(await getApprovedKycSubmissions(ctx, user._id));
    if (tier >= 1) {
      throw new ConvexError("You've already verified your identity.");
    }
    await assertNothingPending(ctx, user._id);

    const parsed = kycTier1DetailsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Check the details you entered.",
      );
    }
    const details = parsed.data;

    const checked = await verifyDocuments(
      ctx,
      user._id,
      getKycDocumentSlots(1, details.idType),
      args.documents,
    );

    const submissionId = await ctx.db.insert("kycSubmissions", {
      userId: user._id,
      requestedTier: 1,
      status: "PENDING_REVIEW",
      legalName: details.legalName,
      idType: details.idType,
      idNumber: details.idNumber,
      phoneNumber: details.phoneNumber,
      campaignPurpose: details.campaignPurpose,
      residenceCountry: details.residenceCountry,
      expectedAmountKes: details.expectedAmountKes,
      expectedTimeline: details.expectedTimeline,
      pepDeclared: details.pepDeclared,
      // Details of a PEP only make sense for someone who said they are one.
      pepDetails: details.pepDeclared ? details.pepDetails : undefined,
      prohibitedActivitiesAcknowledged: details.prohibitedActivitiesAcknowledged,
      submittedAt: Date.now(),
    });
    await saveDocuments(ctx, submissionId, user._id, checked);

    return { submissionId };
  },
});

// Tier 2: what the money is for, and where it goes (policy 5.3). Evidence for
// the campaign, a KRA PIN and proof of the payout account.
export const submitKycTier2 = mutation({
  args: {
    kraPin: v.string(),
    documents: submittedDocumentsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireUserForSubmission(ctx);

    const tier = highestKycTier(await getApprovedKycSubmissions(ctx, user._id));
    if (tier < 1) {
      throw new ConvexError("Verify your identity (Tier 1) first.");
    }
    if (tier >= 2) {
      throw new ConvexError("You've already reached this verification level.");
    }
    await assertNothingPending(ctx, user._id);

    const parsed = kycTier2DetailsSchema.safeParse(args);
    if (!parsed.success) {
      throw new ConvexError(
        parsed.error.issues[0]?.message ?? "Check the details you entered.",
      );
    }

    const checked = await verifyDocuments(
      ctx,
      user._id,
      getKycDocumentSlots(2),
      args.documents,
    );

    const submissionId = await ctx.db.insert("kycSubmissions", {
      userId: user._id,
      requestedTier: 2,
      status: "PENDING_REVIEW",
      kraPin: parsed.data.kraPin,
      submittedAt: Date.now(),
    });
    await saveDocuments(ctx, submissionId, user._id, checked);

    return { submissionId };
  },
});
