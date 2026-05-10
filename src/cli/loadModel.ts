import path from "node:path";

import consola from "consola";

import type { AactConfig } from "../config";
import { loadPlantumlElements } from "../loaders/plantuml/loadPlantumlElements";
import { mapContainersFromPlantumlElements } from "../loaders/plantuml/mapContainersFromPlantumlElements";
import { loadStructurizrElements } from "../loaders/structurizr/loadStructurizrElements";
import type { ArchitectureModel } from "../model";

const isFileNotFound = (
  err: unknown,
): err is NodeJS.ErrnoException & { code: "ENOENT" } =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code: unknown }).code === "ENOENT";

const exitWithError = (message: string, hint?: string): never => {
  consola.error(message);
  if (hint) consola.info(hint);
  // eslint-disable-next-line n/no-process-exit
  return process.exit(1);
};

// Loader extension point: adding a new source format requires a case here
// plus a discriminant in `AactConfig["source"]["type"]`. Asymmetric to
// `ruleRegistry`, which is data-driven — consider promoting loaders to a
// registry if a third format lands.
export const loadModel = async (
  config: AactConfig,
): Promise<ArchitectureModel> => {
  const resolvedPath = path.resolve(config.source.path);

  try {
    switch (config.source.type) {
      case "plantuml": {
        const elements = await loadPlantumlElements(resolvedPath);
        return mapContainersFromPlantumlElements(elements);
      }
      case "structurizr": {
        return await loadStructurizrElements(resolvedPath);
      }
      default: {
        const sourceType: never = config.source.type;
        throw new Error(`Unsupported source type: ${String(sourceType)}`);
      }
    }
  } catch (error) {
    if (isFileNotFound(error)) {
      return exitWithError(
        `Architecture file not found: ${config.source.path}`,
        "Update source.path in aact.config.ts or create the file (`aact init` scaffolds a starter).",
      );
    }
    if (error instanceof SyntaxError && config.source.type === "structurizr") {
      return exitWithError(
        `Cannot parse Structurizr workspace: ${config.source.path}`,
        `${error.message}. Check that the file is valid JSON.`,
      );
    }
    if (
      error instanceof TypeError &&
      config.source.type === "structurizr" &&
      /softwareSystems|model|people/.test(error.message)
    ) {
      return exitWithError(
        `Invalid Structurizr workspace: ${config.source.path}`,
        'Expected a top-level "model" object with "softwareSystems". See examples/ecommerce-structurizr/ for a working sample.',
      );
    }
    throw error;
  }
};
