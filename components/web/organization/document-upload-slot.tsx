"use client";

import * as React from "react";
import { FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_FILE_INPUT,
  validateDocumentFile,
  type DocumentSlot,
} from "@/lib/organization-verification";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentUploadSlotProps {
  slot: DocumentSlot;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** Highlights the slot, e.g. when a required document is missing on submit. */
  invalid?: boolean;
}

export function DocumentUploadSlot({
  slot,
  files,
  onChange,
  disabled,
  invalid,
}: DocumentUploadSlotProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const isSingle = slot.maxFiles === 1;
  const remaining = slot.maxFiles - files.length;

  function handleSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    // Clear the input so choosing the same file again (after removing it) still fires.
    event.target.value = "";
    if (picked.length === 0) return;

    const accepted: File[] = [];
    for (const file of picked) {
      const problem = validateDocumentFile(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    // A single-file slot replaces what's there; a multi-file slot adds to it.
    if (isSingle) {
      onChange([accepted[0]]);
      return;
    }

    const fresh = accepted.filter(
      (file) =>
        !files.some(
          (existing) =>
            existing.name === file.name && existing.size === file.size,
        ),
    );
    if (fresh.length > remaining) {
      toast.error(
        `${slot.label}: you can upload up to ${slot.maxFiles} files.`,
      );
    }
    onChange([...files, ...fresh.slice(0, remaining)]);
  }

  function removeFile(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  const buttonLabel = isSingle
    ? files.length > 0
      ? "Replace file"
      : "Choose file"
    : files.length > 0
      ? "Add another file"
      : "Choose files";

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border p-4",
        invalid && "border-destructive",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p id={titleId} className="text-sm font-medium">
            {slot.label}
          </p>
          <p className="text-xs text-muted-foreground">{slot.description}</p>
        </div>
        <Badge variant={slot.required ? "secondary" : "outline"}>
          {slot.required ? "Required" : "Optional"}
        </Badge>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => removeFile(index)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept={ACCEPTED_FILE_INPUT}
        multiple={!isSingle}
        disabled={disabled}
        aria-labelledby={titleId}
        onChange={handleSelect}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || (!isSingle && remaining <= 0)}
        onClick={() => inputRef.current?.click()}
      >
        <Upload data-icon="inline-start" />
        {buttonLabel}
      </Button>
    </div>
  );
}
