import { defineConfig } from "vitest/config";

// Slimmed-down config for Stryker mutation runs. The main vitest.config.ts
// declares unit/integration/e2e projects, but @stryker-mutator/vitest-runner
// v9 has no option to select a project subset — it runs everything pointed
// at by `configFile`. Integration tests load real fixtures and e2e spawns
// the built CLI, both unsuitable for mutation. This config exposes only the
// unit suite so mutations are evaluated against fast, hermetic tests.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    restoreMocks: true,
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "examples/**"],
  },
});
