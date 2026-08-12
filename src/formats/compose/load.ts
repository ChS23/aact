import type { LoadResult } from "../types";
import { resolveIncludes } from "./include";
import { toModel } from "./toModel";
import type { ComposeLoadOptions } from "./types";

/**
 * Public entry point Compose Format'а. Принимает путь к compose-файлу
 * (entry), резолвит `include:` цепочку, мерджит, проектирует в Model.
 *
 * Options передаются от `AactConfig.source.options` через CLI runner
 * → `Format.load(path, options)`. Если caller не передаёт options —
 * loader использует defaults (наiming = "as-is", image heuristic =
 * built-in `postgres`/`kafka`/etc, никаких skip / overrides /
 * profiles).
 */
export const load = async (
  path: string,
  options?: unknown,
): Promise<LoadResult> => {
  const composeOptions = (options ?? {}) as ComposeLoadOptions;
  const resolved = await resolveIncludes(path);
  const { model, issues } = toModel({
    entryFile: path,
    files: resolved.files,
    options: composeOptions,
  });
  return {
    model,
    issues: [...resolved.issues, ...issues],
  };
};
