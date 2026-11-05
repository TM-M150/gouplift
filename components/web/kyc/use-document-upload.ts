"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Uploads verification files the way the organization form does: ask for an
 * upload URL, send the file, then register it so the server checks its type
 * and size. Files that already reached storage are remembered, so retrying a
 * failed submit doesn't upload them again.
 */
export function useDocumentUpload() {
  const generateUploadUrl = useMutation(
    api.documentUploads.generateDocumentUploadUrl,
  );
  const registerUpload = useMutation(
    api.documentUploads.registerDocumentUpload,
  );
  const discardUpload = useMutation(api.documentUploads.discardDocumentUpload);

  const uploadedIds = React.useRef(new WeakMap<File, Id<"_storage">>());

  const upload = React.useCallback(
    async (file: File): Promise<Id<"_storage">> => {
      const cached = uploadedIds.current.get(file);
      if (cached) return cached;

      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Couldn't upload ${file.name}. Please try again.`);
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };

      // A file that fails the checks is deleted by the server, so there is
      // nothing to remember or clean up.
      const registered = await registerUpload({
        storageId,
        fileName: file.name,
      });
      if (!registered.ok) throw new Error(registered.error);

      uploadedIds.current.set(file, storageId);
      return storageId;
    },
    [generateUploadUrl, registerUpload],
  );

  // Deletes files that were uploaded and then removed or replaced. Best effort:
  // if it fails, the server's clean-up of old uploads removes them instead.
  const discard = React.useCallback(
    (removed: File[]) => {
      for (const file of removed) {
        const storageId = uploadedIds.current.get(file);
        if (!storageId) continue;
        uploadedIds.current.delete(file);
        discardUpload({ storageId }).catch(() => undefined);
      }
    },
    [discardUpload],
  );

  return { upload, discard };
}
