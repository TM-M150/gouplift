"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Building2, ArrowRight } from "lucide-react";

export default function NewOrganizationPage() {
  const router = useRouter();
  const createOrganization = useMutation(api.organizations.createOrganization);

  // Fetch existing organizations for the signed-in user
  const myOrganizations = useQuery(api.organizations.getMyOrganizations);

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

      router.push(`/organizations/${organizationId}/dashboard`);
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
    <div className="mx-auto max-w-lg space-y-8 px-4 py-12">
      {/* List of existing organizations */}
      {myOrganizations && myOrganizations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your Organizations</CardTitle>
            <CardDescription>
              Select an organization to open its dashboard or create a new one
              below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myOrganizations.map((org) => (
              <Link
                key={org._id}
                href={`/organizations/${org._id}/dashboard`}
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
              >
                <div className="flex items-center space-x-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      Role: {org.role.toLowerCase()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-1 text-sm font-medium text-muted-foreground">
                  <span>Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Creation Form */}
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
