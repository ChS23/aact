// Stryker mutation testing config.
//
// Why: example-based tests can pass while still leaving code paths
// unguarded — change `>` to `>=`, drop a condition, swap a literal, and
// nothing fails. The 5 bugs we shipped to 2.1.4/2.1.5 were all of this
// kind. Mutation testing proves whether tests actually defend the
// implementation, not just touch its lines.
//
// Usage:
//   pnpm build           # mutation runs against ts via vitest, no built dist needed
//   pnpm test:mutation   # full run
//
// Not wired into CI yet — full mutation run is expensive (≈10-30 min)
// and is best invoked on demand or on a nightly schedule once the team
// has a baseline mutation score they want to defend.

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  // Explicit plugin path — pnpm's flat-symlink layout breaks Stryker's
  // glob-based auto-discovery, so it can't find the test runner unless we
  // point at it by name.
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: {
    // Slimmed config that only exposes the unit suite — integration loads
    // real fixtures and e2e spawns the built CLI, neither makes sense for
    // mutation testing. @stryker-mutator/vitest-runner v9 has no option to
    // pick a project from the main config, hence the dedicated file.
    configFile: "vitest.mutation.config.ts",
  },
  // "perTest" is faster but skips a test when it doesn't appear to cover
  // the mutated line. For module-level constants (e.g. ruleRegistry) the
  // construction runs once at import time, so registry tests are not seen
  // as "covering" those lines and Stryker reports their mutants as
  // survived. "all" runs every test against every mutant — slower but
  // gives an honest score.
  coverageAnalysis: "all",

  // Mutation scope покрывает user-facing data path и публичный output
  // contract: load → build/validate model → check/fix/analyze/diff →
  // envelope/SARIF emission. Regression в любом звене ломает user
  // files (fix), downstream tooling (generate / envelope shape),
  // analysis (analyze), diff baseline (diff) или silently-misses
  // violations (rules / model).
  //
  // Не покрыто намеренно: src/cli/commands/*.ts (orchestration с
  // citty arg descriptions — StringLiteral mutations на help-text
  // тонут в noise), src/cli/run.ts, src/cli/loadConfig.ts,
  // src/cli/loadModel.ts, src/cli/output/{humanReporter,jsonReporter,
  // toolError}.ts (formatting layer, тоже string-heavy).
  mutate: [
    "src/rules/**/*.ts",
    "src/formats/**/*.ts",
    "src/model/**/*.ts",
    "src/diff/**/*.ts",
    "src/analyze.ts",
    "src/config.ts",
    "src/cli/output/envelope.ts",
    "src/cli/output/sarifReporter.ts",
    "src/cli/output/hyperlinks.ts",
    "src/cli/output/resolveMode.ts",
    "!src/**/*.test.ts",
    "!src/**/index.ts",
    "!src/**/types.ts",
  ],

  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation-report.json" },

  // Hide the baseline noise — start with a low threshold and tighten
  // as the suite hardens.
  thresholds: { high: 80, low: 60, break: 50 },

  // Mutation runs can be heavy — cap concurrency so a developer's laptop
  // doesn't grind to a halt. Bump on CI machines.
  concurrency: 4,
  timeoutMS: 10_000,

  // ignoreStatic is incompatible with coverageAnalysis: "all".
};
