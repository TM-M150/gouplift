"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

/** Same routing as the homepage button: signed-in people go to the form, everyone else signs up first. */
export function FooterStartLink({ className }: { className?: string }) {
  const { data: session } = authClient.useSession();

  return (
    <Link href={session ? "/fundraiser-form" : "/sign-up"} className={className}>
      Start a Campaign
    </Link>
  );
}
