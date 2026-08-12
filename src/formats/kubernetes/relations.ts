import type { Relation } from "../../model";
import { parseCsvTags } from "../_shared/tags";
import { getPodSpec } from "./classify";
import type { ServiceMap } from "./serviceMap";
import type { ParsedManifest, ResolvedAnnotationKeys } from "./types";

/**
 * Relation discovery для k8s workloads.
 *
 * Стратегия:
 *  1. `aact.depends-on` annotation (CSV element names) — authoritative.
 *     Если задан, используем ТОЛЬКО его, не парсим env-vars.
 *  2. Env-var heuristic: для каждого var с suffix'ом `_HOST` / `_URL`
 *     / `_ENDPOINT` / `_SERVICE` / `_SVC` / `_DB_URL` /
 *     `_DATABASE_URL` мы extract'им service-name из value и ищем его
 *     в `serviceMap`. Match → Relation к workload'у который этот
 *     Service exposes.
 *
 * Подход согласован с реальностью k8s — service discovery там через
 * env / DNS, а не explicit edges в манифестах. Heuristic noisy на
 * вырожденных манифестах, поэтому есть authoritative override.
 *
 * Self-relations (`workload → workload`) и duplicates суммированы
 * автоматически (Set on target name + skip self).
 */

const SERVICE_VAR_SUFFIXES: readonly string[] = Object.freeze([
  "_HOST",
  "_URL",
  "_ENDPOINT",
  "_SERVICE",
  "_SVC",
  "_DB_URL",
  "_DATABASE_URL",
  "_BASE_URL",
  "_API_URL",
  "_ADDR",
  "_ADDRESS",
]);

/**
 * Extract service name candidates из env-value. Поддерживаем:
 *   bare:           "orders-svc"
 *   DNS:            "orders-svc.shop.svc.cluster.local"
 *   URL:            "http://orders-svc:8080/api/v1"
 *   URL with creds: "postgresql://user:pass@orders-db:5432/orders"
 */
const extractServiceCandidates = (value: string): readonly string[] => {
  if (value.length === 0) return [];
  // Strip URL scheme + auth: `scheme://[user[:pass]@]host[:port]/...`
  let host = value;
  const schemeMatch = /^[a-z][\w+.-]*:\/\/(.+)$/i.exec(value);
  if (schemeMatch) host = schemeMatch[1];
  // Strip auth (user:pass@)
  const atIdx = host.indexOf("@");
  if (atIdx !== -1) host = host.slice(atIdx + 1);
  // Strip path / query / fragment
  for (const sep of ["/", "?", "#"]) {
    const idx = host.indexOf(sep);
    if (idx !== -1) host = host.slice(0, idx);
  }
  // Strip port
  const colonIdx = host.indexOf(":");
  if (colonIdx !== -1) host = host.slice(0, colonIdx);
  // host now: `orders-svc` или `orders-svc.shop.svc.cluster.local`
  // — оба формата возвращают полное имя + первый segment как candidate.
  if (host.length === 0) return [];
  const candidates = [host];
  const dotIdx = host.indexOf(".");
  if (dotIdx > 0) candidates.push(host.slice(0, dotIdx));
  return candidates;
};

const isServiceVar = (name: string): boolean => {
  for (const suffix of SERVICE_VAR_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
};

const getContainerEnvVars = (
  manifest: ParsedManifest,
): ReadonlyArray<{ name: string; value: string }> => {
  const podSpec = getPodSpec(manifest);
  if (!podSpec) return [];
  const containers = podSpec.containers;
  if (!Array.isArray(containers)) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const env = (container as Record<string, unknown>).env;
    if (!Array.isArray(env)) continue;
    for (const entry of env) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.name === "string" && typeof e.value === "string") {
        out.push({ name: e.name, value: e.value });
      }
    }
  }
  return out;
};

/**
 * Resolve один env value → set of target element names через ServiceMap.
 * Один env var может разрешаться в несколько workload'ов если несколько
 * Service'ов имеют такое же name (теоретически возможно в разных ns —
 * сейчас flat lookup).
 */
const resolveEnvValueTargets = (
  value: string,
  serviceMap: ServiceMap,
): readonly string[] => {
  const targets = new Set<string>();
  for (const candidate of extractServiceCandidates(value)) {
    const matched = serviceMap.byName.get(candidate);
    if (matched) {
      for (const name of matched) targets.add(name);
    }
  }
  return [...targets];
};

const makeRelation = (to: string): Relation =>
  Object.freeze({
    to,
    tags: Object.freeze([]),
  });

/**
 * Build relations array для одного workload'а.
 *
 * @param sourceElementName — derived Element name этого workload'а
 *        (используется для self-relation filtering).
 */
export const buildRelationsFor = (
  manifest: ParsedManifest,
  sourceElementName: string,
  serviceMap: ServiceMap,
  annotationKeys: ResolvedAnnotationKeys,
): readonly Relation[] => {
  const annotations = manifest.metadata.annotations;
  const explicit = annotations[annotationKeys.dependsOn];
  if (explicit && explicit.trim().length > 0) {
    // Explicit override — authoritative, env-vars НЕ парсим.
    const targets = parseCsvTags(explicit).filter(
      (t) => t !== sourceElementName,
    );
    return Object.freeze([...new Set(targets)].map((t) => makeRelation(t)));
  }

  // Env-var heuristic
  const targets = new Set<string>();
  for (const env of getContainerEnvVars(manifest)) {
    if (!isServiceVar(env.name)) continue;
    for (const target of resolveEnvValueTargets(env.value, serviceMap)) {
      if (target !== sourceElementName) targets.add(target);
    }
  }
  return Object.freeze([...targets].map((t) => makeRelation(t)));
};
