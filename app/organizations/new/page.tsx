"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function NewOrganizationPage() {
  const router = useRouter();
  const createOrganization = useMutation(api.organizations.createOrganization);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Organization name is required.");
      return;
    }

    setSubmitting(true);
    try {
      const organizationId = await createOrganization({
        name: name.trim(),
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
      });

      toast.success("Organization created!", {
        description: `${name.trim()} is ready — you're its owner.`,
      });

      // TODO: redirect to the organization's own dashboard/profile page
      // once it exists. Profile is a reasonable placeholder for now — it
      // at least lands somewhere real rather than a page that 404s.
      void organizationId;
      router.push("/profile");
    } catch (err) {
      const message =
        err instanceof ConvexError
          ? String(err.data)
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Create an organization</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Nakuru Youth Trust"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-description">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="org-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What does your organization do?"
                className="min-h-24"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-website">
                Website{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="org-website"
                type="url"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://example.org"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="org-email">
                  Contact email{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="org-email"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder="hello@example.org"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-phone">
                  Contact phone{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="org-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder="07XX XXX XXX"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
