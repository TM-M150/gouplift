"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  IconChevronDown,
  IconChevronRight,
  IconKey,
  IconPlus,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkWebhookUrl } from "@/lib/validations/webhook";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CopyButton } from "./copy-button";
import { errorMessage } from "./errors";
import { VerifyGuide } from "./verify-guide";

type Endpoint = NonNullable<
  FunctionReturnType<typeof api.webhooks.listEndpoints>
>[number];
type Delivery = NonNullable<
  FunctionReturnType<typeof api.webhooks.listDeliveries>
>[number];

const timeFormat = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "medium",
});

// ------------------------------------------------------------------ section

export function WebhooksSection({
  organizationId,
  isVerified,
}: {
  organizationId: Id<"organizations">;
  isVerified: boolean;
}) {
  // undefined while loading; null when the signed-in user isn't the owner.
  const endpoints = useQuery(api.webhooks.listEndpoints, { organizationId });
  const [adding, setAdding] = React.useState(false);
  const [reveal, setReveal] = React.useState<{
    heading: string;
    secret: string;
  } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          Get a signed message at your own server the moment a donation to one
          of your fundraisers completes, so you can update your records or
          thank donors without checking the dashboard.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {endpoints && (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!isVerified}
              onClick={() => setAdding(true)}
            >
              <IconPlus /> Add endpoint
            </Button>
          </div>
        )}

        {endpoints === undefined && (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {endpoints === null && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Only the organization&apos;s owner can manage webhooks, because
            they send donors&apos; names and messages to a server we don&apos;t
            control.
          </p>
        )}

        {endpoints && !isVerified && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Webhooks are available once your organization is verified.
          </p>
        )}

        {endpoints && endpoints.length === 0 && isVerified && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No endpoints yet. Add the HTTPS address of your server to start
            receiving events.
          </p>
        )}

        {endpoints?.map((endpoint) => (
          <EndpointRow
            key={endpoint._id}
            endpoint={endpoint}
            onSecret={(heading, secret) => setReveal({ heading, secret })}
          />
        ))}

        <VerifyGuide />
      </CardContent>

      <AddEndpointDialog
        organizationId={organizationId}
        open={adding}
        onOpenChange={setAdding}
        onCreated={(secret) =>
          setReveal({ heading: "Endpoint added", secret })
        }
      />
      <SecretDialog reveal={reveal} onClose={() => setReveal(null)} />
    </Card>
  );
}

// -------------------------------------------------------------- add endpoint

function AddEndpointDialog({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: Id<"organizations">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (secret: string) => void;
}) {
  const createEndpoint = useAction(api.webhooks.createEndpoint);
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setUrl("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // The same check the server makes, so mistakes show up without a round trip.
    const checked = checkWebhookUrl(url);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }

    setSubmitting(true);
    try {
      const { secret } = await createEndpoint({
        organizationId,
        url: checked.url,
      });
      handleOpenChange(false);
      onCreated(secret);
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
          <DialogTitle>Add a webhook endpoint</DialogTitle>
          <DialogDescription>
            The HTTPS address on your server that should receive events.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://example.org/gouplift-webhook"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-invalid={error ? true : undefined}
              required
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add endpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------- secret reveal

// The only time a signing secret is shown. Closing needs a deliberate click,
// not a stray tap on the backdrop.
function SecretDialog({
  reveal,
  onClose,
}: {
  reveal: { heading: string; secret: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={reveal !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{reveal?.heading ?? "Signing secret"}</DialogTitle>
          <DialogDescription>
            Copy this signing secret now and keep it somewhere safe, like an
            environment variable. You won&apos;t be able to see it again. If you
            lose it you can roll a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <code className="block rounded-lg bg-muted p-3 text-xs break-all select-all">
            {reveal?.secret}
          </code>
          {reveal && <CopyButton value={reveal.secret} label="Copy secret" />}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I&apos;ve saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------- confirm

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={confirm}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------- endpoint

function EndpointRow({
  endpoint,
  onSecret,
}: {
  endpoint: Endpoint;
  onSecret: (heading: string, secret: string) => void;
}) {
  const setActive = useMutation(api.webhooks.setEndpointActive);
  const sendTest = useMutation(api.webhooks.sendTestEvent);
  const deleteEndpoint = useMutation(api.webhooks.deleteEndpoint);
  const rollSecret = useAction(api.webhooks.rollSecret);

  const [showLog, setShowLog] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"roll" | "delete" | null>(null);

  async function toggle(isActive: boolean) {
    try {
      await setActive({ endpointId: endpoint._id, isActive });
      toast.success(isActive ? "Endpoint resumed." : "Endpoint paused.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function test() {
    try {
      await sendTest({ endpointId: endpoint._id });
      setShowLog(true);
      toast.success("Test event sent. It will appear in the log below.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1">
          <code className="block text-sm break-all">{endpoint.url}</code>
          <Badge variant={endpoint.isActive ? "default" : "outline"}>
            {endpoint.isActive ? "Active" : "Paused"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            checked={endpoint.isActive}
            onCheckedChange={toggle}
            aria-label={`Receive events at ${endpoint.url}`}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!endpoint.isActive}
            onClick={test}
          >
            <IconSend /> Send test
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirm("roll")}>
            <IconKey /> Roll secret
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirm("delete")}
          >
            <IconTrash /> Delete
          </Button>
        </div>
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-1 border-t px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={showLog}
        onClick={() => setShowLog((open) => !open)}
      >
        {showLog ? (
          <IconChevronDown className="size-4" />
        ) : (
          <IconChevronRight className="size-4" />
        )}
        Recent deliveries
      </button>
      {showLog && <DeliveryLog endpointId={endpoint._id} />}

      <ConfirmDialog
        open={confirm === "roll"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Roll the signing secret?"
        description="You'll get a new secret and the current one stops working immediately. Requests signed with the new one will fail verification on your server until you update it."
        confirmLabel="Roll secret"
        onConfirm={async () => {
          const { secret } = await rollSecret({ endpointId: endpoint._id });
          onSecret("New signing secret", secret);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this endpoint?"
        description="It will stop receiving events and its delivery log will be erased. This can't be undone."
        confirmLabel="Delete endpoint"
        destructive
        onConfirm={async () => {
          await deleteEndpoint({ endpointId: endpoint._id });
          toast.success("Endpoint deleted.");
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- delivery log

const STATUS_LABEL: Record<Delivery["status"], string> = {
  PENDING: "Pending",
  RETRYING: "Retrying",
  SUCCEEDED: "Delivered",
  FAILED: "Failed",
};

// Only delivered gets the strong colour and only failed gets the alarm colour;
// in between is neutral, so a paused or struggling endpoint never looks healthy.
const STATUS_VARIANT: Record<
  Delivery["status"],
  "default" | "outline" | "destructive"
> = {
  PENDING: "outline",
  RETRYING: "outline",
  SUCCEEDED: "default",
  FAILED: "destructive",
};

function resultText(delivery: Delivery): string {
  if (delivery.status === "SUCCEEDED") {
    return `HTTP ${delivery.lastStatusCode ?? 200}`;
  }
  if (delivery.status === "PENDING") return "Waiting to send";

  let reason = "—";
  switch (delivery.lastError) {
    case "timeout":
      reason = "No answer within 10 seconds";
      break;
    case "network_error":
      reason = "Couldn't connect, or the URL redirected";
      break;
    case "http_error":
      reason = `Your server answered HTTP ${delivery.lastStatusCode}`;
      break;
    case "endpoint_disabled":
      reason = "Endpoint was paused";
      break;
  }
  return delivery.status === "RETRYING" && delivery.nextAttemptAt
    ? `${reason}. Next try ${timeFormat.format(delivery.nextAttemptAt)}`
    : reason;
}

// One grid for both the header and every row. Below the sm breakpoint a row
// stacks into three short lines (event and time, status and action, result);
// from sm up it is a single aligned row.
const LOG_GRID = "sm:grid-cols-[10rem_7rem_1fr_11rem_5.5rem]";

function DeliveryLog({ endpointId }: { endpointId: Id<"webhookEndpoints"> }) {
  const deliveries = useQuery(api.webhooks.listDeliveries, { endpointId });
  const resend = useMutation(api.webhooks.resendDelivery);

  async function sendAgain(deliveryId: Id<"webhookDeliveries">) {
    try {
      await resend({ deliveryId });
      toast.success("Sending again.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (deliveries === undefined) {
    return <Skeleton className="m-3 h-16" />;
  }
  if (!deliveries || deliveries.length === 0) {
    return (
      <p className="border-t p-3 text-sm text-muted-foreground">
        Nothing sent yet. Use Send test to try it.
      </p>
    );
  }

  return (
    <div className="border-t">
      <div
        className={`hidden gap-x-3 border-b px-3 py-2 text-xs font-medium text-muted-foreground sm:grid ${LOG_GRID}`}
      >
        <span>Event</span>
        <span>Status</span>
        <span>Result</span>
        <span>When</span>
        <span />
      </div>
      <ul className="divide-y">
        {deliveries.map((delivery) => (
          <li
            key={delivery._id}
            className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${LOG_GRID}`}
          >
            <span className="font-mono text-xs sm:order-1">
              {delivery.eventType}
            </span>
            <time
              dateTime={new Date(delivery.createdAt).toISOString()}
              className="text-right text-xs whitespace-nowrap text-muted-foreground sm:order-4 sm:text-left"
            >
              {timeFormat.format(delivery.createdAt)}
            </time>
            <span className="flex items-center gap-2 sm:order-2">
              <Badge variant={STATUS_VARIANT[delivery.status]}>
                {STATUS_LABEL[delivery.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {delivery.attempts} {delivery.attempts === 1 ? "try" : "tries"}
              </span>
            </span>
            <span className="justify-self-end sm:order-5">
              {delivery.status === "FAILED" && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => sendAgain(delivery._id)}
                >
                  Send again
                </Button>
              )}
            </span>
            <span className="col-span-2 text-muted-foreground sm:order-3 sm:col-span-1">
              {resultText(delivery)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
