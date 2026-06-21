import { defineCommand } from "citty";

import type { AactConfig } from "../../config";
import { ruleRegistry } from "../../rules/registry";
import type { RuleDefinition } from "../../rules/types";
import { loadAndValidateConfig } from "../loadConfig";
import type { Renderer, RuleMetadata } from "../output";
import { ToolError } from "../output";
import { colors } from "../output/colors";
import { adrHelpUri } from "../ruleHelpUri";
import type { ExecuteResult } from "../run";
import { cliCommand } from "../run";
import { configArg, jsonArg } from "../sharedArgs";

// -----------------------------------------------------------------------------
// Public data shape (envelope.data for `aact rule list`)
// -----------------------------------------------------------------------------

export interface RuleListSummary {
  readonly enabled: number;
  readonly total: number;
}

export interface RuleListData {
  readonly rules: readonly RuleMetadata[];
  readonly summary: RuleListSummary;
}

/**
 * `envelope.data` shape for `aact rule explain <name>`. Carries the
 * rule's deep context — rationale, examples, ADR pointer — so
 * agents reading the JSON envelope have everything they need to
 * understand and act on a violation without a second round-trip.
 */
export interface RuleExplainData extends RuleMetadata {
  readonly rationale?: string;
  readonly examples?: readonly RuleExampleInfo[];
  readonly adrPath?: string;
}

export interface RuleExampleInfo {
  readonly label: "good" | "bad";
  readonly source: string;
  readonly note?: string;
}

// -----------------------------------------------------------------------------
// Pure executor
// -----------------------------------------------------------------------------

export interface RuleListArgs {
  readonly config?: string;
}

export interface RuleExplainArgs {
  readonly config?: string;
  readonly _: readonly string[];
}

// Mirror of `isRuleActive` in check.ts: built-in rules are opt-in (run
// only when named in config.rules), custom rules are auto-enabled by
// registration; either opts out with `<name>: false`.
const isEnabled = (
  rules: AactConfig["rules"],
  name: string,
  isBuiltin: boolean,
): boolean => {
  const value = rules?.[name];
  if (value === false) return false;
  return isBuiltin ? value !== undefined : true;
};

const collectRules = (config: AactConfig | null): RuleMetadata[] => {
  const out: RuleMetadata[] = [];
  for (const rule of ruleRegistry) {
    out.push({
      ruleId: rule.name,
      description: rule.description,
      source: "built-in",
      enabled: isEnabled(config?.rules, rule.name, true),
      hasFix: typeof rule.fix === "function",
      ...(rule.adrPath ? { helpUri: adrHelpUri(rule.adrPath) } : {}),
    });
  }
  for (const rule of config?.customRules ?? []) {
    out.push({
      ruleId: rule.name,
      description: rule.description,
      source: "custom",
      enabled: isEnabled(config?.rules, rule.name, false),
      hasFix: typeof rule.fix === "function",
      ...(rule.adrPath ? { helpUri: adrHelpUri(rule.adrPath) } : {}),
    });
  }
  return out;
};

/**
 * Loads config if present, ignores `config.missingSource` (built-ins-only
 * fallback) but re-throws every other ToolError so a broken/corrupted
 * config surfaces as exit 2 instead of silently hiding behind built-ins.
 */
const loadConfigOptional = async (
  configPath: string | undefined,
): Promise<AactConfig | null> => {
  try {
    const { config } = await loadAndValidateConfig(configPath);
    return config;
  } catch (error) {
    if (error instanceof ToolError && error.kind === "config.missingSource") {
      return null;
    }
    throw error;
  }
};

export const executeRuleList = async (
  args: RuleListArgs,
): Promise<ExecuteResult<RuleListData>> => {
  const config = await loadConfigOptional(args.config);
  const rules = collectRules(config);
  const enabled = rules.filter((r) => r.enabled).length;
  return {
    data: { rules, summary: { enabled, total: rules.length } },
    exitCode: 0,
  };
};

const findRule = (
  name: string,
  config: AactConfig | null,
): { rule: RuleDefinition; source: "built-in" | "custom" } | undefined => {
  const builtIn = ruleRegistry.find((r) => r.name === name);
  if (builtIn) return { rule: builtIn, source: "built-in" };
  const custom = (config?.customRules ?? []).find((r) => r.name === name);
  if (custom) return { rule: custom, source: "custom" };
  return undefined;
};

export const executeRuleExplain = async (
  args: RuleExplainArgs,
): Promise<ExecuteResult<RuleExplainData>> => {
  const ruleName = args._[0];
  if (!ruleName) {
    throw new ToolError(
      "config.invalidSchema",
      "Missing required argument: rule name. Usage: aact rule explain <rule-name>",
    );
  }
  const config = await loadConfigOptional(args.config);
  const found = findRule(ruleName, config);
  if (!found) {
    const known = [
      ...ruleRegistry.map((r) => r.name),
      ...(config?.customRules ?? []).map((r) => r.name),
    ].join(", ");
    throw new ToolError(
      "config.unknownRule",
      `Unknown rule "${ruleName}". Known rules: ${known}`,
      { rule: ruleName },
    );
  }
  const { rule, source } = found;
  return {
    data: {
      ruleId: rule.name,
      description: rule.description,
      source,
      enabled: isEnabled(config?.rules, rule.name, source === "built-in"),
      hasFix: typeof rule.fix === "function",
      ...(rule.rationale ? { rationale: rule.rationale } : {}),
      ...(rule.examples && rule.examples.length > 0
        ? { examples: rule.examples.map((e) => ({ ...e })) }
        : {}),
      ...(rule.adrPath ? { adrPath: rule.adrPath } : {}),
      // helpUri only when there's a real document behind it — the
      // ADR. Synthesising `#${ruleName}` against the README was a
      // dead anchor (README has no per-rule headings) and led
      // users to a 404.
      ...(rule.adrPath ? { helpUri: adrHelpUri(rule.adrPath) } : {}),
    },
    exitCode: 0,
  };
};

// -----------------------------------------------------------------------------
// Text rendering — mirrors current grouped table output
// -----------------------------------------------------------------------------

const renderGroup = (
  label: string,
  items: readonly RuleMetadata[],
  sink: NodeJS.WritableStream,
): void => {
  if (items.length === 0) return;
  sink.write(colors.bold(label) + "\n");
  const maxName = Math.max(...items.map((i) => i.ruleId.length));
  for (const rule of items) {
    const status = rule.enabled ? colors.green("●") : colors.dim("○");
    const fix = rule.hasFix ? colors.dim(" [fix]") : "";
    const name = rule.enabled
      ? colors.bold(rule.ruleId.padEnd(maxName))
      : colors.dim(rule.ruleId.padEnd(maxName));
    sink.write(`  ${status}  ${name}  ${colors.dim(rule.description)}${fix}\n`);
  }
  sink.write("\n");
};

const wrapPrefixed = (
  text: string,
  prefix: string,
  width: number,
): string[] => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = prefix;
  for (const word of words) {
    if (current.length + word.length + 1 > width && current !== prefix) {
      lines.push(current);
      current = prefix + word;
    } else {
      current = current === prefix ? current + word : `${current} ${word}`;
    }
  }
  if (current.trim().length > 0) lines.push(current);
  return lines;
};

export const renderRuleExplainText: Renderer<RuleExplainData> = (
  envelope,
  sink,
) => {
  const { data } = envelope;
  sink.write(colors.bold(`${data.ruleId}\n`));
  sink.write(colors.dim(`  ${data.description}\n\n`));

  const meta: string[] = [
    `source: ${data.source}`,
    `enabled: ${data.enabled ? "yes" : "no"}`,
    `auto-fix: ${data.hasFix ? "yes" : "no"}`,
  ];
  sink.write(colors.dim(`  ${meta.join("  ·  ")}\n\n`));

  if (data.rationale) {
    sink.write(colors.bold("Rationale\n"));
    for (const line of wrapPrefixed(data.rationale, "  ", 78)) {
      sink.write(`${line}\n`);
    }
    sink.write("\n");
  }

  if (data.examples && data.examples.length > 0) {
    sink.write(colors.bold("Examples\n"));
    for (const ex of data.examples) {
      const marker = ex.label === "good" ? colors.green("✓") : colors.red("✗");
      sink.write(`  ${marker} ${colors.bold(ex.label)}\n`);
      for (const line of ex.source.split("\n")) {
        sink.write(colors.dim(`      ${line}\n`));
      }
      if (ex.note) {
        for (const line of wrapPrefixed(ex.note, "      ", 78)) {
          sink.write(colors.dim(`${line}\n`));
        }
      }
      sink.write("\n");
    }
  }

  if (data.adrPath) {
    sink.write(colors.bold("ADR\n"));
    sink.write(`  ${data.adrPath}\n\n`);
  }

  if (data.helpUri) {
    sink.write(colors.dim(`  See also: ${data.helpUri}\n`));
  }
};

export const renderRuleListText: Renderer<RuleListData> = (envelope, sink) => {
  const { data } = envelope;
  const builtIns = data.rules.filter((r) => r.source === "built-in");
  const customs = data.rules.filter((r) => r.source === "custom");

  renderGroup("Built-in", builtIns, sink);
  renderGroup("Custom", customs, sink);

  sink.write(
    colors.dim(
      `${data.summary.enabled}/${data.summary.total} rules enabled · ● enabled · ○ disabled\n`,
    ),
  );
};

// -----------------------------------------------------------------------------
// Command definition
// -----------------------------------------------------------------------------

const listAction = cliCommand({
  name: "rule list",
  meta: {
    name: "list",
    description: "List all effective rules (built-in + custom)",
  },
  args: { ...configArg, ...jsonArg },
  renderText: renderRuleListText,
  execute: (ctx) => executeRuleList(ctx.args as RuleListArgs),
});

const explainAction = cliCommand({
  name: "rule explain",
  meta: {
    name: "explain",
    description: "Show rationale, examples and ADR link for a specific rule",
  },
  args: {
    ...configArg,
    ...jsonArg,
    name: {
      type: "positional",
      description: "Rule name (e.g. crud, dbPerService)",
      required: true,
    },
  },
  renderText: renderRuleExplainText,
  execute: (ctx) =>
    executeRuleExplain({
      config: (ctx.args as { config?: string }).config,
      _: [(ctx.args as { name: string }).name],
    }),
});

export const rule = defineCommand({
  meta: {
    name: "rule",
    description: "Inspect and manage architecture rules",
  },
  subCommands: { list: listAction, explain: explainAction },
});
