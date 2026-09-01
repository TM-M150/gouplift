"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface EditFundraiserButtonProps {
  fundraiserId: Id<"fundraisers">;
  creatorId: Id<"users">;
}

export function EditFundraiserButton({
  fundraiserId,
  creatorId,
}: EditFundraiserButtonProps) {
  const currentUser = useQuery(api.users.getCurrentUser);

  // Still loading
  if (currentUser === undefined) return null;

  // Not logged in or not the owner
  if (!currentUser || currentUser._id !== creatorId) {
    // Optional: allow admins too
    // if (currentUser?.role !== "ADMIN") return null;
    return null;
  }

  return (
    <Link href={`/fundraiser/${fundraiserId}/edit`}>
      <Button variant="outline" size="sm" className="gap-2">
        <Pencil className="h-4 w-4" />
        Edit
      </Button>
    </Link>
  );
}
