import type { AactConfig, Model, ModelIssue } from "aact";
import { canLoad, loadFormat } from "aact";

/**
 * Load the normalised Model from `aact.config.ts`'s `source`.
 *
 * The companion deliberately routes through aact's public format
 * registry instead of forking a loader — every format aact already
 * supports (PUML, Structurizr DSL/JSON, model-json) flows through
 * here automatically, and a third-party format added to the registry
 * works in the workbench the moment it's installed.
 *
 * `config.source.path` is already absolute after
 * `loadAndValidateConfig` ran upstream in the core CLI; the
 * companion treats it as read-only data.
 */
export interface ModelLoadResult {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
}

export const loadModelFromConfig = async (
  config: AactConfig,
): Promise<ModelLoadResult> => {
  const source =
    typeof config.source === "string"
      ? { type: undefined, path: config.source, options: undefined }
      : config.source;

  if (!source.type) {
    throw new Error(
      `aact config source.type is required for view (got "${source.path}" without type)`,
    );
  }

  const format = await loadFormat(source.type);
  if (!canLoad(format)) {
    throw new Error(
      `Format "${source.type}" cannot load — load capability missing`,
    );
  }

  // Pass source.options so compose/kubernetes load the same Model the core
  // CLI (`aact check` / `model` / `diff`) sees — not a default-options variant.
  return format.load(source.path, source.options);
};
