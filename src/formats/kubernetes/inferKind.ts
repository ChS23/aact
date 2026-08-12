import type { ElementKind } from "../../model";
import type { CompiledPattern } from "../_shared/imageHeuristic";
import {
  inferKindFromImage,
  parseImage,
  technologyLabel,
} from "../_shared/imageHeuristic";
import { getPrimaryContainer } from "./classify";
import type { ParsedManifest } from "./types";

/**
 * Container-image из k8s podSpec → ElementKind через `_shared`
 * heuristic. Если image отсутствует / unknown — `Container` fallback.
 *
 * Multi-container pods игнорируются по design — берём primary
 * (`containers[0]`). Sidecar/init handling — Phase 3.
 *
 * StatefulSet с `volumeClaimTemplates` НЕ форсирует ContainerDb —
 * image-keyword разруливает correctly (`image: postgres` → DB
 * независимо от StatefulSet vs Deployment). Когда workload — stateful
 * non-DB (типа Elasticsearch на disk-backed PVC), пользователь
 * добавит `aact.kind: ContainerDb` или нужный override.
 */
export const inferElementKindFromManifest = (
  manifest: ParsedManifest,
  compiled: readonly CompiledPattern[],
): ElementKind => {
  const container = getPrimaryContainer(manifest);
  if (!container) return "Container";
  const image = container.image;
  if (typeof image !== "string" || image.length === 0) return "Container";
  const parsed = parseImage(image);
  return inferKindFromImage(parsed.baseName, parsed.repo, compiled);
};

/**
 * Human-readable technology string из manifest'а — primary container's
 * image без digest. Пустая строка если image отсутствует.
 */
export const technologyFromManifest = (
  manifest: ParsedManifest,
): string | undefined => {
  const container = getPrimaryContainer(manifest);
  if (!container) return undefined;
  const image = container.image;
  if (typeof image !== "string" || image.length === 0) return undefined;
  const parsed = parseImage(image);
  const label = technologyLabel(parsed);
  return label.length > 0 ? label : undefined;
};
