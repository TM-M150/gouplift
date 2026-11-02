import { defineConfig } from "vitest/config";

// Convex functions are tested with convex-test, which needs the edge-runtime
// environment and has to be bundled by Vitest (convex-test ships ESM that it
// can't load otherwise). Test files live next to the code in convex/ and are
// named *.test.ts; the Convex deploy skips them because of the extra dot.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
