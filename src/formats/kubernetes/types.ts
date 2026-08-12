import type { ElementKind, SourceLocation } from "../../model";
import type { CompiledPattern } from "../_shared/imageHeuristic";

/**
 * Public KubernetesLoadOptions — пользователь пишет в
 * `aact.config.ts`: `source.options`.
 *
 * Минимальный surface для Phase 2 MVP. Расширяется аддитивно по
 * реальным запросам (CRDs, Gateway API mapping, multi-cluster
 * federation и т.д.).
 */
export interface KubernetesLoadOptions {
  /** Annotation prefix conventions. Default `"aact"` →
   *  `aact.element`, `aact.kind`, etc. */
  readonly annotations?: {
    readonly prefix?: string;
  };
  /** Namespace filter. Если задан — только workloads в этих ns
   *  попадают в Model. `undefined` = все namespaces. */
  readonly namespaces?: readonly string[];
  /** Skip patterns по `metadata.name`. Поддерживает `*` glob
   *  (`debug-*`, `*-canary`). Альтернатива — `aact.skip: "true"`
   *  annotation per workload. */
  readonly skip?: readonly string[];
  /** Image-keyword → ElementKind override. User patterns
   *  приоритетнее defaults; same semantics as compose. */
  readonly imageHeuristic?: Readonly<Record<string, ElementKind>>;
}

/* ------------------------------------------------------------------ */
/*  Internal parsed shape                                             */
/* ------------------------------------------------------------------ */

/**
 * Один parsed YAML doc (k8s manifest = ровно один resource).
 * Multi-doc YAML файл даёт несколько `ParsedManifest`-ов.
 */
export interface ParsedManifest {
  readonly filePath: string;
  /** 0-based index в multi-doc YAML файле. Single-doc → 0. */
  readonly docIndex: number;
  readonly apiVersion: string;
  /** K8s resource kind (`Deployment` / `Service` / etc) — не C4
   *  ElementKind. См. `classify.ts` для маппинга. */
  readonly kind: string;
  readonly metadata: ParsedMetadata;
  /** Raw spec object — discriminated handling в `toModel.ts`. */
  readonly spec: Record<string, unknown> | undefined;
  /** Полный raw doc для round-trip-debug и forwarded source location'а. */
  readonly raw: Record<string, unknown>;
  /** Опционально: source location ресурса (для terminal-link).
   *  Заполняется когда YAML CST доступен. */
  readonly sourceLocation?: SourceLocation;
}

export interface ParsedMetadata {
  readonly name: string;
  readonly namespace?: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ */
/*  Resolved option keys                                              */
/* ------------------------------------------------------------------ */

/** Зеркалит compose's ResolvedLabelKeys — same convention. */
export interface ResolvedAnnotationKeys {
  readonly element: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly technology: string;
  readonly tags: string;
  readonly external: string;
  readonly link: string;
  readonly skip: string;
  readonly dependsOn: string;
}

export interface ResolvedOptions {
  readonly annotations: ResolvedAnnotationKeys;
  /** undefined = no filter (load all namespaces). */
  readonly namespaces: readonly string[] | undefined;
  readonly skip: readonly string[];
  readonly imageHeuristic: readonly CompiledPattern[];
}
