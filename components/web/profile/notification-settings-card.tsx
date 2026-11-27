"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/components/web/admin/utils";
import { CardHeading } from "./card-heading";

export interface NotificationSettingsViewProps {
  /** Undefined while loading. */
  commentEmails: boolean | undefined;
  /** A change is being saved. */
  pending: boolean;
  onChange: (enabled: boolean) => void;
}

/** The words and the switch, apart from Convex. */
export function NotificationSettingsView({
  commentEmails,
  pending,
  onChange,
}: NotificationSettingsViewProps) {
  const labelId = React.useId();
  const hintId = React.useId();

  return (
    <Card>
      <CardHeading
        icon={Bell}
        title="Email notifications"
        description="Choose which emails about your fundraisers you get."
      />
      <CardContent>
        {commentEmails === undefined ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 text-sm">
              <p id={labelId} className="font-medium">
                Email me when donors comment on my fundraisers
              </p>
              <p id={hintId} className="text-muted-foreground">
                At most one email a day for each fundraiser, saying how many new
                comments there are and linking to them. It never includes the
                comments themselves.
              </p>
            </div>
            <Switch
              checked={commentEmails}
              disabled={pending}
              onCheckedChange={(checked) => onChange(checked)}
              aria-labelledby={labelId}
              aria-describedby={hintId}
              className="mt-0.5"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The settings card, wired to Convex. */
export function NotificationSettingsCard() {
  const profile = useQuery(api.users.getCurrentUserProfile);
  const setCommentEmails = useMutation(api.users.setCommentEmails);
  const [pending, setPending] = React.useState(false);

  async function handleChange(enabled: boolean) {
    setPending(true);
    try {
      // The switch follows the saved value, which updates by itself.
      await setCommentEmails({ enabled });
      toast.success(
        enabled
          ? "You'll get emails about new comments."
          : "You won't get emails about new comments.",
      );
    } catch (err) {
      toast.error("Couldn't save that", { description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <NotificationSettingsView
      commentEmails={profile ? profile.commentEmails : undefined}
      pending={pending}
      onChange={handleChange}
    />
  );
}
