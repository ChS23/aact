import { defineConfig } from "../../src";
import { bcIsolationRule } from "./rules/bcIsolation";
import { requireOwnerTagRule } from "./rules/requireOwnerTag";

/**
 * Example aact config with two project-specific rules:
 *
 *   - `bcIsolation`      — DDD bounded-context isolation
 *   - `requireOwnerTag`  — every Container needs an owner:<team> tag
 *
 * Setup pattern:
 *   1. Write each rule as a `RuleDefinition` (see `./rules/*.ts`)
 *   2. Register via `customRules: [...]` — auto-enables the rules
 *   3. Configure in `rules: {}` with the same syntax as built-ins
 *
 * `defineConfig` is generic over `customRules`, so TypeScript autocompletes
 * the rule names and their option types in `rules{}` — typing
 * `rules: { bcIsolation: { ←tab } }` suggests `bcTagPrefix`, `apiSuffix`,
 * `brokerTag` from `BcIsolationOptions`.
 */
export default defineConfig({
  source: "./architecture.puml",

  customRules: [bcIsolationRule, requireOwnerTagRule],

  rules: {
    // --- Built-in checks ---
    acl: true,
    acyclic: true,

    // --- Custom rule configuration ---
    // Pass options identically to a built-in. Omit the entry to use defaults.
    bcIsolation: {
      bcTagPrefix: "bc:",
      apiSuffix: "_api",
      brokerTag: "broker",
    },
    // `requireOwnerTag` is auto-enabled with default options.
  },
});
