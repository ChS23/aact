import { classify } from "./classify";
import type { ParsedManifest } from "./types";

/**
 * Service → workload mapping.
 *
 * K8s Service'ы — service discovery layer: они НЕ Element'ы C4 модели,
 * но "обозначают" workload (или группу workload'ов) по lookup'у DNS-name.
 * Чтобы построить Relation между workload A и workload B мы парсим env
 * vars A на ссылки `orders-svc` / `http://orders-svc:8080`, и через
 * этот mapping находим Element'ы которые они на самом деле адресуют.
 *
 * Один Service может match'ить нескольким workload'ам по selector
 * (Deployment + StatefulSet с одним label app=orders). Возвращаем list.
 *
 * Service.spec.selector — flat map (k8s legacy form). Modern Deployment
 * `spec.selector.matchLabels` это PER-DEPLOYMENT selector, отдельный
 * concept — не путаем.
 *
 * Workload labels lookup priority:
 *   1. spec.template.metadata.labels (что Service реально matches)
 *   2. metadata.labels (legacy fallback)
 *
 * Selector с `matchLabels` / `matchExpressions` (новая API form) тоже
 * support'ится, но опасно reaching deep — MVP читает только `selector`.
 * Если кому-то нужен matchExpressions — Phase 3.
 */

export interface ServiceMap {
  /**
   * Service `metadata.name` → array of workload element names which
   * this Service exposes. Множественность — если selector матчит
   * несколько workloads.
   */
  readonly byName: ReadonlyMap<string, ReadonlyArray<string>>;
}

const getServiceSelector = (
  service: ParsedManifest,
): Readonly<Record<string, string>> | undefined => {
  const spec = service.spec;
  if (!spec) return undefined;
  const selector = spec.selector;
  if (!selector || typeof selector !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(selector as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

const getWorkloadLabels = (
  workload: ParsedManifest,
): Readonly<Record<string, string>> => {
  const spec = workload.spec;
  if (!spec) return {};
  // K8s workloads carry pod-template labels at spec.template.metadata.labels.
  // CronJob nests deeper — spec.jobTemplate.spec.template.metadata.labels.
  let template = spec.template as Record<string, unknown> | undefined;
  if (workload.kind === "CronJob") {
    const jobTemplate = (
      spec.jobTemplate as Record<string, unknown> | undefined
    )?.spec as Record<string, unknown> | undefined;
    template = jobTemplate?.template as Record<string, unknown> | undefined;
  }
  if (workload.kind === "Pod") {
    return workload.metadata.labels;
  }
  const tplMeta = template?.metadata as Record<string, unknown> | undefined;
  const labels = tplMeta?.labels;
  if (!labels || typeof labels !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

const matchesSelector = (
  workloadLabels: Readonly<Record<string, string>>,
  selector: Readonly<Record<string, string>>,
): boolean => {
  for (const [k, v] of Object.entries(selector)) {
    if (workloadLabels[k] !== v) return false;
  }
  // Empty selector НЕ матчит всё (это безопаснее — k8s spec говорит
  // что Service без selector никого не cover'ит вообще).
  return Object.keys(selector).length > 0;
};

/**
 * Build Service → workload-names index. Используется в `relations.ts`
 * для разрешения env-var ссылок (`ORDERS_SVC_HOST=orders-svc` →
 * relation в workload который orders-svc exposes).
 *
 * Workload index — `workloadElementNames` это пара (manifest, derived
 * element name) — мы хотим element-name, потому что aact.element
 * annotation мог переименовать.
 */
export const buildServiceMap = (
  manifests: readonly ParsedManifest[],
  workloadElementNames: ReadonlyMap<ParsedManifest, string>,
): ServiceMap => {
  const byName = new Map<string, readonly string[]>();
  const services = manifests.filter((m) => classify(m) === "service");
  const workloads = manifests.filter((m) => classify(m) === "workload");

  for (const service of services) {
    const selector = getServiceSelector(service);
    if (!selector) continue;
    const matched: string[] = [];
    for (const wl of workloads) {
      const elName = workloadElementNames.get(wl);
      if (elName === undefined) continue; // skipped workload
      if (matchesSelector(getWorkloadLabels(wl), selector)) {
        matched.push(elName);
      }
    }
    if (matched.length > 0) {
      byName.set(service.metadata.name, Object.freeze(matched));
    }
  }

  return Object.freeze({ byName });
};
