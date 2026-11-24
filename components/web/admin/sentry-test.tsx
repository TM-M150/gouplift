"use client";

import * as React from "react";
import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Sends one harmless error to Sentry so staff can see that error monitoring
 * works on the live site, without having to break something on purpose.
 */
export function SentryTest() {
  const [sending, setSending] = React.useState(false);

  async function send() {
    if (!Sentry.isEnabled()) {
      toast.info(
        "Error monitoring is switched off here. It only runs on the live site.",
      );
      return;
    }
    setSending(true);
    try {
      Sentry.captureException(
        new Error("Test error sent from the System alerts page"),
      );
      const delivered = await Sentry.flush(5000);
      if (delivered) {
        toast.success("Sent. It should show up in Sentry within a minute.");
      } else {
        toast.error(
          "It couldn't be sent. Check the connection, then try again.",
        );
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-2 border-t pt-6">
      <h2 className="text-sm font-semibold">Error monitoring</h2>
      <p className="text-sm text-muted-foreground">
        Sentry tells us when a page breaks for a visitor. To check that it is
        working, send a test error from here and look for it in Sentry.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={send}
        disabled={sending}
      >
        {sending ? "Sending…" : "Send a test error"}
      </Button>
    </section>
  );
}
