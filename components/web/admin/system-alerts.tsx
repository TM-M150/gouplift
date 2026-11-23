"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionDialog } from "@/components/web/admin/decision-dialog";
import { formatDateTime } from "@/components/web/admin/utils";
import { SYSTEM_ALERTS } from "@/lib/system-alerts";

export type AlertRow = FunctionReturnType<
  typeof api.systemAlerts.listOpen
>[number];

/** The help texts quote setup commands in backticks; show those as code. */
function Help({ text }: { text: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {text.split("`").map((part, index) =>
        index % 2 === 1 ? (
          <code
            key={index}
            className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all text-foreground"
          >
            {part}
          </code>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </p>
  );
}

function seenText(alert: AlertRow): string {
  return alert.count === 1
    ? `Seen once, ${formatDateTime(alert.firstSeenAt)}`
    : `Seen ${alert.count} times, first ${formatDateTime(alert.firstSeenAt)}, last ${formatDateTime(alert.lastSeenAt)}`;
}

/** One open problem. Shown by the page and, on its own, for previews. */
export function OpenAlert({
  alert,
  onResolve,
}: {
  alert: AlertRow;
  onResolve: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const { severity, title, help } = SYSTEM_ALERTS[alert.kind];

  return (
    <article className="space-y-3 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="min-w-0 font-medium break-words">{title}</h2>
        {severity === "ERROR" ? (
          <Badge variant="destructive">Needs action</Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          >
            Worth a look
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{seenText(alert)}</p>

      {(alert.detail || alert.reference) && (
        <dl className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
          {alert.detail && (
            <div>
              <dt className="sr-only">Details</dt>
              <dd className="break-words">{alert.detail}</dd>
            </div>
          )}
          {alert.reference && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="font-mono text-xs break-all">{alert.reference}</dd>
            </div>
          )}
        </dl>
      )}

      <Help text={help} />

      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Mark as resolved
      </Button>

      <DecisionDialog
        open={open}
        onOpenChange={setOpen}
        title="Mark this as resolved?"
        description="It comes off this list. If the same thing happens again, it comes back as a new alert."
        confirmLabel="Mark as resolved"
        noteLabel="What you did (optional)"
        notePlaceholder="e.g. Recorded the donation by hand from SasaPay"
        minNoteLength={0}
        onConfirm={onResolve}
      />
    </article>
  );
}

function ResolvedAlert({ alert }: { alert: AlertRow }) {
  return (
    <li className="space-y-1 py-3 text-sm">
      <p className="font-medium break-words">
        {SYSTEM_ALERTS[alert.kind].title}
      </p>
      <p className="text-xs text-muted-foreground">
        {alert.count === 1 ? "Seen once" : `Seen ${alert.count} times`}
        {alert.reference && (
          <>
            {" · "}
            <span className="font-mono break-all">{alert.reference}</span>
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        Resolved
        {alert.resolvedByName && ` by ${alert.resolvedByName}`}
        {alert.resolvedAt !== null && `, ${formatDateTime(alert.resolvedAt)}`}
      </p>
      {alert.resolveNote && (
        <p className="break-words whitespace-pre-line">{alert.resolveNote}</p>
      )}
    </li>
  );
}

/** What the page shows, given the data. Separate from the queries so it can be previewed. */
export function SystemAlertsView({
  open,
  resolved,
  emailsOn,
  onResolve,
}: {
  open: AlertRow[];
  resolved: AlertRow[];
  /** False when problems are only shown here, not emailed. */
  emailsOn: boolean | undefined;
  onResolve: (alertId: AlertRow["_id"], note: string) => Promise<void>;
}) {
  // The ones that mean money may not have been recorded come first.
  const ordered = [
    ...open.filter((alert) => SYSTEM_ALERTS[alert.kind].severity === "ERROR"),
    ...open.filter((alert) => SYSTEM_ALERTS[alert.kind].severity !== "ERROR"),
  ];

  return (
    <div className="space-y-6">
      {emailsOn === false && (
        <div
          role="note"
          className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <p className="font-medium">Problems are not being emailed.</p>
          <p>
            They show up here, but nobody hears about them until someone looks.
            To get an email for the serious ones, set{" "}
            <code className="font-mono text-xs">ALERT_EMAIL_TO</code> (one or
            more addresses, separated by commas) and{" "}
            <code className="font-mono text-xs">RESEND_API_KEY</code> with{" "}
            <code className="font-mono text-xs">npx convex env set</code>.
          </p>
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No payment problems are open.
        </p>
      ) : (
        <div className="space-y-3">
          <Badge variant="outline">
            {ordered.length === 1 ? "1 open" : `${ordered.length} open`}, most
            serious first
          </Badge>
          {ordered.map((alert) => (
            <OpenAlert
              key={alert._id}
              alert={alert}
              onResolve={(note) => onResolve(alert._id, note)}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="rounded-xl border bg-background px-4">
          <summary className="cursor-pointer py-3 text-sm font-medium">
            Recently resolved ({resolved.length})
          </summary>
          <ul className="divide-y border-t">
            {resolved.map((alert) => (
              <ResolvedAlert key={alert._id} alert={alert} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SystemAlerts() {
  const open = useQuery(api.systemAlerts.listOpen, {});
  const resolved = useQuery(api.systemAlerts.listResolved, {});
  const emailsOn = useQuery(api.systemAlerts.emailsOn, {});
  const resolve = useMutation(api.systemAlerts.resolve);

  if (open === undefined || resolved === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <SystemAlertsView
      open={open}
      resolved={resolved}
      emailsOn={emailsOn}
      onResolve={async (alertId, note) => {
        await resolve({ alertId, note: note || undefined });
        toast.success("Marked as resolved.");
      }}
    />
  );
}
