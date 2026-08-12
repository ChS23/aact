import { defineConfig } from "vitest/config";

const ciReporter = process.env.GITHUB_ACTIONS ? ["github-actions"] : [];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    restoreMocks: true,
    reporters: ["default", ...ciReporter],

    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["examples/**/*.test.ts"],
          // Integration scenarios load real PlantUML/Structurizr files and
          // synthesize architectures — slower than unit tests.
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.test.ts"],
          // E2E spawns `npx aact ...` subprocesses; first run pulls the
          // package via npx → allow a generous budget.
          testTimeout: 90_000,
          hookTimeout: 90_000,
        },
      },
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        // Re-export barrels — no logic to cover
        "src/**/index.ts",
        // CLI entry — bootstrap only, runMain() is the whole body
        "src/cli/index.ts",
        // Type-only files
        "src/**/*.d.ts",
        "src/**/types.ts",
      ],
      reportsDirectory: "coverage",
      // Threshold floors — OSS-realistic (industry norm 70-90% для mature
      // projects per Node.js Reference Architecture). Catches регрессии
      // > ~3% без env-variance flakes между local/CI. Locally coverage
      // обычно держится 97-99%, в CI чуть ниже из-за env-dependent
      // branches в detectFormat — это не повод раздувать floor.
      thresholds: {
        statements: 95,
        branches: 85,
        functions: 95,
        lines: 95,
      },
    },
  },
});
