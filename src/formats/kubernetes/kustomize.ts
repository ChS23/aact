import { promises as fs } from "node:fs";

import path from "pathe";
import { parse as parseYaml } from "yaml";

import type { ModelIssue } from "../../model";

/**
 * Минимальный kustomize parser — читает только `resources` поле
 * `kustomization.yaml` и возвращает абсолютные пути к манифестам
 * для последующего walking.
 *
 * Что MVP делает:
 *  - resources: ["./deploy.yaml", "../base"] → resolve относительно
 *    kustomization.yaml directory
 *  - relative paths поддерживаются; remote URLs (`https://...`,
 *    `github.com/...`) — выдают info-issue и пропускаются
 *
 * Что MVP НЕ делает (info-issue если присутствует):
 *  - patches / patchesStrategicMerge / patchesJson6902
 *  - replicas / images
 *  - nameSuffix / namePrefix (RENAMES resources — нарушают name
 *    resolution; пользователь должен `kubectl kustomize | aact`)
 *  - commonLabels / commonAnnotations
 *  - generators / transformers
 *  - helmCharts inline
 *
 * Когда любое из вышеперечисленных встретится — emit single combined
 * info-issue per file, чтобы Model осталась используемой для
 * "is structure right" drift, но пользователь знал ограничения.
 */

const ADVANCED_FEATURES: readonly string[] = Object.freeze([
  "patches",
  "patchesStrategicMerge",
  "patchesJson6902",
  "replicas",
  "images",
  "nameSuffix",
  "namePrefix",
  "commonLabels",
  "commonAnnotations",
  "generators",
  "transformers",
  "helmCharts",
  "components",
]);

const isRemoteRef = (ref: string): boolean => {
  if (ref.startsWith("http://") || ref.startsWith("https://")) return true;
  // Kustomize remote git refs: `github.com/...`, `git@...`, `ssh://...`
  if (ref.startsWith("git@") || ref.startsWith("ssh://")) return true;
  if (/^[\w-]+(\.[\w-]+)+\//.test(ref)) return true; // bare-host pattern
  return false;
};

export interface ResolveKustomizeResult {
  /** Absolute paths извлечённые из `resources` field. */
  readonly resourcePaths: readonly string[];
  readonly issues: readonly ModelIssue[];
}

/**
 * Read kustomization.yaml, validate shape, expand `resources` to
 * absolute paths. Caller затем feed'ит это в walkManifests's existing
 * file/dir parser.
 *
 * Эта функция НЕ recurses сама — `walkManifests` сделает recursive
 * walk над dir-resource'ами, и натолкнётся на nested kustomization'ы.
 */
export const resolveKustomization = async (
  kustomizationPath: string,
): Promise<ResolveKustomizeResult> => {
  const issues: ModelIssue[] = [];
  const baseDir = path.dirname(kustomizationPath);
  const content = await fs.readFile(kustomizationPath, "utf8");
  const parsed: unknown = parseYaml(content);

  if (!parsed || typeof parsed !== "object") {
    return Object.freeze({
      resourcePaths: Object.freeze([]),
      issues: Object.freeze(issues),
    });
  }

  const doc = parsed as Record<string, unknown>;

  // Detect advanced features → single combined info-issue
  const usedAdvanced = ADVANCED_FEATURES.filter((feature) => feature in doc);
  if (usedAdvanced.length > 0) {
    issues.push({
      kind: "loader-warning",
      source: "kubernetes",
      code: "kustomize-advanced-unsupported",
      message: `Kustomization at ${kustomizationPath} uses advanced features (${usedAdvanced.join(", ")}) — aact's Phase 2 reads \`resources\` only. For accurate drift, run \`kubectl kustomize ${baseDir} > rendered.yaml\` and load that.`,
    });
  }

  const resources = doc.resources;
  if (!Array.isArray(resources)) {
    return Object.freeze({
      resourcePaths: Object.freeze([]),
      issues: Object.freeze(issues),
    });
  }

  const out: string[] = [];
  for (const entry of resources) {
    if (typeof entry !== "string") continue;
    if (isRemoteRef(entry)) {
      issues.push({
        kind: "loader-warning",
        source: "kubernetes",
        code: "kustomize-remote-unsupported",
        message: `Remote kustomize resource "${entry}" in ${kustomizationPath} is not fetched. Vendor it locally or pre-render with kustomize.`,
      });
      continue;
    }
    out.push(path.resolve(baseDir, entry));
  }

  return Object.freeze({
    resourcePaths: Object.freeze(out),
    issues: Object.freeze(issues),
  });
};
