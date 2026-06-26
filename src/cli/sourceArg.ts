import { promises as fs } from "node:fs";

import type { AactConfig } from "../config";
import { detectFormatFromPath } from "../diff";
import { ruleRegistry } from "../rules/registry";
import { ToolError } from "./output";

/**
 * Optional positional `source` shared by the single-model commands
 * (`model`, `check`, `analyze`). When given it points aact at a file or
 * directory ad-hoc — matching how `aact diff` takes its paths
 * positionally. With an `aact.config.ts` present it overrides
 * `config.source`; with no config it stands in for one, so
 * `aact model architecture.dsl` works in a bare directory. Format is
 * auto-detected from the path (directory → kubernetes, extension → the
 * matching loader).
 */
export const sourceArg = {
  source: {
    type: "positional",
    description:
      "Architecture source — file or directory. Overrides (or stands in for) aact.config.ts source; format auto-detected from the path.",
    required: false,
  },
} as const;

const detectType = async (raw: string): Promise<string> => {
  let isDirectory = false;
  try {
    isDirectory = (await fs.stat(raw)).isDirectory();
  } catch {
    // Not statable yet — fall back to extension-based detection and let
    // the loader surface a precise "source not found" error.
  }
  const type = detectFormatFromPath(raw, isDirectory);
  if (type === undefined) {
    throw new ToolError(
      "config.invalidSchema",
      `Cannot infer a format from "${raw}". Use a known extension (.puml / .dsl / .aact.json), a kubernetes directory, or set source.type in aact.config.ts.`,
      { path: raw },
    );
  }
  return type;
};

/**
 * Fold a positional `source` arg into the resolved config. Returns the
 * config unchanged (same reference) when no positional was given — the
 * caller uses that identity to decide whether a config was actually
 * required. Per-format `source.options` are dropped on override: they
 * belong to the configured source, not an ad-hoc path.
 */
export const applyPositionalSource = async (
  config: AactConfig | null,
  args: Record<string, unknown>,
): Promise<AactConfig | null> => {
  const raw = args.source;
  if (typeof raw !== "string" || raw.length === 0) return config;

  const source = { path: raw, type: await detectType(raw) };
  if (config !== null) return { ...config, source };

  // No config to inherit rules from — synthesise one with every built-in
  // rule enabled, so `aact check architecture.dsl` lints with the full
  // pattern set out of the box (`model` / `analyze` ignore `rules`).
  const rules = Object.fromEntries(ruleRegistry.map((r) => [r.name, true]));
  return { source, rules } satisfies AactConfig;
};
