import { createAuthClient } from "better-auth/react";
import { phoneNumberClient, inferAdditionalFields } from "better-auth/client/plugins";
import type { createAuth } from "@/convex/auth";

export const authClient = createAuthClient({
  plugins: [
    phoneNumberClient(),
    inferAdditionalFields<typeof createAuth>(),
  ],
});