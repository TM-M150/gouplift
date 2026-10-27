"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/web/admin/utils";

interface DecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** When set, the dialog asks for a note and passes it to `onConfirm`. */
  noteLabel?: string;
  notePlaceholder?: string;
  minNoteLength?: number;
  onConfirm: (note: string) => Promise<void>;
}

export function DecisionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  noteLabel,
  notePlaceholder,
  minNoteLength = 1,
  onConfirm,
}: DecisionDialogProps) {
  const noteId = React.useId();
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const needsNote = noteLabel !== undefined;

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) {
      setNote("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    setError(null);
    const trimmed = note.trim();
    if (needsNote && trimmed.length < minNoteLength) {
      setError(
        minNoteLength <= 1
          ? "Add a note first."
          : `Write at least ${minNoteLength} characters.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(trimmed);
      setNote("");
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {needsNote && (
          <div className="space-y-2">
            <Label htmlFor={noteId}>{noteLabel}</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={notePlaceholder}
              className="min-h-28"
              disabled={submitting}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
