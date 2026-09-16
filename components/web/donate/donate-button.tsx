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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const AMOUNT_PRESETS_KES = [500, 1000, 2500, 5000];
const AMOUNT_PRESETS_USD = [5, 10, 25, 50];

type Provider = "SASAPAY" | "PAYPAL";

interface DonateButtonProps {
  fundraiserId: Id<"fundraisers">;
  disabled?: boolean;
}

export function DonateButton({ fundraiserId, disabled }: DonateButtonProps) {
  const startDonationCheckout = useAction(api.donations.startDonationCheckout);
  const startPayPalCheckout = useAction(api.paypal.startPayPalCheckout);

  const [open, setOpen] = React.useState(false);
  const [provider, setProvider] = React.useState<Provider>("SASAPAY");
  const [amount, setAmount] = React.useState<number | "">("");
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleProviderChange(next: Provider) {
    setProvider(next);
    setAmount("");
    setError(null);
  }

  const presets =
    provider === "SASAPAY" ? AMOUNT_PRESETS_KES : AMOUNT_PRESETS_USD;
  const currencyLabel = provider === "SASAPAY" ? "KES" : "USD";

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
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
      let checkoutUrl: string;

      if (provider === "SASAPAY") {
        const result = await startDonationCheckout({
          fundraiserId,
          grossAmount,
          donorEmail: email.trim(),
          message: message.trim() || undefined,
          isAnonymous: false,
          origin: window.location.origin,
        });
        checkoutUrl = result.checkoutUrl;
      } else {
        const result = await startPayPalCheckout({
          fundraiserId,
          amountUsd: grossAmount,
          donorEmail: email.trim(),
          message: message.trim() || undefined,
          isAnonymous: false,
          origin: window.location.origin,
        });
        checkoutUrl = result.checkoutUrl;
      }

      // Full navigation, not router.push — both SasaPay's and PayPal's
      // hosted checkout pages are a different origin entirely.
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
      <DialogTrigger
        render={<Button className="w-full" size="lg" disabled={disabled} />}
      >
        {disabled ? "Donations closed" : "Donate now"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Make a donation</DialogTitle>
          <DialogDescription>
            {provider === "SASAPAY"
              ? "You'll be redirected to SasaPay to complete payment."
              : "You'll be redirected to PayPal to complete payment."}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={provider}
          onValueChange={(value) => handleProviderChange(value as Provider)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="SASAPAY" className="flex-1">
              SasaPay (KES)
            </TabsTrigger>
            <TabsTrigger value="PAYPAL" className="flex-1">
              PayPal (USD)
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="donate-amount">Amount ({currencyLabel})</Label>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={amount === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAmount(preset)}
                >
                  {currencyLabel} {preset.toLocaleString()}
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
                setAmount(event.target.value ? Number(event.target.value) : "")
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
