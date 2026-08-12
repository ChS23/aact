import type { ParsedManifest } from "./types";

/**
 * Classify k8s resource kind → categories used by `toModel`.
 *
 * **Workload** — runtime workload, маппится в C4 Element { kind:
 * Container / ContainerDb / ContainerQueue } (image-heuristic выбирает).
 *   Deployment / StatefulSet / DaemonSet / Job / CronJob / Pod
 *
 * **Service** — discovery-layer abstraction; не Element сам по себе,
 * но даёт name routing для relation inference в Phase C.
 *
 * **Other** — Namespace / ConfigMap / Secret / PVC / NetworkPolicy /
 * Ingress / HPA / CRDs / etc. Пока игнорируем (или handle отдельно
 * для Namespace).
 *
 * `ReplicaSet` исключён намеренно — это subordinate-resource Deployment'а,
 * не authoring concept. Если попался standalone — silent ignore.
 *
 * Heuristic базируется только на `kind` строке — apiVersion в Phase 2
 * MVP не учитываем (все workload kinds стабильны с k8s 1.0+, namespace
 * `apps/`, `batch/`).
 */

export type ResourceCategory = "workload" | "service" | "namespace" | "other";

const WORKLOAD_KINDS: ReadonlySet<string> = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "Pod",
]);

export const classify = (manifest: ParsedManifest): ResourceCategory => {
  if (WORKLOAD_KINDS.has(manifest.kind)) return "workload";
  if (manifest.kind === "Service") return "service";
  if (manifest.kind === "Namespace") return "namespace";
  return "other";
};

/**
 * Pod-spec lookup helper — workload kinds хранят podSpec в разных
 * местах:
 *   Deployment / StatefulSet / DaemonSet → spec.template.spec
 *   Job → spec.template.spec
 *   CronJob → spec.jobTemplate.spec.template.spec
 *   Pod → spec
 *
 * Возвращает `undefined` для unknown kinds или malformed manifests.
 */
export const getPodSpec = (
  manifest: ParsedManifest,
): Record<string, unknown> | undefined => {
  const spec = manifest.spec;
  if (!spec) return undefined;
  if (manifest.kind === "Pod") return spec;
  if (manifest.kind === "CronJob") {
    const jobTemplate = (
      spec.jobTemplate as Record<string, unknown> | undefined
    )?.spec as Record<string, unknown> | undefined;
    const template = jobTemplate?.template as
      | Record<string, unknown>
      | undefined;
    return template?.spec as Record<string, unknown> | undefined;
  }
  const template = spec.template as Record<string, unknown> | undefined;
  return template?.spec as Record<string, unknown> | undefined;
};

/**
 * Container array из podSpec. K8s allows multiple containers — typical
 * pattern: один primary + sidecar(s). MVP берёт `containers[0]` как
 * primary; sidecar handling — Phase 3 если кто-то попросит.
 *
 * `initContainers` игнорируем — это lifecycle hooks, не steady-state
 * workload identity.
 */
export const getPrimaryContainer = (
  manifest: ParsedManifest,
): Record<string, unknown> | undefined => {
  const podSpec = getPodSpec(manifest);
  if (!podSpec) return undefined;
  const containers = podSpec.containers;
  if (!Array.isArray(containers) || containers.length === 0) return undefined;
  const first: unknown = containers[0];
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : undefined;
};
