"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * The homepage is a static server component, so it can't know who is
 * viewing it. Signed-in visitors go straight to the fundraiser form;
 * everyone else (and anyone while the session is still loading) is sent
 * to sign up first, which matches the navbar's behaviour.
 */
export function StartFundraiserLink({ className }: { className?: string }) {
  const { data: session } = authClient.useSession();

  return (
    <Link
      href={session ? "/fundraiser-form" : "/sign-up"}
      className={cn(buttonVariants({ variant: "default" }), className)}
    >
      Start a Fundraiser
    </Link>
  );
}
