import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    /**
     * Above Vitest's 5s default because a handful of tests deliberately do a
     * cold dynamic `import()` of a module whose transitive graph includes
     * `firebase-admin` (`lib/ai/__tests__/security.test.ts` imports
     * `resolveConversionFailure` under a stubbed `window` to prove the
     * server-only guard throws). That import costs ~1.2s in isolation but
     * several times that when the full suite runs it in parallel with every
     * other worker, which made the suite fail intermittently on a timeout
     * that had nothing to do with the behavior under test.
     */
    testTimeout: 30_000,
  },
});
