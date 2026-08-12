import type { KubernetesLoadOptions, ResolvedAnnotationKeys } from "./types";

/**
 * `aact.*` annotation conventions — зеркало compose's labels API.
 *
 * Default keys derived из prefix `"aact"`. User может задать другой
 * prefix через `KubernetesLoadOptions.annotations.prefix`, или
 * granular override per key (Phase 3 если кто-то попросит — пока
 * только prefix).
 *
 *   metadata.annotations:
 *     aact.element: orders-service       # override element name
 *     aact.kind: ContainerDb             # override inferred kind
 *     aact.label: "Orders Service"       # human label
 *     aact.description: "Service for ..." # description
 *     aact.technology: "PostgreSQL 16"   # technology override
 *     aact.tags: "tier-1,public"         # comma-separated tags
 *     aact.external: "true"              # mark external
 *     aact.link: "https://docs/..."      # doc link
 *     aact.skip: "true"                  # exclude from Model
 *     aact.depends-on: "orders-db,cache" # explicit Relations (CSV)
 */

export const resolveAnnotationKeys = (
  options?: KubernetesLoadOptions,
): ResolvedAnnotationKeys => {
  const prefix = options?.annotations?.prefix ?? "aact";
  return Object.freeze({
    element: `${prefix}.element`,
    kind: `${prefix}.kind`,
    label: `${prefix}.label`,
    description: `${prefix}.description`,
    technology: `${prefix}.technology`,
    tags: `${prefix}.tags`,
    external: `${prefix}.external`,
    link: `${prefix}.link`,
    skip: `${prefix}.skip`,
    dependsOn: `${prefix}.depends-on`,
  });
};

/**
 * `aact.external: "true" | "1"` → boolean. Любое другое значение
 * (включая отсутствие annotation) → false.
 */
export const parseExternalFlag = (raw?: string): boolean => {
  if (raw === undefined) return false;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "true" || trimmed === "1";
};

/**
 * `aact.skip: "true" | "1"` — explicit skip per workload.
 */
export const parseSkipFlag = (raw?: string): boolean => parseExternalFlag(raw);
