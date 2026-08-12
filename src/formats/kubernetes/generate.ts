import YAML from "yaml";

import type { Element, Model, Relation } from "../../model";
import { isDatabaseKind } from "../../model";
import type { FormatOutput } from "../types";
import { FormatGenerationError } from "../types";

export interface KubernetesGenerateOptions {
  /** Container port for non-database workloads (default 8080). */
  readonly defaultPort?: number;
  /** DB connection string template; `{service}` / `{db}` are substituted
   *  (default `postgresql://app:secret@{service}:5432/{db}`). */
  readonly dbConnectionTemplate?: string;
}

/**
 * Model → real, `kubectl apply`-able Kubernetes manifests (targets the
 * current stable API: `apps/v1` Deployment / StatefulSet, `v1` Service /
 * Namespace). One file per workload (Deployment|StatefulSet + its
 * Service), plus a `namespaces.yaml` for the boundaries.
 *
 * This is a **scaffold**, not a deployment source of truth: the C4 model
 * carries no resources / probes / secrets / ingress, so those are left
 * for your Helm / Kustomize setup. What it does capture round-trips —
 * `aact.*` annotations preserve kind / technology / tags / element name,
 * and relations become env-var service references that `load` reads back,
 * so `generate` → `load` reproduces the model.
 */

const trimDashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (value[start] === "-") start++;
  while (end > start && value[end - 1] === "-") end--;
  return value.slice(start, end);
};

const toKebab = (name: string): string => {
  const normalized = trimDashes(
    [...name.toLowerCase()]
      .map((char) => (/[a-z0-9]/u.test(char) ? char : "-"))
      .join(""),
  );
  const truncated = trimDashes(normalized.slice(0, 63));
  if (truncated.length === 0) {
    throw new FormatGenerationError(
      `Kubernetes cannot derive a DNS-1123 name from ${JSON.stringify(name)}. Rename the element or boundary using lowercase letters, digits, or hyphens.`,
      { name },
    );
  }
  return truncated;
};
const toEnvKey = (name: string): string =>
  name.replaceAll("-", "_").toUpperCase();
const serviceName = (kebab: string): string =>
  `${trimDashes(kebab.slice(0, 59))}-svc`;

const isDeployable = (e: Element): boolean =>
  !e.external &&
  (e.kind === "Container" ||
    e.kind === "ContainerDb" ||
    e.kind === "ContainerQueue");

const workloadKind = (kind: Element["kind"]): "Deployment" | "StatefulSet" =>
  kind === "ContainerDb" || kind === "ContainerQueue"
    ? "StatefulSet"
    : "Deployment";

/** A bare technology label (`PostgreSQL`, `Node.js`) isn't an image; only
 *  treat it as one when it carries an image marker (`:tag` or `registry/`). */
const looksLikeImage = (tech: string): boolean =>
  !tech.includes(" ") && (tech.includes(":") || tech.includes("/"));

const imageFor = (e: Element): string => {
  const tech = e.technology?.trim();
  if (tech && looksLikeImage(tech)) return tech.toLowerCase();
  if (isDatabaseKind(e.kind)) return "postgres:16";
  if (e.kind === "ContainerQueue") return "rabbitmq:3";
  return `${toKebab(e.name)}:latest`;
};

const portFor = (e: Element, defaultPort: number): number => {
  if (e.kind === "ContainerDb") return 5432;
  if (e.kind === "ContainerQueue") return 5672;
  return defaultPort;
};

/** Element name → namespace (the boundary it sits in), if any. */
const namespaceIndex = (model: Model): Map<string, string> => {
  const index = new Map<string, string>();
  for (const boundary of Object.values(model.boundaries)) {
    for (const name of boundary.elementNames) {
      index.set(name, toKebab(boundary.name));
    }
  }
  return index;
};

const assertUniqueDnsNames = (
  names: readonly string[],
  kind: "element" | "boundary",
  normalize: (name: string) => string = toKebab,
): void => {
  const originalsByNormalized = new Map<string, string>();
  for (const name of names) {
    const normalized = normalize(name);
    const previous = originalsByNormalized.get(normalized);
    if (previous && previous !== name) {
      throw new FormatGenerationError(
        `Kubernetes DNS-1123 name collision: ${JSON.stringify(previous)} and ${JSON.stringify(name)} both normalize to ${JSON.stringify(normalized)}. Rename one of them.`,
        { kind, first: previous, second: name, normalized },
      );
    }
    originalsByNormalized.set(normalized, name);
  }
};

const aactAnnotations = (e: Element): Record<string, string> => {
  const kebab = toKebab(e.name);
  return {
    // Pin the C4 kind: a placeholder image alone wouldn't round-trip it.
    "aact.kind": e.kind,
    ...(e.technology ? { "aact.technology": e.technology } : {}),
    ...(e.description ? { "aact.description": e.description } : {}),
    ...(e.tags.length > 0 ? { "aact.tags": e.tags.join(",") } : {}),
    // The Model name carries underscores DNS-1123 can't; preserve it.
    ...(kebab === e.name ? {} : { "aact.element": e.name }),
  };
};

const buildEnvVar = (
  relation: Relation,
  target: Element | undefined,
  defaultPort: number,
  dbTemplate: string,
): { name: string; value: string } | undefined => {
  if (!target) return undefined;
  const targetKebab = toKebab(relation.to);
  const svc = serviceName(targetKebab);
  const upper = toEnvKey(targetKebab);

  if (isDatabaseKind(target.kind)) {
    const value = dbTemplate
      .replaceAll("{service}", svc)
      .replaceAll("{db}", targetKebab)
      .replaceAll("{name}", targetKebab);
    return { name: `${upper}_URL`, value };
  }
  if (target.external) {
    return {
      name: `${upper}_URL`,
      value: relation.technology ?? `https://${targetKebab}`,
    };
  }
  return {
    name: `${upper}_URL`,
    value: `http://${svc}:${portFor(target, defaultPort)}`,
  };
};

const buildWorkload = (
  e: Element,
  model: Model,
  namespace: string | undefined,
  defaultPort: number,
  dbTemplate: string,
): Record<string, unknown> => {
  const kebab = toKebab(e.name);
  const kind = workloadKind(e.kind);
  const port = portFor(e, defaultPort);

  const env = e.relations
    .map((r) => buildEnvVar(r, model.elements[r.to], defaultPort, dbTemplate))
    .filter((v): v is { name: string; value: string } => v !== undefined)
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const container: Record<string, unknown> = {
    name: kebab,
    image: imageFor(e),
    ports: [{ containerPort: port }],
    ...(env.length > 0 ? { env } : {}),
  };

  const spec: Record<string, unknown> = {
    replicas: 1,
    selector: { matchLabels: { app: kebab } },
    ...(kind === "StatefulSet" ? { serviceName: serviceName(kebab) } : {}),
    template: {
      metadata: { labels: { app: kebab } },
      spec: { containers: [container] },
    },
  };

  return {
    apiVersion: "apps/v1",
    kind,
    metadata: {
      name: kebab,
      ...(namespace ? { namespace } : {}),
      annotations: aactAnnotations(e),
    },
    spec,
  };
};

const buildService = (
  e: Element,
  namespace: string | undefined,
  defaultPort: number,
): Record<string, unknown> => {
  const kebab = toKebab(e.name);
  const port = portFor(e, defaultPort);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName(kebab),
      ...(namespace ? { namespace } : {}),
    },
    spec: {
      selector: { app: kebab },
      ports: [{ port, targetPort: port }],
    },
  };
};

const stringifyDocs = (docs: readonly unknown[]): string =>
  docs.map((d) => YAML.stringify(d)).join("---\n");

export const generate = (
  model: Model,
  options?: KubernetesGenerateOptions,
): FormatOutput => {
  const defaultPort = options?.defaultPort ?? 8080;
  const dbTemplate =
    options?.dbConnectionTemplate ??
    "postgresql://app:secret@{service}:5432/{db}";

  const workloads = Object.values(model.elements).filter(isDeployable);
  assertUniqueDnsNames(
    workloads.map((e) => e.name),
    "element",
  );
  assertUniqueDnsNames(
    workloads.map((e) => e.name),
    "element",
    (name) => serviceName(toKebab(name)),
  );
  const boundaryNames = Object.values(model.boundaries)
    .filter((boundary) =>
      boundary.elementNames.some((name) =>
        workloads.some((workload) => workload.name === name),
      ),
    )
    .map((boundary) => boundary.name);
  assertUniqueDnsNames(boundaryNames, "boundary");
  const nsIndex = namespaceIndex(model);

  const workloadFiles = workloads.map((e) => {
    const namespace = nsIndex.get(e.name);
    return {
      path: `${toKebab(e.name)}.yaml`,
      content: stringifyDocs([
        buildWorkload(e, model, namespace, defaultPort, dbTemplate),
        buildService(e, namespace, defaultPort),
      ]),
    };
  });

  // Namespaces the workloads land in — emitted first so the output applies
  // cleanly (`kubectl apply -f .` creates the namespace before the workload).
  const namespaces = [...new Set(workloads.map((e) => nsIndex.get(e.name)))]
    .filter((ns): ns is string => ns !== undefined)
    .toSorted((a, b) => a.localeCompare(b));
  const namespaceFiles =
    namespaces.length > 0
      ? [
          {
            path: "namespaces.yaml",
            content: stringifyDocs(
              namespaces.map((ns) => ({
                apiVersion: "v1",
                kind: "Namespace",
                metadata: { name: ns },
              })),
            ),
          },
        ]
      : [];

  return { files: [...namespaceFiles, ...workloadFiles] };
};
