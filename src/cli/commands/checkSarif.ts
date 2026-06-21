import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import path from "pathe";

import type { SourceLocation } from "../../model";
import { ruleRegistry } from "../../rules/registry";
import type { RuleDefinition } from "../../rules/types";
import type {
  SarifAdapter,
  SarifLog,
  SarifReportingDescriptor,
  SarifResult,
} from "../output";
import type { CheckData, CheckViolation } from "./check";

const SARIF_SCHEMA =
  "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.6.json";

const AACT_INFO_URI = "https://github.com/Byndyusoft/aact";

/**
 * GitHub Code Scanning matches `artifactLocation.uri` against the
 * **repository root**, not the working directory the tool was run
 * from. Look up the git top-level via `git rev-parse` — succeeds in
 * any subdir of a repo — and fall back to cwd if we're not in a
 * git checkout (e.g. local smoke testing outside a repo).
 *
 * The lookup is sync (`execFileSync`) but runs once per `aact check`
 * invocation, so the spawn cost is irrelevant. `cwd()` is captured
 * at adapter-call time, not module-load time, so tests that change
 * cwd between invocations see the right base.
 */
const computeRepoRoot = (): string => {
  try {
    const out = execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- `git` is universally PATH-installed; aact is itself a CLI tool that already trusts the user's shell environment.
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return out || process.cwd();
  } catch {
    return process.cwd();
  }
};

/**
 * Resolve symlinks before comparing — macOS's `/tmp` ↔ `/private/tmp`
 * symlink would otherwise produce a `..`-leading relative path even
 * when both sides logically point at the same directory.
 * `realpathSync` throws on non-existent paths, so we fall back to
 * the original string (relativization still works on canonical
 * inputs; only the edge case of "file disappeared between load and
 * SARIF emit" lands here).
 */
const canonical = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

const relativizeUri = (filePath: string, base: string): string => {
  if (!path.isAbsolute(filePath)) return filePath;
  const rel = path.relative(canonical(base), canonical(filePath));
  // `..` prefix means the file lives outside the repo root — keep absolute.
  return rel === "" || rel.startsWith("..") ? filePath : rel;
};

/**
 * Build a `tool.driver.rules[]` catalogue from the built-in registry.
 * Custom rules registered via `aact.config.ts` aren't in the registry
 * but their violations still surface — SARIF allows `ruleId` without
 * a matching descriptor, so unknown rule ids show up as alerts with
 * just the id (consumers display the message verbatim).
 */
const buildRuleCatalogue = (
  rules: readonly RuleDefinition[],
): readonly SarifReportingDescriptor[] =>
  rules.map((r) => ({
    id: r.name,
    name: r.name,
    shortDescription: { text: r.description },
    helpUri: `${AACT_INFO_URI}#${r.name}`,
  }));

const ruleIndexMap = (
  rules: readonly RuleDefinition[],
): ReadonlyMap<string, number> => {
  const map = new Map<string, number>();
  rules.forEach((r, i) => map.set(r.name, i));
  return map;
};

/**
 * Stable hash for GitHub Code Scanning's alert deduplication. We
 * combine rule + target + message into a SHA-256 truncated to 16
 * hex chars — short enough to read, wide enough to avoid collisions.
 * `sourceLocation` is intentionally NOT folded in: edits that shift
 * line numbers should not break alert continuity.
 *
 * Emitted under two keys per result:
 *  - `primaryLocationLineHash` — the conventional key GitHub Code
 *    Scanning, ESLint SARIF formatter, Semgrep, etc. agree on.
 *    GitHub uses it specifically to keep alerts continuous across
 *    runs even when the alert moves between lines.
 *  - `aactViolationHash` — the same value, namespaced for tooling
 *    that wants to filter aact alerts specifically (or for
 *    debugging when `primaryLocationLineHash` competes with other
 *    SARIF producers in a multi-tool workflow).
 */
const fingerprint = (v: CheckViolation): string =>
  createHash("sha256")
    .update(`${v.ruleId}\0${v.target}\0${v.message}`)
    .digest("hex")
    .slice(0, 16);

const buildSarifLocation = (
  loc: SourceLocation | undefined,
  repoRoot: string,
  label?: string,
) => {
  const region = loc
    ? {
        startLine: loc.start.line,
        startColumn: loc.start.col,
        endLine: loc.end.line,
        endColumn: loc.end.col,
      }
    : { startLine: 1 };
  const uri = loc?.file ? relativizeUri(loc.file, repoRoot) : "unknown";
  const artifactLocation =
    uri === "unknown" || path.isAbsolute(uri)
      ? { uri }
      : { uri, uriBaseId: "SRCROOT" as const };
  return {
    physicalLocation: { artifactLocation, region },
    ...(label ? { message: { text: label } } : {}),
  };
};

const violationToResult = (
  v: CheckViolation,
  ruleIndex: ReadonlyMap<string, number>,
  repoRoot: string,
): SarifResult => {
  const fp = fingerprint(v);
  const relatedLocations = v.relatedLocations?.map((r) =>
    buildSarifLocation(r.sourceLocation, repoRoot, r.message),
  );
  return {
    ruleId: v.ruleId,
    ...(ruleIndex.has(v.ruleId) ? { ruleIndex: ruleIndex.get(v.ruleId) } : {}),
    level: v.severity,
    message: { text: `${v.target}: ${v.message}` },
    locations: [buildSarifLocation(v.sourceLocation, repoRoot)],
    ...(relatedLocations && relatedLocations.length > 0
      ? { relatedLocations }
      : {}),
    partialFingerprints: {
      primaryLocationLineHash: fp,
      aactViolationHash: fp,
    },
    properties: { targetKind: v.targetKind },
  };
};

/**
 * Map a `check` envelope to a SARIF v2.1.0 log. Only the violations
 * become SARIF `results` — fixes, suggestedFixes, and diagnostics
 * (rule-load issues etc.) are out of SARIF's scope: SARIF describes
 * "what's wrong", not "how to fix" or "tool errors".
 *
 * The `tool.driver.rules[]` catalogue lists the 8 built-ins. Custom
 * rules' violations still surface (SARIF accepts a `ruleId` without
 * a descriptor), they just don't carry a description or helpUri.
 */
export const checkSarifAdapter: SarifAdapter<CheckData> = (envelope) => {
  const rules = buildRuleCatalogue(ruleRegistry);
  const indexMap = ruleIndexMap(ruleRegistry);
  const repoRoot = computeRepoRoot();
  const results = envelope.data.violations.map((v) =>
    violationToResult(v, indexMap, repoRoot),
  );
  const log: SarifLog = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "aact",
            version: envelope.meta.aactVersion,
            informationUri: AACT_INFO_URI,
            rules,
          },
        },
        // Declare SRCROOT so consumers can resolve any relative
        // `artifactLocation.uri` back to an absolute path. `pathToFileURL`
        // handles paths with spaces, non-ASCII characters, and Windows
        // drive letters correctly — naive `file://${root}` concatenation
        // would emit invalid URIs on those.
        originalUriBaseIds: {
          SRCROOT: { uri: pathToFileURL(`${repoRoot}/`).href },
        },
        results,
      },
    ],
  };
  return log;
};
