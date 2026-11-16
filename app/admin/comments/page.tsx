"use client";

import { ReportedCommentQueue } from "@/components/web/admin/comment-review";

export default function AdminCommentsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Comments</h1>
        <p className="text-sm text-muted-foreground">
          Comments that donors have reported. Hide one that breaks the rules,
          for example one that asks for money or details away from GoUplift,
          shares private information, or is abusive, or keep it up if it is
          fine. Organizers can hide comments on their own fundraisers too.
        </p>
      </div>

      <ReportedCommentQueue />
    </div>
  );
}
