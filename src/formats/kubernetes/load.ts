import type { LoadResult } from "../types";
import { toModel } from "./toModel";
import type { KubernetesLoadOptions } from "./types";
import { walkManifests } from "./walkManifests";

/**
 * Public load entry. Принимает path к одному манифесту или директории
 * с manifest'ами, возвращает `{ model, issues }` контракт.
 *
 * Options (нелокальные значения) приходят через `aact.config.ts:
 * source.options` — см. `KubernetesLoadOptions`.
 */
export const load = async (
  filePath: string,
  options?: unknown,
): Promise<LoadResult> => {
  const typedOptions =
    options && typeof options === "object"
      ? (options as KubernetesLoadOptions)
      : undefined;
  const walked = await walkManifests(filePath);
  const built = toModel({
    manifests: walked.manifests,
    options: typedOptions,
  });
  return {
    model: built.model,
    issues: [...walked.issues, ...built.issues],
  };
};
