import type { Format } from "./types";

/**
 * Format registry. Каждый формат регистрируется как entry в этом array'е.
 * Добавление нового формата (Mermaid в v3.1, Compose в v3.x, LikeC4 в v3.x) =
 * одна строчка `import` + одна в массиве — zero core changes.
 *
 * Lazy import через dynamic () => Promise — не утяжеляет CLI cold start
 * импортами формата, который пользователю не нужен.
 */
type FormatLoader = () => Promise<Format>;

const formatLoaders: Readonly<Record<string, FormatLoader>> = Object.freeze({
  plantuml: () => import("./plantuml").then((m) => m.plantumlFormat),
  // Register order matters for auto-detect: knownFormatNames() iterates
  // in insertion order. Keep `structurizr` before `model-json` so a
  // file literally named `workspace.json` resolves to structurizr
  // (exact-basename match) before model-json's `*.aact.json` is even
  // consulted. Patterns don't overlap today, but order is defensive
  // documentation for the next contributor adding a `.json` format.
  structurizr: () => import("./structurizr").then((m) => m.structurizrFormat),
  "model-json": () => import("./model-json").then((m) => m.modelJsonFormat),
  kubernetes: () => import("./kubernetes").then((m) => m.kubernetesFormat),
  compose: () => import("./compose").then((m) => m.composeFormat),
});

/**
 * Async lookup формата по name. Throws если name unknown — let caller
 * surface user-facing error с config context.
 */
export const loadFormat = async (name: string): Promise<Format> => {
  const loader = formatLoaders[name];
  if (!loader) {
    throw new Error(
      `Unknown format "${name}". Known formats: ${Object.keys(formatLoaders).join(", ")}.`,
    );
  }
  return loader();
};

/** Все зарегистрированные имена форматов. CLI `init` использует для prompt'а. */
export const knownFormatNames = (): readonly string[] =>
  Object.keys(formatLoaders);
