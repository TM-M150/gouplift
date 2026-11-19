"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/components/web/admin/utils";
import {
  CommentItem,
  type CommentActions,
} from "@/components/web/fundraiser/fundraiser-comments";
import {
  checkCommentBody,
  checkGuestName,
  MAX_COMMENT_LENGTH,
  MAX_GUEST_NAME_LENGTH,
} from "@/lib/comments";
import { cn } from "@/lib/utils";

// The page behind the "Leave a comment" link in a receipt: for someone who gave
// without an account. The link is the only proof of who they are, so the page
// never mentions an address, and everything it does goes through that link.

export type GuestLink = NonNullable<
  FunctionReturnType<typeof api.guestComments.forToken>
>;
type CommentId = Id<"fundraiserComments">;

export interface GuestCommentActions {
  post: (input: { body: string; name: string }) => Promise<unknown>;
  edit: (commentId: CommentId, body: string) => Promise<unknown>;
  remove: (commentId: CommentId) => Promise<unknown>;
}

function GuestCommentForm({
  askName,
  initialName,
  onSubmit,
}: {
  askName: boolean;
  initialName: string;
  onSubmit: (input: { body: string; name: string }) => Promise<void>;
}) {
  const nameId = React.useId();
  const bodyId = React.useId();
  const [name, setName] = React.useState(initialName);
  const [text, setText] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [bodyError, setBodyError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const tooLong = text.length > MAX_COMMENT_LENGTH;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const checkedName = askName ? checkGuestName(name) : null;
    const checkedBody = checkCommentBody(text);
    setNameError(checkedName && !checkedName.ok ? checkedName.problem : null);
    setBodyError(checkedBody.ok ? null : checkedBody.problem);
    if ((checkedName && !checkedName.ok) || !checkedBody.ok) return;

    setSubmitting(true);
    try {
      await onSubmit({ body: checkedBody.body, name });
      setText("");
    } catch (err) {
      setBodyError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {askName && (
        <div className="space-y-2">
          <Label htmlFor={nameId}>Your first name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError(null);
            }}
            autoComplete="given-name"
            maxLength={MAX_GUEST_NAME_LENGTH + 10}
            disabled={submitting}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
          />
          {nameError && (
            <p
              id={`${nameId}-error`}
              role="alert"
              className="text-sm text-destructive"
            >
              {nameError}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={bodyId}>Your comment</Label>
        <Textarea
          id={bodyId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (bodyError) setBodyError(null);
          }}
          placeholder="Share a few words of support."
          className="min-h-24"
          maxLength={MAX_COMMENT_LENGTH + 200}
          disabled={submitting}
          aria-invalid={bodyError || tooLong ? true : undefined}
          aria-describedby={bodyError ? `${bodyId}-error` : undefined}
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
        {bodyError && (
          <p
            id={`${bodyId}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
            {bodyError}
          </p>
        )}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Working…" : "Post comment"}
      </Button>
    </form>
  );
}

// The card for one of their own comments has buttons for what staff and the
// organizer can do. None of them show for a comment that is the person's own,
// so these are never called.
async function notAvailableHere(): Promise<never> {
  throw new Error("This isn't available here.");
}

export interface GuestCommentViewProps {
  /** What the link points at: null for a link that isn't valid. */
  link: GuestLink | null;
  actions: GuestCommentActions;
}

/**
 * The words and the form, apart from Convex. The copy that carries a
 * fundraiser's title is built as a string so an apostrophe next to it can't
 * trip the JSX text handling.
 */
export function GuestCommentView({ link, actions }: GuestCommentViewProps) {
  const commentActions = React.useMemo<CommentActions>(
    () => ({
      post: notAvailableHere,
      edit: actions.edit,
      remove: actions.remove,
      hide: notAvailableHere,
      restore: notAvailableHere,
      report: notAvailableHere,
    }),
    [actions.edit, actions.remove],
  );

  if (link === null) {
    return (
      <div className="space-y-4 rounded-xl border bg-background p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          This link isn&apos;t valid
        </h1>
        <p className="text-muted-foreground">
          It may have been copied incompletely. Open the “Leave a comment” link
          in your receipt email again, or tap it instead of copying it.
        </p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to the homepage
        </Link>
      </div>
    );
  }

  const fundraiserHref =
    link.fundraiserId !== null ? `/fundraiser/${link.fundraiserId}` : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Leave a comment
        </h1>
        <p className="text-muted-foreground break-words">
          {fundraiserHref ? (
            <>
              {"On "}
              <Link
                href={fundraiserHref}
                className="font-medium text-foreground underline underline-offset-2"
              >
                {link.fundraiserTitle}
              </Link>
            </>
          ) : (
            `On ${link.fundraiserTitle}`
          )}
        </p>
      </header>

      {link.access === "CAN_COMMENT" ? (
        <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            {link.askName
              ? "It's shown on the fundraiser straight away, with your first name and last initial. Please don't share phone numbers or ask for money here."
              : "It's shown on the fundraiser straight away as “Anonymous donor”, because you gave anonymously. Please don't share phone numbers or ask for money here."}
          </p>
          <GuestCommentForm
            askName={link.askName}
            initialName={link.suggestedName}
            onSubmit={async (input) => {
              await actions.post(input);
              toast.success("Your comment is posted.");
            }}
          />
        </div>
      ) : (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          Comments can&apos;t be added to this fundraiser right now.
        </p>
      )}

      {link.comments.length > 0 && (
        <section aria-labelledby="your-comments" className="space-y-3">
          <h2
            id="your-comments"
            className="text-lg font-semibold tracking-tight"
          >
            Your comments
          </h2>
          {link.comments.map((comment) => (
            <CommentItem
              key={comment._id}
              comment={comment}
              isOwner={false}
              isStaff={false}
              signedIn={false}
              signInLink="/sign-in"
              actions={commentActions}
            />
          ))}
        </section>
      )}

      {link.hiddenCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {`${
            link.hiddenCount === 1
              ? "One of your comments has"
              : `${link.hiddenCount} of your comments have`
          } been hidden by the fundraiser's organizer or by GoUplift, so other people can't see ${
            link.hiddenCount === 1 ? "it" : "them"
          }. If you think that's a mistake, please `}
          <Link href="/help" className="underline underline-offset-2">
            get in touch
          </Link>
          .
        </p>
      )}

      <div className="space-y-3 border-t pt-4">
        {fundraiserHref && (
          <Link
            href={`${fundraiserHref}#comments`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            See the fundraiser
          </Link>
        )}
        <p className="text-xs text-muted-foreground">
          {
            "This page is private to you. Anyone who has this link can comment as you, so please don't share it."
          }
        </p>
      </div>
    </div>
  );
}

/** The page's content, wired to Convex. */
export function GuestCommentCard({ token }: { token: string }) {
  const link = useQuery(api.guestComments.forToken, { token });
  const post = useMutation(api.guestComments.post);
  const edit = useMutation(api.guestComments.edit);
  const remove = useMutation(api.guestComments.remove);

  const actions = React.useMemo<GuestCommentActions>(
    () => ({
      post: ({ body, name }) => post({ token, body, name }),
      edit: (commentId, body) => edit({ token, commentId, body }),
      remove: (commentId) => remove({ token, commentId }),
    }),
    [token, post, edit, remove],
  );

  if (link === undefined) {
    return (
      <div className="space-y-4 rounded-xl border bg-background p-6">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }

  return <GuestCommentView link={link} actions={actions} />;
}
