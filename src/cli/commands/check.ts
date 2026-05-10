import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";
import consola from "consola";
import pc from "picocolors";

import type { AactConfig } from "../../config";
import { plantumlSyntax } from "../../loaders/plantuml/syntax";
import { structurizrDslSyntax } from "../../loaders/structurizr/syntax";
import type { ArchitectureModel } from "../../model";
import type { FixResult, SourceSyntax } from "../../rules/fix";
import { applyEdits } from "../../rules/fix";
import { ruleRegistry } from "../../rules/registry";

const ruleMap = new Map(ruleRegistry.map((r) => [r.name, r]));

// eslint-disable-next-line n/no-process-exit
const exitWithViolations = (): never => process.exit(1);
import type { Violation } from "../../rules/types";
import { loadAndValidateConfig } from "../loadConfig";
import { loadModel } from "../loadModel";

interface RuleResult {
  name: string;
  violations: Violation[];
}

const runRules = (
  model: ArchitectureModel,
  rules: AactConfig["rules"],
): RuleResult[] => {
  const results: RuleResult[] = [];

  for (const rule of ruleRegistry) {
    const configValue = rules?.[rule.name as keyof typeof rules];
    if (configValue === false) continue;
    const options = typeof configValue === "object" ? configValue : undefined;
    results.push({ name: rule.name, violations: rule.check(model, options) });
  }

  return results;
};

const getSyntax = (config: AactConfig): SourceSyntax | null => {
  if (config.source.type === "plantuml") {
    return plantumlSyntax;
  }
  if (config.source.type === "structurizr") {
    if (!config.source.writePath) {
      consola.warn(
        "To use --fix with structurizr, add source.writePath pointing to your workspace.dsl",
      );
      return null;
    }
    return structurizrDslSyntax;
  }
  return null;
};

// Fixes from all enabled rules are collected in registry order and applied
// to the source as a single batch (see `writeFixes` below). The model is
// not re-checked between rules, so two rules whose edits land on
// overlapping lines may produce inconsistent output — `applyEdits` warns
// on ambiguous patterns but does not abort. No priority/conflict model.
const generateFixes = (
  model: ArchitectureModel,
  results: RuleResult[],
  rules: AactConfig["rules"],
  syntax: SourceSyntax,
): FixResult[] => {
  const fixes: FixResult[] = [];

  for (const result of results) {
    if (result.violations.length === 0) continue;
    const ruleDef = ruleMap.get(result.name);
    if (!ruleDef?.fix) continue;
    const configValue = rules?.[ruleDef.name as keyof typeof rules];
    const options = typeof configValue === "object" ? configValue : undefined;
    fixes.push(...ruleDef.fix(model, result.violations, syntax, options));
  }

  return fixes;
};

const formatText = (results: RuleResult[]): void => {
  const failed = results.filter((r) => r.violations.length > 0);
  const passed = results.filter((r) => r.violations.length === 0);

  for (const result of failed) {
    const count = result.violations.length;
    const label = count === 1 ? "violation" : "violations";
    const countLabel = pc.red(`${count} ${label}`);
    console.log(`${pc.bold(pc.red(result.name))}  ${countLabel}`);

    const maxLen = Math.max(
      ...result.violations.map((v) => v.container.length),
    );
    for (const v of result.violations) {
      console.log(`  ${pc.bold(v.container.padEnd(maxLen))}  ${v.message}`);
    }
    console.log();
  }

  if (passed.length > 0) {
    console.log(
      `${pc.dim("Passed")}  ${passed.map((r) => pc.green(r.name)).join(pc.dim(" · "))}`,
    );
    console.log();
  }

  const total = failed.reduce((n, r) => n + r.violations.length, 0);
  if (total === 0) {
    console.log(pc.green("No violations found."));
  } else {
    const rulesLabel = failed.length === 1 ? "rule" : "rules";
    console.log(
      pc.red(
        `Found ${total} ${total === 1 ? "violation" : "violations"} in ${failed.length} ${rulesLabel}`,
      ) + pc.dim("  —  run with --fix to apply suggested fixes"),
    );
  }
};

const formatJson = (results: RuleResult[]): void => {
  const output = {
    results: results.map((r) => ({
      rule: r.name,
      passed: r.violations.length === 0,
      violations: r.violations,
    })),
  };
  console.log(JSON.stringify(output, undefined, 2));
};

const formatGithub = (results: RuleResult[]): void => {
  for (const result of results) {
    for (const v of result.violations) {
      console.log(`::error title=${result.name}::${v.container}: ${v.message}`);
    }
  }
};

const prefixContent = (content: string, first: string, rest: string): string =>
  content
    .split("\n")
    .map((line, i) => (i === 0 ? first + line : rest + line))
    .join("\n");

const formatFixes = (fixes: FixResult[]): void => {
  for (const fix of fixes) {
    const ruleTag = pc.bold(`[${fix.rule}]`);
    console.log(`  ${ruleTag}  ${fix.description}`);
    for (const edit of fix.edits) {
      switch (edit.type) {
        case "remove": {
          console.log(pc.red(prefixContent(edit.search, "    - ", "      ")));
          break;
        }
        case "replace": {
          console.log(pc.red(prefixContent(edit.search, "    - ", "      ")));
          console.log(
            pc.green(prefixContent(edit.content ?? "", "    + ", "      ")),
          );
          break;
        }
        case "add": {
          console.log(pc.dim(`    (after "${edit.search}")`));
          console.log(
            pc.green(prefixContent(edit.content ?? "", "    + ", "      ")),
          );
          break;
        }
      }
    }
    console.log();
  }
};

const detectFormat = (format?: string): string => {
  if (format) return format;
  if (process.env.GITHUB_ACTIONS) return "github";
  return "text";
};

const formatResults = (results: RuleResult[], format: string): void => {
  switch (format) {
    case "json": {
      formatJson(results);
      break;
    }
    case "github": {
      formatGithub(results);
      break;
    }
    default: {
      formatText(results);
    }
  }
};

const writeFixes = async (
  config: AactConfig,
  fixes: FixResult[],
): Promise<void> => {
  const writePath = path.resolve(config.source.writePath ?? config.source.path);
  let source = await readFile(writePath, "utf8");
  for (const fix of fixes) {
    source = applyEdits(source, fix.edits);
  }
  await writeFile(writePath, source, "utf8");

  const isDslFix =
    config.source.writePath && config.source.writePath !== config.source.path;

  if (isDslFix) {
    consola.success(`Applied ${fixes.length} fix(es), wrote ${writePath}`);
    consola.warn(
      "DSL updated — regenerate workspace.json from workspace.dsl before re-checking",
    );
  } else {
    const reModel = await loadModel(config);
    const reResults = runRules(reModel, config.rules);
    const remaining = reResults.reduce((n, r) => n + r.violations.length, 0);
    consola.success(
      `Applied ${fixes.length} fix(es), wrote ${writePath}` +
        (remaining > 0 ? ` (${remaining} violation(s) remain)` : ""),
    );
  }
};

const handleFixMode = async (
  model: ArchitectureModel,
  results: RuleResult[],
  config: AactConfig,
  dryRun: boolean,
): Promise<void> => {
  const hasViolations = results.some((r) => r.violations.length > 0);
  if (!hasViolations) {
    consola.success("No violations to fix");
    return;
  }

  const syntax = getSyntax(config);
  if (!syntax) return exitWithViolations();

  const fixes = generateFixes(model, results, config.rules, syntax);
  if (fixes.length === 0) {
    consola.info("No auto-fixes available for these violations");
    exitWithViolations();
  }

  console.log(
    pc.bold(dryRun ? "Suggested fixes (dry run):" : "Applying fixes:"),
  );
  console.log();
  formatFixes(fixes);
  console.log();

  if (!dryRun) {
    await writeFixes(config, fixes);
  }
};

const suggestFixes = (
  model: ArchitectureModel,
  results: RuleResult[],
  config: AactConfig,
): void => {
  const syntax = getSyntax(config);
  if (!syntax) return;
  const fixes = generateFixes(model, results, config.rules, syntax);
  if (fixes.length > 0) {
    console.log(pc.bold("Suggested fixes:"));
    console.log();
    formatFixes(fixes);
  }
};

export const check = defineCommand({
  meta: { description: "Check architecture rules" },
  args: {
    config: {
      type: "string",
      description: "Path to aact config file",
    },
    format: {
      type: "string",
      description: "Output format: text, json, github",
    },
    fix: {
      type: "boolean",
      description: "Apply auto-fixes to the source file",
    },
    "dry-run": {
      type: "boolean",
      description: "Show fixes without applying them",
    },
  },
  async run({ args }) {
    const config = await loadAndValidateConfig(args.config);
    const model = await loadModel(config);
    const results = runRules(model, config.rules);

    formatResults(results, detectFormat(args.format));

    const hasViolations = results.some((r) => r.violations.length > 0);

    if (args.fix || args["dry-run"]) {
      await handleFixMode(model, results, config, args["dry-run"] ?? false);
      return;
    }

    if (hasViolations) {
      suggestFixes(model, results, config);
      exitWithViolations();
    }
  },
});
