import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Convex functions are tested with convex-test, which needs the edge-runtime
// environment and has to be bundled by Vitest (convex-test ships ESM that it
// can't load otherwise). Test files live next to the code in convex/ and are
// named *.test.ts; the Convex deploy skips them because of the extra dot.
export default defineConfig({
  // Same "@/..." alias as tsconfig.json, for the Convex files that use it.
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    // No email key unless a test sets one, so a key exported in a developer's
    // shell can never make a test reach the real email service.
    env: { RESEND_API_KEY: "" },
    server: { deps: { inline: ["convex-test"] } },
  },
});
