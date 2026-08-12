import type { AactConfig } from "../../config";
import type { OutputMode } from "./types";

export interface ResolveModeArgs {
  /** `--json` flag value, undefined means unset. */
  readonly cliJson?: boolean;
  /** `--sarif` flag value, undefined means unset. Takes precedence
   *  over `--json` if both supplied (SARIF subsumes JSON for the
   *  GH Code Scanning pipeline). */
  readonly cliSarif?: boolean;
  /** Loaded config, null if no config (or load failed before mode resolution). */
  readonly config?: AactConfig | null;
}

/**
 * Resolution order: CLI flag > config.output.mode > "text". CLI flag wins
 * because it's the most explicit user intent (per-invocation override).
 * Config provides project-wide default for teams who want JSON or SARIF
 * always. `--sarif` outranks `--json` if both supplied — explicit SARIF
 * intent is rarely accidental, JSON is the broader catch-all.
 */
export const resolveOutputMode = (args: ResolveModeArgs): OutputMode => {
  if (args.cliSarif === true) return "sarif";
  if (args.cliJson === true) return "json";
  if (args.config?.output?.mode === "sarif") return "sarif";
  if (args.config?.output?.mode === "json") return "json";
  return "text";
};
