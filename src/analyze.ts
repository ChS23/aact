import type { Boundary, Element, ElementKind, Model, Relation } from "./model";
import { allElements, getBoundary, isDatabaseElement } from "./model";
import { matchesAnyName } from "./rules/lib/namingPatterns";

export interface CouplingRelation {
  readonly from: string;
  readonly to: string;
}

/** Sync/async classification for a single relation. */
export type RelationStyle = "sync" | "async" | "unspecified";

export interface BoundaryAnalysis {
  readonly name: string;
  readonly label: string;
  /** Edges that start and end inside this boundary's element set. */
  readonly cohesion: number;
  /** Edges that cross this boundary's element set — going either to a
   *  sibling sub-boundary, to an unrelated element, or outside the
   *  parent's scope (attributed to the parent in that case). */
  readonly coupling: number;
  /** Of `coupling`, how many are classified as synchronous interactions. */
  readonly syncCoupling: number;
  readonly asyncCoupling: number;
  readonly unspecifiedCoupling: number;
  /** `cohesion / (cohesion + coupling)` — 1.0 = pure cluster, 0.0 = boundary
   *  is fiction over a chatty graph. `null` when both numerator and
   *  denominator are 0 (empty boundary). */
  readonly ratio: number | null;
  readonly couplingRelations: readonly CouplingRelation[];
}

/**
 * Mutable builder for the analyzer's internal accumulation pass — the
 * public `BoundaryAnalysis` is readonly. A finished builder is structurally
 * assignable to `BoundaryAnalysis`, so callers hand it back unchanged.
 */
interface MutableBoundaryAnalysis {
  name: string;
  label: string;
  cohesion: number;
  coupling: number;
  syncCoupling: number;
  asyncCoupling: number;
  unspecifiedCoupling: number;
  ratio: number | null;
  couplingRelations: CouplingRelation[];
}

export interface DatabasesInfo {
  readonly count: number;
  readonly consumes: number;
}

export interface ElementCoupling {
  readonly name: string;
  readonly count: number;
}

export interface CyclesInfo {
  /** Number of strongly-connected components with > 1 element. Self-loops
   *  (single-element cycles) are surfaced by `validateModel` as
   *  `self-relation` issues and excluded from this count to avoid
   *  double-counting. */
  readonly count: number;
  /** Element names of the smallest non-trivial cycle, in traversal order.
   *  `null` when no cycles exist. */
  readonly smallest: readonly string[] | null;
}

export interface RelationStyleCounts {
  readonly sync: number;
  readonly async: number;
  readonly unspecified: number;
}

export interface AnalysisReport {
  readonly elementsCount: number;
  /** Per-`ElementKind` count — sanity overview ("we have 12 Containers and
   *  3 ContainerDbs"). */
  readonly elementsByKind: Readonly<Partial<Record<ElementKind, number>>>;
  readonly databases: DatabasesInfo;
  /** Sync / async / unspecified breakdown of all relations in the model.
   *  Classified by tag first, then by `analyze.{syncTechnologies,asyncTechnologies}`
   *  fallback if configured. */
  readonly relationsByStyle: RelationStyleCounts;
  readonly boundaries: readonly BoundaryAnalysis[];
  /** Top-N elements by incoming relations (afferent coupling). Honours
   *  `analyze.exclude` to drop infrastructure noise from the ranking. */
  readonly fanIn: readonly ElementCoupling[];
  /** Top-N elements by outgoing relations (efferent coupling). Same
   *  `exclude` rules as `fanIn`. */
  readonly fanOut: readonly ElementCoupling[];
  readonly cycles: CyclesInfo;
}

export interface AnalyzedArchitecture {
  readonly model: Model;
  readonly report: AnalysisReport;
}

interface RelationWithSource {
  from: Element;
  relation: Relation;
}

/**
 * Analyzer configuration. All fields optional — defaults give pure
 * tag-driven classification with no exclude filter and `topN = 5`.
 *
 * Plumbed from `aact.config.ts → analyze` at the CLI layer; library
 * users pass directly to `analyzeArchitecture(model, options)`.
 */
export interface AnalyzeOptions {
  /** Technology substrings (case-insensitive) that classify a relation
   *  as synchronous when it has no explicit `sync`/`async` tag.
   *  Empty by default — opt-in only. Matched against `Relation.technology`. */
  readonly syncTechnologies?: readonly string[];
  /** Technology substrings (case-insensitive) for async fallback.
   *  Empty by default. */
  readonly asyncTechnologies?: readonly string[];
  /** Filter noise (shared infra, libraries) from element-level fan-in /
   *  fan-out rankings. Does NOT affect boundary cohesion/coupling or
   *  cycle detection — those are structural and the excluded element's
   *  edges still count for other elements. */
  readonly exclude?: {
    readonly tags?: readonly string[];
    readonly namePatterns?: readonly string[];
  };
  /** How many top fan-in / fan-out hotspots to surface. Default 5. */
  readonly topN?: number;
}

const DEFAULT_TOP_N = 5;

const matchesAnyTech = (tech: string, patterns: readonly string[]): boolean => {
  const lower = tech.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
};

const classifyStyle = (
  relation: Relation,
  options: AnalyzeOptions | undefined,
): RelationStyle => {
  // Tag is the explicit, DSL-portable signal — Structurizr DSL emits
  // `async` from `interactionStyle: "Asynchronous"`, PUML users tag
  // manually. Always preferred over the technology heuristic.
  if (relation.tags.includes("async")) return "async";
  if (relation.tags.includes("sync")) return "sync";
  const tech = relation.technology;
  if (!tech) return "unspecified";
  const sync = options?.syncTechnologies ?? [];
  const async = options?.asyncTechnologies ?? [];
  if (async.length > 0 && matchesAnyTech(tech, async)) return "async";
  if (sync.length > 0 && matchesAnyTech(tech, sync)) return "sync";
  return "unspecified";
};

const allRelations = (model: Model): RelationWithSource[] =>
  allElements(model).flatMap((element) =>
    element.relations.map((relation) => ({ from: element, relation })),
  );

const incrementStyleBucket = (
  boundary: MutableBoundaryAnalysis,
  style: RelationStyle,
): void => {
  if (style === "sync") boundary.syncCoupling++;
  else if (style === "async") boundary.asyncCoupling++;
  else boundary.unspecifiedCoupling++;
};

const classifyRelationForBoundary = (
  names: Set<string>,
  childNames: Set<string> | undefined,
  parentBoundary: Boundary | undefined,
  from: Element,
  relation: Relation,
  style: RelationStyle,
  result: MutableBoundaryAnalysis,
  parentResult: MutableBoundaryAnalysis | undefined,
): void => {
  if (!names.has(from.name)) return;

  if (names.has(relation.to)) {
    result.cohesion++;
    return;
  }

  const isInParentSibling = childNames?.has(relation.to) ?? false;

  if (!parentBoundary || isInParentSibling) {
    result.coupling++;
    incrementStyleBucket(result, style);
    result.couplingRelations.push({ from: from.name, to: relation.to });
    if (parentResult) parentResult.cohesion++;
  } else if (parentResult) {
    parentResult.coupling++;
    incrementStyleBucket(parentResult, style);
    parentResult.couplingRelations.push({
      from: from.name,
      to: relation.to,
    });
  }
};

interface BoundaryLookups {
  nameSet: Set<string>;
  childNames: Set<string> | undefined;
  parentBoundary: Boundary | undefined;
}

const buildBoundaryLookups = (model: Model): Map<string, BoundaryLookups> => {
  const boundaries = Object.values(model.boundaries);
  const nameSets = new Map(
    boundaries.map((b) => [b.name, new Set(b.elementNames)]),
  );

  const parentMap = new Map<string, Boundary>();
  for (const b of boundaries) {
    for (const childName of b.boundaryNames) {
      const child = getBoundary(model, childName);
      if (child) parentMap.set(child.name, b);
    }
  }

  const result = new Map<string, BoundaryLookups>();
  for (const b of boundaries) {
    const parentBoundary = parentMap.get(b.name);
    let childNames: Set<string> | undefined;
    if (parentBoundary) {
      childNames = new Set<string>();
      for (const siblingName of parentBoundary.boundaryNames) {
        const sibling = getBoundary(model, siblingName);
        if (sibling) {
          for (const cName of sibling.elementNames) childNames.add(cName);
        }
      }
    }
    result.set(b.name, {
      nameSet: nameSets.get(b.name)!,
      childNames,
      parentBoundary,
    });
  }
  return result;
};

const computeRatio = (cohesion: number, coupling: number): number | null => {
  const total = cohesion + coupling;
  if (total === 0) return null;
  return cohesion / total;
};

const analyzeBoundaries = (
  model: Model,
  relations: readonly RelationWithSource[],
  styles: ReadonlyMap<Relation, RelationStyle>,
): BoundaryAnalysis[] => {
  const lookups = buildBoundaryLookups(model);
  const results = new Map<string, MutableBoundaryAnalysis>();
  for (const boundary of Object.values(model.boundaries)) {
    results.set(boundary.name, {
      name: boundary.name,
      label: boundary.label,
      cohesion: 0,
      coupling: 0,
      syncCoupling: 0,
      asyncCoupling: 0,
      unspecifiedCoupling: 0,
      ratio: null,
      couplingRelations: [],
    });
  }
  for (const boundary of Object.values(model.boundaries)) {
    const { nameSet, childNames, parentBoundary } = lookups.get(boundary.name)!;
    const result = results.get(boundary.name)!;
    const parentResult = parentBoundary
      ? results.get(parentBoundary.name)
      : undefined;
    for (const { from, relation } of relations) {
      classifyRelationForBoundary(
        nameSet,
        childNames,
        parentBoundary,
        from,
        relation,
        styles.get(relation) ?? "unspecified",
        result,
        parentResult,
      );
    }
  }
  // Finalise ratio for each boundary
  for (const r of results.values()) {
    r.ratio = computeRatio(r.cohesion, r.coupling);
  }
  return [...results.values()];
};

const analyzeDatabases = (model: Model): DatabasesInfo => {
  const dbNames = new Set(
    allElements(model)
      .filter((it) => isDatabaseElement(it))
      .map((it) => it.name),
  );
  let consumes = 0;
  for (const element of allElements(model)) {
    for (const r of element.relations) {
      if (dbNames.has(r.to)) consumes++;
    }
  }
  return { count: dbNames.size, consumes };
};

const countByKind = (model: Model): Partial<Record<ElementKind, number>> => {
  const out: Partial<Record<ElementKind, number>> = {};
  for (const el of allElements(model)) {
    out[el.kind] = (out[el.kind] ?? 0) + 1;
  }
  return out;
};

const isExcluded = (
  el: Element,
  options: AnalyzeOptions | undefined,
): boolean => {
  const tags = options?.exclude?.tags;
  if (tags?.some((t) => el.tags.includes(t))) return true;
  const patterns = options?.exclude?.namePatterns;
  if (patterns && patterns.length > 0 && matchesAnyName(el.name, patterns)) {
    return true;
  }
  return false;
};

const topN = <T extends { count: number }>(
  items: readonly T[],
  n: number,
): T[] =>
  [...items]
    .filter((it) => it.count > 0)
    .sort((a, b) => b.count - a.count || 0)
    .slice(0, n);

const analyzeHotspots = (
  model: Model,
  options: AnalyzeOptions | undefined,
): { fanIn: ElementCoupling[]; fanOut: ElementCoupling[] } => {
  const elements = allElements(model);
  const elementNames = new Set(elements.map((e) => e.name));
  const inCounts = new Map<string, number>();
  const outCounts = new Map<string, number>();
  for (const el of elements) {
    outCounts.set(el.name, 0);
    inCounts.set(el.name, 0);
  }
  for (const el of elements) {
    for (const r of el.relations) {
      // Edges to dangling targets still count as outgoing — the relation
      // exists in source; validateModel surfaces the danglingness
      // separately. We just don't credit a non-existent element with
      // an incoming edge.
      outCounts.set(el.name, (outCounts.get(el.name) ?? 0) + 1);
      if (elementNames.has(r.to)) {
        inCounts.set(r.to, (inCounts.get(r.to) ?? 0) + 1);
      }
    }
  }
  const limit = options?.topN ?? DEFAULT_TOP_N;
  const eligible = elements.filter((e) => !isExcluded(e, options));
  const fanIn = topN(
    eligible.map((e) => ({ name: e.name, count: inCounts.get(e.name) ?? 0 })),
    limit,
  );
  const fanOut = topN(
    eligible.map((e) => ({ name: e.name, count: outCounts.get(e.name) ?? 0 })),
    limit,
  );
  return { fanIn, fanOut };
};

/**
 * Tarjan's strongly-connected-components — single linear pass, gives all
 * SCCs of the element graph in O(V + E). An SCC of size > 1 is a true
 * cycle ("distributed monolith" risk); single-element SCCs with a
 * self-edge are surfaced by `validateModel` as `self-relation` issues
 * and intentionally excluded here.
 *
 * Implemented recursively — Node.js default stack handles the C4 scale
 * comfortably (V ≤ a few thousand). If the analyser ever runs against
 * model graphs that approach Node's stack limit, swap for an explicit
 * worklist; the algorithm itself is stack-based but the recursion is
 * the simplest faithful translation.
 */
const findCycles = (model: Model): CyclesInfo => {
  const elements = allElements(model);
  const elementNames = new Set(elements.map((e) => e.name));
  const adjacency = new Map<string, string[]>();
  for (const el of elements) {
    adjacency.set(
      el.name,
      el.relations.map((r) => r.to).filter((to) => elementNames.has(to)),
    );
  }
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  };

  for (const v of elementNames) {
    if (!indices.has(v)) strongconnect(v);
  }

  // Filter to actual cycles: SCCs with size > 1. Self-loops (size-1
  // SCCs with a self-edge) are surfaced as ModelIssue separately.
  const cycles = sccs.filter((scc) => scc.length > 1);
  if (cycles.length === 0) return { count: 0, smallest: null };
  cycles.sort((a, b) => a.length - b.length);
  return { count: cycles.length, smallest: cycles[0] };
};

const analyzeModel = (
  model: Model,
  options?: AnalyzeOptions,
): AnalysisReport => {
  const relations = allRelations(model);
  const styles = new Map<Relation, RelationStyle>(
    relations.map(({ relation }) => [
      relation,
      classifyStyle(relation, options),
    ]),
  );
  const counts = {
    sync: 0,
    async: 0,
    unspecified: 0,
  };
  for (const style of styles.values()) {
    counts[style]++;
  }

  const boundaries = analyzeBoundaries(model, relations, styles);
  const { fanIn, fanOut } = analyzeHotspots(model, options);

  return {
    elementsCount: allElements(model).length,
    elementsByKind: countByKind(model),
    databases: analyzeDatabases(model),
    relationsByStyle: counts,
    boundaries,
    fanIn,
    fanOut,
    cycles: findCycles(model),
  };
};

export const analyzeArchitecture = (
  model: Model,
  options?: AnalyzeOptions,
): AnalyzedArchitecture => ({
  model,
  report: analyzeModel(model, options),
});
