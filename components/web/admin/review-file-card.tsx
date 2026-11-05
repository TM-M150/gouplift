"use client";

import { ExternalLink, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatSize } from "@/components/web/admin/utils";

interface ReviewFile {
  fileName: string;
  contentType: string;
  size: number;
  /** A short-lived signed URL, or null if the file is gone. */
  url: string | null;
}

/**
 * A document a reviewer has to look at: an inline preview for images, a link
 * to open anything else. The signed URL only ever comes from a staff query.
 */
export function ReviewFileCard({
  file,
  label,
}: {
  file: ReviewFile;
  label: string;
}) {
  const isImage = file.contentType.startsWith("image/");
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {file.fileName} · {formatSize(file.size)}
        </p>
      </div>

      {isImage && file.url ? (
        // Plain <img>: a short-lived storage URL, not something to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt={`${label}: ${file.fileName}`}
          className="max-h-72 w-full rounded-lg border bg-muted/30 object-contain"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <FileText className="size-4 shrink-0" />
          PDF — open it to read the document.
        </div>
      )}

      {file.url ? (
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink data-icon="inline-start" />
          Open file
        </a>
      ) : (
        <span className="text-xs text-destructive">File unavailable</span>
      )}
    </div>
  );
}
