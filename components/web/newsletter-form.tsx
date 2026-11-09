"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/components/web/admin/utils";
import { newsletterEmailSchema } from "@/lib/validations/newsletter";

export function NewsletterForm() {
  const subscribe = useMutation(api.newsletter.subscribe);
  const [email, setEmail] = React.useState("");
  const [website, setWebsite] = React.useState(""); // honeypot
  const [state, setState] = React.useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = newsletterEmailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }

    setState("sending");
    try {
      await subscribe({ email: parsed.data, website });
      setState("done");
    } catch (err) {
      setState("idle");
      setError(errorMessage(err));
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-sm">
        Thanks, you&apos;re on the list. We&apos;ll email you GoUplift news.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full space-y-3">
      <div className="space-y-2.5">
        <Label className="block text-sm font-semibold" htmlFor="newsletter-email">
          Subscribe to our newsletter
        </Label>
        <Input
          id="newsletter-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Your email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="newsletter-help"
          disabled={state === "sending"}
        />
        {/* Real visitors never see this. Bots that fill in every field do. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="newsletter-website">Website</label>
          <input
            id="newsletter-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>
      </div>

      <Button type="submit" size="sm" className="w-full" disabled={state === "sending"}>
        {state === "sending" ? "Subscribing…" : "Subscribe"}
      </Button>

      <p id="newsletter-help" className="text-xs text-muted-foreground">
        By subscribing you agree to get GoUplift updates by email. See our{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
      <p role="alert" className="min-h-4 text-xs text-destructive">
        {error}
      </p>
    </form>
  );
}
