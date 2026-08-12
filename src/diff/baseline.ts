import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { knownFormatNames, loadFormat } from "../formats/registry";
import { canLoad } from "../formats/types";
import type { Model, ModelIssue } from "../model";
import type { DiffSide } from "./types";

/**
 * Tooling-facing failure while resolving a diff side. The CLI maps this to
 * ToolError at the command boundary; library consumers can handle it directly.
 */
export type DiffInputErrorKind =
  | "format.unknown"
  | "model.parseError"
  | "model.sourceNotFound"
  | "model.unsupportedLoad";

export class DiffInputError extends Error {
  readonly kind: DiffInputErrorKind;
  readonly context?: Readonly<Record<string, string>>;

  constructor(
    kind: DiffInputErrorKind,
    message: string,
    context?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "DiffInputError";
    this.kind = kind;
    this.context = context;
  }
}

/**
 * Resolve `<arg>` to a normalized Model + provenance label for diff workflows.
 *
 * Inputs:
 *  - File path — passed straight to the loader.
 *  - Git ref — `<ref>:<path>`; materialized to a scratch file.
 *  - `-` — stdin; materialized to a scratch file and requires formatOverride.
 */

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/;

const isGitRef = (arg: string): boolean =>
  arg.includes(":") &&
  !WINDOWS_ABSOLUTE_PATH.test(arg) &&
  !arg.startsWith("./") &&
  !arg.startsWith("../") &&
  !path.isAbsolute(arg);

const splitGitRef = (arg: string): { ref: string; path: string } => {
  const idx = arg.indexOf(":");
  return { ref: arg.slice(0, idx), path: arg.slice(idx + 1) };
};

const readGitRefBytes = (ref: string, path: string, cwd?: string): string => {
  try {
    return execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is universally PATH-installed; aact is itself a CLI users invoke from a shell.
      "git",
      ["show", `${ref}:${path}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...(cwd ? { cwd } : {}),
      },
    );
  } catch (error) {
    throw new DiffInputError(
      "model.sourceNotFound",
      `git ref "${ref}:${path}" not found (git show failed: ${
        error instanceof Error ? error.message : String(error)
      })`,
      { ref, path },
    );
  }
};

const readStdin = (): string => readFileSync(0, "utf8");

/**
 * Pick a sensible suffix for the scratch tmp file so loaders that key off
 * extension still behave correctly.
 */
const scratchExt = (arg: string, formatHint: string): string => {
  if (arg === "-") {
    return formatHint === "model-json" ? ".aact.json" : `.${formatHint}`;
  }
  return path.extname(splitGitRef(arg).path) || `.${formatHint}`;
};

const COMPOSE_BASES = new Set([
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
]);

export const detectFormatFromPath = (
  filePath: string,
  isDirectory = false,
): string | undefined => {
  if (isDirectory) return "kubernetes";
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);
  if (ext === ".puml" || ext === ".plantuml" || ext === ".iuml") {
    return "plantuml";
  }
  if (ext === ".dsl") return "structurizr";
  if (base === "workspace.json") return "structurizr";
  if (base.endsWith(".aact.json")) return "model-json";
  if (COMPOSE_BASES.has(base)) return "compose";
  return undefined;
};

export interface LoadBaselineInput {
  /** Raw argument string from the CLI or caller (file path, git ref, or "-"). */
  readonly arg: string;
  /** Explicit format override. Required for stdin and useful for ambiguous paths. */
  readonly formatOverride?: string;
  /** Label for diagnostics, usually "baseline" or "current". */
  readonly sideLabel: string;
  /** Working directory for git-ref resolution. */
  readonly cwd?: string;
  /** Per-format loader options. */
  readonly options?: unknown;
}

export interface LoadBaselineResult {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
  readonly side: DiffSide;
}

export const loadBaseline = async (
  input: LoadBaselineInput,
): Promise<LoadBaselineResult> => {
  const { arg, formatOverride, sideLabel, cwd, options } = input;

  let formatHint: string | undefined = formatOverride;
  let sourceLabel: string;
  let pathForContent:
    | { kind: "file"; arg: string }
    | { kind: "git"; ref: string; path: string }
    | { kind: "stdin" };

  if (arg === "-") {
    pathForContent = { kind: "stdin" };
    sourceLabel = `<stdin:${sideLabel}>`;
    if (!formatHint) {
      throw new DiffInputError(
        "format.unknown",
        `${sideLabel} reads from stdin — pass --${sideLabel}-format <fmt> to specify (${knownFormatNames().join(", ")})`,
      );
    }
  } else if (isGitRef(arg)) {
    const { ref, path: gitPath } = splitGitRef(arg);
    pathForContent = { kind: "git", ref, path: gitPath };
    sourceLabel = arg;
    formatHint = formatHint ?? detectFormatFromPath(gitPath);
  } else {
    if (!existsSync(arg)) {
      throw new DiffInputError(
        "model.sourceNotFound",
        `${sideLabel} file not found: ${arg}`,
        { path: arg },
      );
    }
    const isDirectory = statSync(arg).isDirectory();
    pathForContent = { kind: "file", arg };
    sourceLabel = arg;
    formatHint = formatHint ?? detectFormatFromPath(arg, isDirectory);
  }

  if (!formatHint) {
    throw new DiffInputError(
      "format.unknown",
      `Could not infer format for ${sideLabel} "${arg}". Pass --${sideLabel}-format <fmt> (${knownFormatNames().join(", ")})`,
      { arg },
    );
  }

  let rawContent: string | undefined;
  switch (pathForContent.kind) {
    case "stdin": {
      rawContent = readStdin();
      break;
    }
    case "git": {
      rawContent = readGitRefBytes(
        pathForContent.ref,
        pathForContent.path,
        cwd,
      );
      break;
    }
    case "file": {
      break;
    }
  }

  let format: Awaited<ReturnType<typeof loadFormat>>;
  try {
    format = await loadFormat(formatHint);
  } catch {
    throw new DiffInputError(
      "format.unknown",
      `Unknown format "${formatHint}" for ${sideLabel}. Known formats: ${knownFormatNames().join(", ")}`,
      { format: formatHint },
    );
  }
  if (!canLoad(format)) {
    throw new DiffInputError(
      "model.unsupportedLoad",
      `Format "${formatHint}" does not support load`,
      { format: formatHint },
    );
  }

  let pathForLoad = arg;
  let scratchDir: string | undefined;
  if (rawContent !== undefined) {
    scratchDir = mkdtempSync(path.join(tmpdir(), "aact-diff-"));
    pathForLoad = path.join(
      scratchDir,
      `baseline${scratchExt(arg, formatHint)}`,
    );
    writeFileSync(pathForLoad, rawContent, "utf8");
  }

  try {
    const result = await format.load(pathForLoad, options);
    return {
      model: result.model,
      issues: result.issues,
      side: { source: sourceLabel, format: formatHint },
    };
  } catch (error) {
    if (error instanceof DiffInputError) throw error;
    throw new DiffInputError(
      "model.parseError",
      `${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`,
      { path: sourceLabel },
    );
  } finally {
    if (scratchDir) {
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {
        // Benign: temp dir gets reclaimed by the OS eventually.
      }
    }
  }
};
