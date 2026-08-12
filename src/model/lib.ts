import type {
  Boundary,
  Element,
  Model,
  Relation,
  SourceLocation,
} from "./types";

/**
 * O(1) element lookup. Возвращает undefined для dangling references
 * (которые validateModel ловит как ModelIssue).
 */
export const getElement = (m: Model, name: string): Element | undefined =>
  m.elements[name];

/**
 * O(1) boundary lookup.
 */
export const getBoundary = (m: Model, name: string): Boundary | undefined =>
  m.boundaries[name];

/**
 * Resolve целевого Element'а по Relation.to (name-ref). Самый частый
 * pattern в правилах: `isDatabaseElement(targetOf(model, rel))`.
 */
export const targetOf = (m: Model, rel: Relation): Element | undefined =>
  m.elements[rel.to];

/**
 * Single source of truth for "is this element a database?" across
 * rules and analyze. Covers both C4 stdlib database kinds:
 * `ContainerDb` (level-2 container data store) and `ComponentDb`
 * (level-3 component data store). When either kind shows up in a
 * model — Structurizr DSL infers `ContainerDb` from `technology:
 * "postgresql"`, PlantUML stdlib exposes both via `ContainerDb(…)`
 * and `ComponentDb(…)` macros — every consumer (analyze metrics,
 * `crud` repository rule, `dbPerService` ownership rule,
 * Kubernetes generator) treats them identically.
 *
 * Returns `false` for `undefined` so callers can write
 * `isDatabaseElement(getElement(m, name))` without a null guard.
 */
export const isDatabaseElement = (el: Element | undefined): boolean =>
  el?.kind === "ContainerDb" || el?.kind === "ComponentDb";

/** Convenience: kind-only predicate. Useful when you have just the
 *  kind (e.g. iterating `ElementKind` enum values) and don't need
 *  the full `Element` object. */
export const isDatabaseKind = (kind: Element["kind"] | undefined): boolean =>
  kind === "ContainerDb" || kind === "ComponentDb";

/**
 * Все elements в model как массив. Удобно для `.filter()` / `.map()`,
 * когда нужен flat iteration.
 */
export const allElements = (m: Model): Element[] => Object.values(m.elements);

/**
 * Все boundaries в model как массив.
 */
export const allBoundaries = (m: Model): Boundary[] =>
  Object.values(m.boundaries);

/**
 * Format `loc` as the canonical `<file>:<line>:<col>` string. Library-
 * safe — pure data formatter, never emits escape sequences. Used by
 * GitHub annotations, JSON / Slack / PR / dashboard renderers, and as
 * the human-readable inline label whenever a structured
 * `SourceLocation` needs to land in plain text.
 */
export const formatLocation = (loc: SourceLocation): string =>
  `${loc.file}:${loc.start.line}:${loc.start.col}`;

/**
 * Depth-first iteration всех boundaries — от root'ов вглубь. Visited set
 * защищает от accidental cycles (validateModel ловит их явно).
 */
export const walkBoundaries = function* (m: Model): Generator<Boundary> {
  const visited = new Set<string>();
  const visit = function* (name: string): Generator<Boundary> {
    if (visited.has(name)) return;
    visited.add(name);
    const b = m.boundaries[name];
    if (!b) return;
    yield b;
    for (const child of b.boundaryNames) yield* visit(child);
  };
  for (const root of m.rootBoundaryNames) yield* visit(root);
};
