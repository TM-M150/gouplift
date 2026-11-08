"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { OrganizationForm } from "@/components/web/organization/organization-form";
import { VerificationBadge } from "@/components/web/organization/verification-badge";
import { Building2, ArrowRight } from "lucide-react";

export default function NewOrganizationPage() {
  // Existing organizations for the signed-in user
  const myOrganizations = useQuery(api.organizations.getMyOrganizations);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-12">
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
                href={`/organizations/${org.slug}/dashboard`}
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
                <div className="flex items-center space-x-3">
                  <VerificationBadge status={org.verificationStatus} />
                  <div className="flex items-center space-x-1 text-sm font-medium text-muted-foreground">
                    <span>Dashboard</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <OrganizationForm />
    </div>
  );
}
