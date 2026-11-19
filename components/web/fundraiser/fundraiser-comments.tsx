"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import {
  errorMessage,
  formatDate,
  formatDateTime,
} from "@/components/web/admin/utils";
import {
  checkCommentBody,
  MAX_COMMENT_LENGTH,
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  type ReportReason,
} from "@/lib/comments";
import { signInHref } from "@/lib/safe-redirect";

export type CommentRow = FunctionReturnType<
  typeof api.fundraiserComments.list
>["page"][number];
export type HiddenComment = FunctionReturnType<
  typeof api.fundraiserComments.listHidden
>[number];
export type CommentAccess = FunctionReturnType<
  typeof api.fundraiserComments.myAccess
>;
type CommentId = CommentRow["_id"];

/** Everything the section can do. The real ones call Convex. */
export interface CommentActions {
  post: (body: string) => Promise<unknown>;
  edit: (commentId: CommentId, body: string) => Promise<unknown>;
  remove: (commentId: CommentId) => Promise<unknown>;
  /** The reason is only asked of staff; the creator passes an empty one. */
  hide: (commentId: CommentId, reason: string) => Promise<unknown>;
  restore: (commentId: CommentId) => Promise<unknown>;
  report: (commentId: CommentId, reason: ReportReason) => Promise<unknown>;
}

/** The text of a comment: line breaks kept, links not made clickable. */
function CommentText({ body }: { body: string }) {
  return (
    <p className="text-base leading-relaxed break-words whitespace-pre-wrap">
      {body}
    </p>
  );
}

function CommentForm({
  initial = "",
  submitLabel,
  placeholder,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  initial?: string;
  submitLabel: string;
  placeholder?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const id = React.useId();
  const [text, setText] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const tooLong = text.length > MAX_COMMENT_LENGTH;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkCommentBody(text);
    if (!checked.ok) {
      setError(checked.problem);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(checked.body);
      setText("");
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
          Your comment
        </Label>
        <Textarea
          id={id}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // The message was about the text as it was.
            if (error) setError(null);
          }}
          placeholder={placeholder}
          className="min-h-24"
          maxLength={MAX_COMMENT_LENGTH + 200}
          disabled={submitting}
          autoFocus={autoFocus}
          aria-invalid={error || tooLong ? true : undefined}
        />
        <p
          className={
            tooLong
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {text.length.toLocaleString("en-US")} /{" "}
          {MAX_COMMENT_LENGTH.toLocaleString("en-US")}
        </p>
      </div>

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

function ReportDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: ReportReason) => Promise<void>;
}) {
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) {
      setReason(null);
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit() {
    if (!reason) {
      setError("Choose what's wrong with it.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(reason);
      setReason(null);
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
          <DialogTitle>Report this comment</DialogTitle>
          <DialogDescription>
            GoUplift staff will take a look. The person who wrote it isn&apos;t
            told who reported it.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={reason ?? ""}
          onValueChange={(value) => setReason(value as ReportReason)}
          aria-label="What's wrong with this comment?"
          disabled={submitting}
        >
          {REPORT_REASONS.map((value) => (
            <Label
              key={value}
              className="flex items-center gap-3 rounded-lg border p-3 font-normal"
            >
              <RadioGroupItem value={value} />
              {REPORT_REASON_LABELS[value]}
            </Label>
          ))}
        </RadioGroup>

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
          <Button type="button" disabled={submitting} onClick={handleSubmit}>
            {submitting ? "Working…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CommentItem({
  comment,
  isOwner,
  isStaff,
  signedIn,
  signInLink,
  actions,
}: {
  comment: CommentRow;
  isOwner: boolean;
  isStaff: boolean;
  signedIn: boolean;
  /** Where signing in leads back to this section. */
  signInLink: string;
  actions: CommentActions;
}) {
  const [editing, setEditing] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [hideOpen, setHideOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);

  const canHide = (isOwner || isStaff) && !comment.mine;
  // Staff have Hide, which is the stronger thing; everyone else can report.
  const canReport = !comment.mine && !isStaff;

  return (
    <article className="space-y-2 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-medium break-words">{comment.authorName}</p>
        <p className="text-sm text-muted-foreground">
          <time
            dateTime={new Date(comment.createdAt).toISOString()}
            title={formatDateTime(comment.createdAt)}
          >
            {formatDate(comment.createdAt)}
          </time>
          {comment.editedAt !== null && (
            <span title={`Edited ${formatDateTime(comment.editedAt)}`}>
              {" "}
              · Edited
            </span>
          )}
        </p>
      </div>

      {editing ? (
        <CommentForm
          initial={comment.body}
          submitLabel="Save changes"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await actions.edit(comment._id, body);
            setEditing(false);
            toast.success("Comment saved.");
          }}
        />
      ) : (
        <CommentText body={comment.body} />
      )}

      {!editing && (comment.mine || canHide || canReport) && (
        <div className="-ml-2 flex flex-wrap gap-1 pt-1">
          {comment.mine && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRemoveOpen(true)}
              >
                Remove
              </Button>
            </>
          )}
          {canHide && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setHideOpen(true)}
            >
              Hide
            </Button>
          )}
          {canReport &&
            (signedIn ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReportOpen(true)}
              >
                Report
              </Button>
            ) : (
              <Link
                href={signInLink}
                title="Sign in to report this comment"
                className={buttonVariants({ size: "sm", variant: "ghost" })}
              >
                Report
              </Link>
            ))}
        </div>
      )}

      <DecisionDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove your comment?"
        description="It disappears for everyone, and it can't be brought back."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await actions.remove(comment._id);
          toast.success("Comment removed.");
        }}
      />

      {isStaff ? (
        <DecisionDialog
          open={hideOpen}
          onOpenChange={setHideOpen}
          title="Hide this comment?"
          description="It comes off the page. The person who wrote it and the fundraiser's organizer can still see it under Hidden comments, and the organizer isn't shown your reason. It goes in the audit log."
          confirmLabel="Hide"
          destructive
          noteLabel="Reason (for the audit log)"
          notePlaceholder="e.g. Asks donors to send money to a phone number"
          minNoteLength={10}
          onConfirm={async (reason) => {
            await actions.hide(comment._id, reason);
            toast.success("Comment hidden.");
          }}
        />
      ) : (
        <DecisionDialog
          open={hideOpen}
          onOpenChange={setHideOpen}
          title="Hide this comment?"
          description="It comes off the page. Only you and the person who wrote it can see it afterwards, and you can put it back from Hidden comments whenever you like."
          confirmLabel="Hide"
          destructive
          onConfirm={async () => {
            await actions.hide(comment._id, "");
            toast.success("Comment hidden.");
          }}
        />
      )}

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        onSubmit={async (reason) => {
          await actions.report(comment._id, reason);
          toast.success("Thanks. We'll take a look.");
        }}
      />
    </article>
  );
}

function HiddenItem({
  comment,
  isOwner,
  actions,
}: {
  comment: HiddenComment;
  isOwner: boolean;
  actions: CommentActions;
}) {
  const [restoreOpen, setRestoreOpen] = React.useState(false);

  return (
    <article className="space-y-2 rounded-xl border border-dashed p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-medium break-words">{comment.authorName}</p>
        <p className="text-sm text-muted-foreground">
          Posted {formatDate(comment.createdAt)}
          {comment.hiddenAt !== null &&
            `, hidden ${formatDate(comment.hiddenAt)}`}
        </p>
      </div>
      <CommentText body={comment.body} />

      {comment.hiddenBy !== null ? (
        <p className="text-sm text-muted-foreground">
          {comment.hiddenBy === "STAFF"
            ? "Hidden by GoUplift staff."
            : isOwner
              ? "You hid this comment."
              : "Hidden by the organizer."}
          {comment.reason && ` Reason: ${comment.reason}`}
          {!comment.canRestore && " Only GoUplift staff can put it back."}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          This comment has been hidden, so other people can&apos;t see it. If
          you think that&apos;s a mistake, please{" "}
          <Link href="/help" className="underline underline-offset-2">
            get in touch
          </Link>
          .
        </p>
      )}

      {comment.canRestore && (
        <>
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
            title="Put this comment back?"
            description="Everyone who can see the fundraiser will be able to read it again."
            confirmLabel="Restore"
            onConfirm={async () => {
              await actions.restore(comment._id);
              toast.success("Comment restored.");
            }}
          />
        </>
      )}
    </article>
  );
}

/** What stands in place of the comment box for someone who can't use it. */
function WhyNotComment({
  access,
  signInLink,
}: {
  access: CommentAccess;
  signInLink: string;
}) {
  if (access === "SIGNED_OUT") {
    return (
      <p className="text-sm text-muted-foreground">
        Donated to this fundraiser?{" "}
        <Link href={signInLink} className="underline underline-offset-2">
          Sign in
        </Link>{" "}
        to leave a comment. {"If you gave without an account, use the “Leave a comment” link in your receipt email."}
      </p>
    );
  }
  if (access === "NOT_A_DONOR") {
    return (
      <p className="text-sm text-muted-foreground">
        People who have donated to this fundraiser can leave a comment here.
      </p>
    );
  }
  return null;
}

export interface FundraiserCommentsViewProps {
  /** The published comments loaded so far, newest first. */
  comments: {
    status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
    results: CommentRow[];
    loadMore: (count: number) => void;
  };
  /** Hidden comments the viewer may see (staff and the creator: all; an author: their own). */
  hidden: HiddenComment[];
  /** What the viewer can do here. Undefined while it is still loading. */
  access: CommentAccess | undefined;
  signedIn: boolean;
  /** The creator of the fundraiser. */
  isOwner: boolean;
  isStaff: boolean;
  actions: CommentActions;
}

/**
 * What donors have said on a fundraiser, and where a donor says something.
 * It shows nothing at all to a visitor while there is nothing to read and
 * nobody can comment.
 */
export function FundraiserCommentsView({
  comments,
  hidden,
  access,
  signedIn,
  isOwner,
  isStaff,
  actions,
}: FundraiserCommentsViewProps) {
  // Signing in from here brings them back to this section.
  const pathname = usePathname();
  const signInLink = signInHref(`${pathname ?? ""}#comments`);

  // Wait for everything before showing anything, so the comment box doesn't
  // flash "sign in" at someone who is signed in.
  if (comments.status === "LoadingFirstPage" || access === undefined) {
    return null;
  }

  if (
    comments.results.length === 0 &&
    hidden.length === 0 &&
    access === "CLOSED"
  ) {
    return null;
  }

  return (
    <section
      id="comments"
      aria-labelledby="comments-heading"
      className="space-y-4"
    >
      <h2
        id="comments-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Comments
      </h2>

      {access === "CAN_COMMENT" ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Leave a comment</p>
            <p className="text-xs text-muted-foreground">
              Shown with your first name and last initial, or as an anonymous
              donor if you gave anonymously. Please don&apos;t share phone
              numbers or ask for money here.
            </p>
          </div>
          <CommentForm
            submitLabel="Post comment"
            placeholder="Share a few words of support."
            onSubmit={async (body) => {
              await actions.post(body);
              toast.success("Your comment is posted.");
            }}
          />
        </div>
      ) : (
        <WhyNotComment access={access} signInLink={signInLink} />
      )}

      {comments.results.length === 0 && access === "CAN_COMMENT" && (
        <p className="text-sm text-muted-foreground">
          No comments yet. Be the first.
        </p>
      )}

      {comments.results.length > 0 && (
        <div className="space-y-3">
          {comments.results.map((comment) => (
            <CommentItem
              key={comment._id}
              comment={comment}
              isOwner={isOwner}
              isStaff={isStaff}
              signedIn={signedIn}
              signInLink={signInLink}
              actions={actions}
            />
          ))}
          {comments.status === "CanLoadMore" && (
            <Button variant="outline" onClick={() => comments.loadMore(10)}>
              Show older comments
            </Button>
          )}
          {comments.status === "LoadingMore" && (
            <Skeleton className="h-24 w-full" />
          )}
        </div>
      )}

      {hidden.length > 0 && (
        <details className="space-y-3 rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {isOwner || isStaff ? "Hidden comments" : "Your hidden comments"} (
            {hidden.length})
          </summary>
          <div className="mt-3 space-y-3">
            {hidden.map((comment) => (
              <HiddenItem
                key={comment._id}
                comment={comment}
                isOwner={isOwner}
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
export function FundraiserComments({
  fundraiserId,
  creatorId,
}: {
  fundraiserId: Id<"fundraisers">;
  creatorId: Id<"users">;
}) {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.getCurrentUser);
  const isOwner = !!me && me._id === creatorId;
  const isStaff = me?.role === "ADMIN" || me?.role === "MODERATOR";

  const comments = usePaginatedQuery(
    api.fundraiserComments.list,
    { fundraiserId },
    { initialNumItems: 10 },
  );
  const accessResult = useQuery(api.fundraiserComments.myAccess, {
    fundraiserId,
  });
  // Anyone signed in may have a comment of their own that was hidden.
  const hidden = useQuery(
    api.fundraiserComments.listHidden,
    isAuthenticated ? { fundraiserId } : "skip",
  );

  const post = useMutation(api.fundraiserComments.postComment);
  const edit = useMutation(api.fundraiserComments.editComment);
  const remove = useMutation(api.fundraiserComments.removeComment);
  const hide = useMutation(api.fundraiserComments.hideComment);
  const restore = useMutation(api.fundraiserComments.restoreComment);
  const report = useMutation(api.fundraiserComments.reportComment);

  const actions = React.useMemo<CommentActions>(
    () => ({
      post: (body) => post({ fundraiserId, body }),
      edit: (commentId, body) => edit({ commentId, body }),
      remove: (commentId) => remove({ commentId }),
      hide: (commentId, reason) =>
        hide({ commentId, reason: reason || undefined }),
      restore: (commentId) => restore({ commentId }),
      report: (commentId, reason) => report({ commentId, reason }),
    }),
    [fundraiserId, post, edit, remove, hide, restore, report],
  );

  // Until the sign-in state settles, the answers describe a signed-out visitor.
  const settled = !authLoading && me !== undefined;

  return (
    <FundraiserCommentsView
      comments={comments}
      hidden={hidden ?? []}
      access={settled ? accessResult : undefined}
      signedIn={isAuthenticated}
      isOwner={isOwner}
      isStaff={isStaff}
      actions={actions}
    />
  );
}
