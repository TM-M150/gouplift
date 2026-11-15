"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import {
  errorMessage,
  formatDate,
  formatDateTime,
} from "@/components/web/admin/utils";
import { checkUpdateBody, MAX_UPDATE_LENGTH } from "@/lib/updates";

export type Update = FunctionReturnType<
  typeof api.fundraiserUpdates.list
>["page"][number];
export type HiddenUpdate = FunctionReturnType<
  typeof api.fundraiserUpdates.listHidden
>[number];
type UpdateId = Update["_id"];
/** What became of the request to email donors, as the server reports it. */
export type EmailResult = FunctionReturnType<
  typeof api.fundraiserUpdates.postUpdate
>["email"];

/** Everything the section can do. The real ones call Convex. */
export interface UpdateActions {
  post: (body: string, emailDonors: boolean) => Promise<{ email: EmailResult }>;
  edit: (updateId: UpdateId, body: string) => Promise<unknown>;
  remove: (updateId: UpdateId) => Promise<unknown>;
  hide: (updateId: UpdateId, reason: string) => Promise<unknown>;
  restore: (updateId: UpdateId) => Promise<unknown>;
}

/** What to tell the creator once their update is up. */
export function postedMessage(email: EmailResult): string {
  switch (email) {
    case "queued":
      return "Your update is posted, and your donors are being emailed.";
    case "throttled":
      return "Your update is posted. Donors weren't emailed again, because they were already emailed about an update in the last day.";
    case "unavailable":
      return "Your update is posted. Donors can't be emailed about this fundraiser right now.";
    default:
      return "Your update is posted.";
  }
}

/** The text of an update: line breaks kept, links not made clickable. */
function UpdateText({ body }: { body: string }) {
  return (
    <p className="text-base leading-relaxed break-words whitespace-pre-wrap">
      {body}
    </p>
  );
}

function UpdateForm({
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  offerEmail,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (body: string, emailDonors: boolean) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Offer to email the donors too. Only for a new update. */
  offerEmail?: boolean;
}) {
  const id = React.useId();
  const [text, setText] = React.useState(initial);
  const [emailDonors, setEmailDonors] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkUpdateBody(text);
    if (!checked.ok) {
      setError(checked.problem);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(checked.body, offerEmail === true && emailDonors);
      setText("");
      setEmailDonors(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={id} className="sr-only">
          Update
        </Label>
        <Textarea
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Tell donors how it is going: what has happened, what's next, what the money has done."
          className="min-h-28"
          maxLength={MAX_UPDATE_LENGTH + 500}
          disabled={submitting}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
        />
        <p className="text-xs text-muted-foreground">
          {text.length.toLocaleString("en-US")} /{" "}
          {MAX_UPDATE_LENGTH.toLocaleString("en-US")}
        </p>
      </div>

      {offerEmail && (
        <div className="flex items-start gap-3 rounded-lg border bg-background p-3">
          <Checkbox
            id={`${id}-email`}
            checked={emailDonors}
            onCheckedChange={(checked) => setEmailDonors(checked === true)}
            disabled={submitting}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor={`${id}-email`} className="leading-snug">
              Email the people who donated
            </Label>
            <p className="text-xs text-muted-foreground">
              They get a short email that there is a new update, with a link to
              read it here. The email doesn&apos;t include what you wrote.
              Donors are emailed about one update a day at most, and each email
              lets them unsubscribe.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Working…" : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function UpdateDate({ update }: { update: Update }) {
  return (
    <p className="text-sm text-muted-foreground">
      <time
        dateTime={new Date(update.createdAt).toISOString()}
        title={formatDateTime(update.createdAt)}
      >
        {formatDate(update.createdAt)}
      </time>
      {update.editedAt !== null && (
        <span title={`Edited ${formatDateTime(update.editedAt)}`}>
          {" "}
          · Edited
        </span>
      )}
    </p>
  );
}

function UpdateItem({
  update,
  isOwner,
  isStaff,
  actions,
}: {
  update: Update;
  isOwner: boolean;
  isStaff: boolean;
  actions: UpdateActions;
}) {
  const [editing, setEditing] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [hideOpen, setHideOpen] = React.useState(false);

  return (
    <article className="space-y-2 rounded-xl border bg-background p-4">
      <UpdateDate update={update} />

      {editing ? (
        <UpdateForm
          initial={update.body}
          submitLabel="Save changes"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await actions.edit(update._id, body);
            setEditing(false);
            toast.success("Update saved.");
          }}
        />
      ) : (
        <UpdateText body={update.body} />
      )}

      {!editing && (isOwner || isStaff) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {isOwner && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRemoveOpen(true)}
              >
                Remove
              </Button>
            </>
          )}
          {isStaff && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setHideOpen(true)}
            >
              Hide
            </Button>
          )}
        </div>
      )}

      <DecisionDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove this update?"
        description="It disappears for everyone, and it can't be brought back."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await actions.remove(update._id);
          toast.success("Update removed.");
        }}
      />

      <DecisionDialog
        open={hideOpen}
        onOpenChange={setHideOpen}
        title="Hide this update?"
        description="Only staff and its author can see it afterwards. The author is told it was hidden, but not why. Your reason goes in the audit log."
        confirmLabel="Hide"
        destructive
        noteLabel="Reason (for the audit log)"
        notePlaceholder="e.g. Asks donors to send money to a phone number"
        minNoteLength={10}
        onConfirm={async (reason) => {
          await actions.hide(update._id, reason);
          toast.success("Update hidden.");
        }}
      />
    </article>
  );
}

function HiddenItem({
  update,
  isStaff,
  actions,
}: {
  update: HiddenUpdate;
  isStaff: boolean;
  actions: UpdateActions;
}) {
  const [restoreOpen, setRestoreOpen] = React.useState(false);

  return (
    <article className="space-y-2 rounded-xl border border-dashed p-4">
      <p className="text-sm text-muted-foreground">
        Posted {formatDate(update.createdAt)}
        {update.hiddenAt !== null && `, hidden ${formatDate(update.hiddenAt)}`}
      </p>
      <UpdateText body={update.body} />

      {isStaff ? (
        <>
          {update.reason && (
            <p className="text-sm text-muted-foreground">
              Reason: {update.reason}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRestoreOpen(true)}
          >
            Restore
          </Button>
          <DecisionDialog
            open={restoreOpen}
            onOpenChange={setRestoreOpen}
            title="Put this update back?"
            description="Everyone who can see the fundraiser will be able to read it again."
            confirmLabel="Restore"
            onConfirm={async () => {
              await actions.restore(update._id);
              toast.success("Update restored.");
            }}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          GoUplift has hidden this update, so donors can&apos;t see it. If you
          think that&apos;s a mistake, please{" "}
          <Link href="/help" className="underline underline-offset-2">
            get in touch
          </Link>
          .
        </p>
      )}
    </article>
  );
}

export interface FundraiserUpdatesViewProps {
  /** The published updates loaded so far, newest first. */
  updates: {
    status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
    results: Update[];
    loadMore: (count: number) => void;
  };
  /** Hidden updates the viewer may see (staff: all; creator: their own). */
  hidden: HiddenUpdate[];
  isOwner: boolean;
  isStaff: boolean;
  /** Whether this fundraiser's status allows a new update. */
  canPost: boolean;
  /** Whether anyone has donated yet, so there is someone to email. */
  hasDonors: boolean;
  actions: UpdateActions;
}

/**
 * The progress updates of a fundraiser: what donors read to see how it is
 * going and, for the creator, where they post them. It shows nothing at all to
 * a visitor while there is nothing to read.
 */
export function FundraiserUpdatesView({
  updates,
  hidden,
  isOwner,
  isStaff,
  canPost,
  hasDonors,
  actions,
}: FundraiserUpdatesViewProps) {
  const loadingFirst = updates.status === "LoadingFirstPage";
  const showForm = isOwner && canPost;

  if (
    !loadingFirst &&
    updates.results.length === 0 &&
    !showForm &&
    hidden.length === 0
  ) {
    return null;
  }

  return (
    <section
      id="updates"
      aria-labelledby="updates-heading"
      className="space-y-4"
    >
      <h2
        id="updates-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Updates
      </h2>

      {showForm && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm font-medium">Post an update</p>
          <UpdateForm
            submitLabel="Post update"
            offerEmail={hasDonors}
            onSubmit={async (body, emailDonors) => {
              const { email } = await actions.post(body, emailDonors);
              toast.success(postedMessage(email));
            }}
          />
        </div>
      )}

      {loadingFirst ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-3">
          {updates.results.map((update) => (
            <UpdateItem
              key={update._id}
              update={update}
              isOwner={isOwner}
              isStaff={isStaff}
              actions={actions}
            />
          ))}
          {updates.status === "CanLoadMore" && (
            <Button variant="outline" onClick={() => updates.loadMore(10)}>
              Show older updates
            </Button>
          )}
          {updates.status === "LoadingMore" && (
            <Skeleton className="h-24 w-full" />
          )}
        </div>
      )}

      {hidden.length > 0 && (
        <details className="space-y-3 rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Hidden updates ({hidden.length})
          </summary>
          <div className="mt-3 space-y-3">
            {hidden.map((update) => (
              <HiddenItem
                key={update._id}
                update={update}
                isStaff={isStaff}
                actions={actions}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** The section wired to Convex. */
export function FundraiserUpdates({
  fundraiserId,
  creatorId,
  canPost,
  hasDonors,
}: {
  fundraiserId: Id<"fundraisers">;
  creatorId: Id<"users">;
  canPost: boolean;
  hasDonors: boolean;
}) {
  const me = useQuery(api.users.getCurrentUser);
  const isOwner = !!me && me._id === creatorId;
  const isStaff = me?.role === "ADMIN" || me?.role === "MODERATOR";

  const updates = usePaginatedQuery(
    api.fundraiserUpdates.list,
    { fundraiserId },
    { initialNumItems: 5 },
  );
  const hidden = useQuery(
    api.fundraiserUpdates.listHidden,
    isOwner || isStaff ? { fundraiserId } : "skip",
  );

  const post = useMutation(api.fundraiserUpdates.postUpdate);
  const edit = useMutation(api.fundraiserUpdates.editUpdate);
  const remove = useMutation(api.fundraiserUpdates.removeUpdate);
  const hide = useMutation(api.fundraiserUpdates.hideUpdate);
  const restore = useMutation(api.fundraiserUpdates.restoreUpdate);

  const actions = React.useMemo<UpdateActions>(
    () => ({
      post: (body, emailDonors) => post({ fundraiserId, body, emailDonors }),
      edit: (updateId, body) => edit({ updateId, body }),
      remove: (updateId) => remove({ updateId }),
      hide: (updateId, reason) => hide({ updateId, reason }),
      restore: (updateId) => restore({ updateId }),
    }),
    [fundraiserId, post, edit, remove, hide, restore],
  );

  return (
    <FundraiserUpdatesView
      updates={updates}
      hidden={hidden ?? []}
      isOwner={isOwner}
      isStaff={isStaff}
      canPost={canPost}
      hasDonors={hasDonors}
      actions={actions}
    />
  );
}
