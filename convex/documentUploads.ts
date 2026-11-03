import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import {
  checkStoredDocument,
  describeFileProblem,
  findPendingUpload,
} from "./lib/documentFiles";
import { consumeRateLimit } from "./lib/rateLimit";
import { getCurrentUserDoc } from "./lib/staff";

// Verification documents are national IDs, bank letters and the like, so a
// file never sits in storage unless it passed the checks and is either waiting
// for its owner to submit, or attached to a submission:
//
//   1. generateDocumentUploadUrl  - signed-in users only, rate limited
//   2. the browser uploads the file
//   3. registerDocumentUpload     - checks it; a file that fails is deleted now
//   4. createOrganization         - claims the registered files it is given
//   5. sweepStaleDocumentUploads  - deletes registered files nobody submitted
//
// Not covered: a file uploaded and never registered (the tab closed in between,
// or someone calling the upload URL directly) isn't tracked anywhere. The rate
// limit is what bounds how many of those one person can leave behind.

/** Most files one person can have registered but not yet submitted. */
const MAX_PENDING_UPLOADS_PER_USER = 30;
/** Upload URLs one person can request per hour. */
const UPLOAD_URL_LIMIT = { max: 40, windowMs: 60 * 60 * 1000 };
/** A file must be registered this soon after it is uploaded. */
const REGISTER_WITHIN_MS = 15 * 60 * 1000;
/** Registered files nobody submitted are deleted after this long. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 100;
const MAX_FILE_NAME_LENGTH = 200;

const NOT_FOUND = "That file wasn't uploaded properly. Please try again.";

type RegisterResult = { ok: true } | { ok: false; error: string };

export const generateDocumentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) {
      throw new ConvexError("You must be signed in to upload documents.");
    }

    const pending = await ctx.db
      .query("pendingUploads")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(MAX_PENDING_UPLOADS_PER_USER);
    if (pending.length >= MAX_PENDING_UPLOADS_PER_USER) {
      throw new ConvexError(
        "You have too many uploaded files waiting to be submitted. Submit your organization or remove some files first.",
      );
    }

    const limit = await consumeRateLimit(
      ctx,
      `document-upload:${user._id}`,
      UPLOAD_URL_LIMIT,
    );
    if (!limit.allowed) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfterMs / 60_000));
      throw new ConvexError(
        `You've uploaded a lot of files. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    return await ctx.storage.generateUploadUrl();
  },
});

// Returns a result instead of throwing for a bad file: a throw would roll back
// the deletion of that file, leaving it in storage.
export const registerDocumentUpload = mutation({
  args: { storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, args): Promise<RegisterResult> => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) {
      throw new ConvexError("You must be signed in to upload documents.");
    }

    const fileName =
      args.fileName.trim().slice(0, MAX_FILE_NAME_LENGTH) || "document";

    // Registering twice is harmless for the same person. Anyone else's file,
    // or one already attached to a submission, looks the same as a missing one
    // so storage ids can't be probed.
    const existing = await findPendingUpload(ctx, args.storageId);
    if (existing) {
      return existing.userId === user._id
        ? { ok: true }
        : { ok: false, error: NOT_FOUND };
    }
    const attached = await ctx.db
      .query("organizationDocuments")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    if (attached) return { ok: false, error: NOT_FOUND };

    const check = await checkStoredDocument(ctx, args.storageId);
    if (!check.ok && check.reason === "MISSING") {
      return { ok: false, error: NOT_FOUND };
    }

    // Only a file uploaded moments ago can be registered. This is checked
    // before anything is deleted, so an old file that belongs to someone else
    // (a profile photo, say) can never be registered, or deleted, from here.
    if (Date.now() - check.uploadedAt > REGISTER_WITHIN_MS) {
      return { ok: false, error: NOT_FOUND };
    }

    if (!check.ok) {
      await ctx.storage.delete(args.storageId);
      return { ok: false, error: describeFileProblem(check.reason, fileName) };
    }

    await ctx.db.insert("pendingUploads", {
      storageId: args.storageId,
      userId: user._id,
    });
    return { ok: true };
  },
});

// Called when someone removes or replaces a file they already uploaded. It does
// nothing for files that aren't theirs, or aren't registered.
export const discardDocumentUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<null> => {
    const user = await getCurrentUserDoc(ctx);
    if (!user) return null;

    const pending = await findPendingUpload(ctx, args.storageId);
    if (!pending || pending.userId !== user._id) return null;

    await ctx.db.delete(pending._id);
    if (await ctx.db.system.get("_storage", args.storageId)) {
      await ctx.storage.delete(args.storageId);
    }
    return null;
  },
});

// Run by crons.ts. Deletes registered files that were never submitted.
export const sweepStaleDocumentUploads = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    const stale = await ctx.db
      .query("pendingUploads")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(SWEEP_BATCH);

    for (const row of stale) {
      // A file that is part of a submission is never deleted here.
      const attached = await ctx.db
        .query("organizationDocuments")
        .withIndex("by_storageId", (q) => q.eq("storageId", row.storageId))
        .first();
      if (!attached && (await ctx.db.system.get("_storage", row.storageId))) {
        await ctx.storage.delete(row.storageId);
      }
      await ctx.db.delete(row._id);
    }

    if (stale.length === SWEEP_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.documentUploads.sweepStaleDocumentUploads,
        {},
      );
    }
    return null;
  },
});
