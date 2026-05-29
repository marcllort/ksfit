import { defineConfig } from "vitest/config";

/**
 * Vitest config for @stride/health-core.
 *
 * The metric engine is pure TS (no DOM, no network), so the default node
 * environment is all we need. Tests live next to the code under
 * `src/**\/__tests__/`.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
