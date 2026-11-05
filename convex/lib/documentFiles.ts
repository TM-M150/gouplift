import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENT_BYTES,
} from "../../lib/organization-verification";

export type FileProblem = "MISSING" | "EMPTY" | "TYPE" | "SIZE";

export type StoredDocumentCheck =
  | { ok: true; contentType: string; size: number; uploadedAt: number }
  | { ok: false; reason: "MISSING" }
  | { ok: false; reason: Exclude<FileProblem, "MISSING">; uploadedAt: number };

/**
 * Checks a file that has reached Convex storage against the rules for
 * verification documents. The size is the real stored size. The content type
 * is the one the browser declared when it uploaded the file (storage keeps the
 * upload's Content-Type header); it is not detected from the file's bytes.
 *
 * Used both when a file is first registered and again when an organization is
 * submitted, so the two can never apply different rules.
 */
export async function checkStoredDocument(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
): Promise<StoredDocumentCheck> {
  const stored = await ctx.db.system.get("_storage", storageId);
  if (!stored) return { ok: false, reason: "MISSING" };

  const uploadedAt = stored._creationTime;
  const contentType = stored.contentType ?? "";

  if (stored.size === 0) return { ok: false, reason: "EMPTY", uploadedAt };
  if (
    !(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(
      contentType,
    )
  ) {
    return { ok: false, reason: "TYPE", uploadedAt };
  }
  if (stored.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: "SIZE", uploadedAt };
  }

  return { ok: true, contentType, size: stored.size, uploadedAt };
}

/** The message shown to the person when a file fails the check. */
export function describeFileProblem(
  reason: FileProblem,
  fileName: string,
): string {
  switch (reason) {
    case "MISSING":
      return `${fileName} wasn't uploaded properly. Please try again.`;
    case "EMPTY":
      return `${fileName} is empty. Please choose the right file.`;
    case "TYPE":
      return `${fileName} isn't a supported file. Use PDF, JPG, PNG or WebP.`;
    case "SIZE":
      return `${fileName} is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`;
  }
}

/**
 * Whether a stored file already belongs to a submission: an organization's
 * documents or an individual fundraiser's KYC documents. Anything that decides
 * a file is "unclaimed" (registering it, sweeping it) has to ask this, so a
 * file attached to one kind of submission is never mistaken for a stray.
 */
export async function isStorageAttached(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  const [organizationDocument, kycDocument] = await Promise.all([
    ctx.db
      .query("organizationDocuments")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first(),
    ctx.db
      .query("kycDocuments")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first(),
  ]);
  return organizationDocument !== null || kycDocument !== null;
}

/** The pending-upload row for a file, if someone has registered it. */
export async function findPendingUpload(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<"_storage">,
): Promise<Doc<"pendingUploads"> | null> {
  return await ctx.db
    .query("pendingUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
}
