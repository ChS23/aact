import type { AactConfig } from "../config";
import { ruleRegistry } from "../rules/registry";
import type { RuleDefinition } from "../rules/types";
import { ToolError } from "./output";

const BUILTIN_RULE_NAMES: ReadonlySet<string> = new Set(
  ruleRegistry.map((r) => r.name),
);

/** Whether `name` is one of the built-in rules shipped with aact. */
export const isBuiltinRule = (name: string): boolean =>
  BUILTIN_RULE_NAMES.has(name);

/**
 * The effective rule set for a config — built-ins plus registered
 * `customRules`. A custom rule whose name collides with a built-in (or an
 * earlier custom) is a config error: reference Structurizr and ESLint both
 * reject duplicate ids. Shared by `check`, `rule list`, and `rule explain`
 * so all three resolve the same set with the same collision behaviour.
 */
export const buildEffectiveRules = (
  customRules?: readonly RuleDefinition[],
): readonly RuleDefinition[] => {
  if (!customRules || customRules.length === 0) return ruleRegistry;

  const seen = new Map<string, "built-in" | "custom">();
  for (const r of ruleRegistry) seen.set(r.name, "built-in");

  const merged: RuleDefinition[] = [...ruleRegistry];
  for (const r of customRules) {
    const existing = seen.get(r.name);
    if (existing) {
      throw new ToolError(
        "config.invalidCustomRule",
        `customRules: rule "${r.name}" conflicts with existing ${existing} rule. ` +
          "Rename your custom rule (e.g. prefix with your project name).",
        { rule: r.name },
      );
    }
    seen.set(r.name, "custom");
    merged.push(r);
  }
  return merged;
};

/**
 * Effective enabled-state of a rule. Built-in rules are **opt-in** — silent
 * until named in `config.rules` (`<name>: true` or an options object); custom
 * rules are auto-enabled by registration. Either opts out with
 * `<name>: false`.
 */
export const isRuleEnabled = (
  rules: AactConfig["rules"],
  name: string,
  isBuiltin: boolean,
): boolean => {
  const value = rules?.[name];
  if (value === false) return false;
  return isBuiltin ? value !== undefined : true;
};

/**
 * Reject unknown names in `config.rules`. A typo silently disables
 * enforcement, so `check` treats it as a hard error (exit 2). Intentionally
 * NOT called by `rule list` — that command stays usable as the discovery
 * path this error message points users to.
 */
export const assertNoUnknownRules = (
  rules: AactConfig["rules"],
  effective: readonly RuleDefinition[],
): void => {
  if (!rules) return;
  const known = new Set(effective.map((r) => r.name));
  const unknown = Object.keys(rules).filter((key) => !known.has(key));
  if (unknown.length === 0) return;
  const names = unknown.map((n) => `"${n}"`).join(", ");
  const plural = unknown.length > 1;
  throw new ToolError(
    "config.unknownRule",
    `Unknown rule${plural ? "s" : ""} in config.rules: ${names}. ` +
      "A typo here silently disables enforcement, so this is a hard error. " +
      `Remove the ${plural ? "entries" : "entry"}, or register ${plural ? "them" : "it"} via customRules. ` +
      "Run `aact rule list` to see available rules.",
    { rules: unknown.join(", ") },
  );
};
