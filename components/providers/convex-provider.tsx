"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { ComponentProps, ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexBetterAuthProvider
      client={convex}
      // The provider's AuthClient type doesn't know about our phone number
      // plugin, so TypeScript won't accept the client as it is. It is the same
      // client at runtime.
      authClient={
        authClient as unknown as ComponentProps<
          typeof ConvexBetterAuthProvider
        >["authClient"]
      }
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
