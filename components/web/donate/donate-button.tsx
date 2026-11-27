"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_DONOR_NAME_LENGTH } from "@/lib/donation-activity";
import { AMOUNT_PRESETS_KES, AMOUNT_PRESETS_USD } from "@/lib/donation-amounts";

// The longest message the box takes.
const MAX_MESSAGE_LENGTH = 300;

type Provider = "SASAPAY" | "PAYPAL";

interface DonateButtonProps {
  fundraiserId: Id<"fundraisers">;
  disabled?: boolean;
  // Where the donor came from, recorded on the donation. Leave out for a
  // normal visit to the fundraiser page.
  source?: "WEB" | "EMBED";
}

export function DonateButton({
  fundraiserId,
  disabled,
  source,
}: DonateButtonProps) {
  const startDonationCheckout = useAction(api.donations.startDonationCheckout);
  const startPayPalCheckout = useAction(api.paypal.startPayPalCheckout);

  const [open, setOpen] = React.useState(false);
  const [provider, setProvider] = React.useState<Provider>("SASAPAY");
  const [amount, setAmount] = React.useState<number | "">("");
  // Null until the donor types in the box, so that until then it shows the
  // name on their account, if they are signed in. They can change or clear it.
  const me = useQuery(api.users.getCurrentUser);
  const [typedName, setTypedName] = React.useState<string | null>(null);
  const donorName = typedName ?? me?.name ?? "";
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [isAnonymous, setIsAnonymous] = React.useState(false);
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
          donorName: donorName.trim() || undefined,
          donorEmail: email.trim(),
          message: message.trim() || undefined,
          isAnonymous,
          origin: window.location.origin,
          source,
        });
        checkoutUrl = result.checkoutUrl;
      } else {
        const result = await startPayPalCheckout({
          fundraiserId,
          amountUsd: grossAmount,
          donorName: donorName.trim() || undefined,
          donorEmail: email.trim(),
          message: message.trim() || undefined,
          isAnonymous,
          origin: window.location.origin,
          source,
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
      {/* Taller than a short phone screen once the options are shown, so it
          scrolls inside the screen instead of running off the top and bottom. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm">
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
            <Label htmlFor="donate-name">Your name (optional)</Label>
            <Input
              id="donate-name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              placeholder="e.g. Wanjiru Kamau"
              value={donorName}
              onChange={(event) => setTypedName(event.target.value)}
              maxLength={MAX_DONOR_NAME_LENGTH}
              disabled={isAnonymous}
            />
            <p className="text-xs text-muted-foreground">
              {isAnonymous
                ? "Not shown, because you're giving anonymously."
                : "Shown on the fundraiser with your gift, as your first name and the first letter of your last (Wanjiru K.). Leave it empty to show as “Someone”."}
            </p>
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
            <p className="text-xs text-muted-foreground">
              We will email your receipt. We may also email you when the
              organizer of this fundraiser posts an update; every one of those
              emails has an unsubscribe link.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="donate-message">Message (optional)</Label>
            <Textarea
              id="donate-message"
              placeholder="Leave a message of support…"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
            />
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="donate-anonymous"
              checked={isAnonymous}
              onCheckedChange={(checked) => setIsAnonymous(checked === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="donate-anonymous" className="leading-snug">
                Give anonymously
              </Label>
              <p className="text-xs text-muted-foreground">
                Your name isn&apos;t shown with this gift. If all your gifts to
                a fundraiser are anonymous, your comments on it show as
                &ldquo;Anonymous donor&rdquo;, and organizations that are told
                about donations aren&apos;t given your name or message. We still
                keep your details for your receipt and for legal checks.
              </p>
            </div>
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
