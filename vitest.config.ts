import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test needs the edge runtime to emulate the Convex environment
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
