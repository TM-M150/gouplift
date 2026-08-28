"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

// Kept deliberately minimal for a first pass — amount and an optional
// message. donorName/donorEmail/donorPhone/isAnonymous all exist on
// startDonationCheckout already and are easy to add as fields here later
// (email in particular, for receipts) without touching the backend.

const AMOUNT_PRESETS = [500, 1000, 2500, 5000];

interface DonateButtonProps {
  fundraiserId: Id<"fundraisers">;
  disabled?: boolean;
}

export function DonateButton({ fundraiserId, disabled }: DonateButtonProps) {
  const startDonationCheckout = useAction(
    api.donations.startDonationCheckout,
  );

  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState<number | "">("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const grossAmount = Number(amount);
    if (!grossAmount || grossAmount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (!email.trim()) {
      setError("Enter an email address for your receipt.");
      return;
    }

    setSubmitting(true);
    try {
      const { checkoutUrl } = await startDonationCheckout({
        fundraiserId,
        grossAmount,
        donorEmail: email.trim(),
        message: message.trim() || undefined,
        isAnonymous: false,
        origin: window.location.origin,
      });
      // Full navigation, not router.push — SasaPay's hosted checkout page
      // is a different origin entirely.
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="w-full" size="lg" disabled={disabled} />}
      >
        {disabled ? "Donations closed" : "Donate now"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Make a donation</DialogTitle>
          <DialogDescription>
            You&apos;ll be redirected to SasaPay to complete payment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="donate-amount">Amount (KES)</Label>
            <div className="flex flex-wrap gap-2">
              {AMOUNT_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={amount === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAmount(preset)}
                >
                  KES {preset.toLocaleString()}
                </Button>
              ))}
            </div>
            <Input
              id="donate-amount"
              type="number"
              min={1}
              placeholder="Custom amount"
              value={amount}
              onChange={(event) =>
                setAmount(
                  event.target.value ? Number(event.target.value) : "",
                )
              }
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="donate-email">Email (for your receipt)</Label>
            <Input
              id="donate-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="donate-message">Message (optional)</Label>
            <Textarea
              id="donate-message"
              placeholder="Leave a message of support…"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={300}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Redirecting…" : "Continue to payment"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}