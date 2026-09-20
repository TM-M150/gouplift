"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { EditFundraiserForm } from "@/components/web/fundraiser/edit-fundraiser-form";

const LOCKED_STATUSES = new Set([
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
]);

export default function EditFundraiserPage() {
  const { id } = useParams<{ id: string }>();

  const currentUser = useQuery(api.users.getCurrentUser);
  const fundraiser = useQuery(api.fundraiser.getFundraiserById, {
    fundraiserId: id as Id<"fundraisers">,
  });

  if (currentUser === undefined || fundraiser === undefined) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto w-full pt-24 px-4 pb-16">
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  }

  if (fundraiser === null) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto w-full pt-24 px-4 pb-16 text-center">
        <h1 className="text-2xl font-semibold">Fundraiser not found</h1>
      </main>
    );
  }

  const isOwner = !!currentUser && currentUser._id === fundraiser.creatorId;

  if (!isOwner) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto w-full pt-24 px-4 pb-16 text-center">
        <h1 className="text-2xl font-semibold">
          You don&apos;t have access to this page
        </h1>
      </main>
    );
  }

  if (LOCKED_STATUSES.has(fundraiser.status)) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto w-full pt-24 px-4 pb-16 text-center">
        <h1 className="text-2xl font-semibold">
          This fundraiser can no longer be edited
        </h1>
        <p className="mt-2 text-muted-foreground">
          Its status is {fundraiser.status.toLowerCase()}.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-3xl mx-auto w-full pt-24 px-4 pb-16">
      <h1 className="mb-8 text-3xl font-semibold">Edit fundraiser</h1>
      <EditFundraiserForm fundraiser={fundraiser} />
    </main>
  );
}
