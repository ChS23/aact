import type { Element, ElementKind, Model } from "./types";

/**
 * Issue найденный validateModel — проблема в loader output'е, которую
 * раньше silent drop'ало (Structurizr component relations, PlantUML
 * dangling Rel'ы, duplicate names при load collision).
 *
 * CLI решает severity: dangling/duplicate/cycle — fail, unknown-kind/
 * self-relation — warn.
 */
export type ModelIssue =
  | { kind: "dangling-relation"; from: string; to: string }
  | {
      kind: "element-in-boundary-not-in-model";
      element: string;
      boundary: string;
    }
  | { kind: "boundary-not-in-model"; parent: string; child: string }
  | { kind: "boundary-cycle"; path: readonly string[] }
  | { kind: "duplicate-element-name"; name: string }
  | { kind: "duplicate-boundary-name"; name: string }
  /** Two distinct elements registered under the same DSL identifier
   * (`api = container "X"` then `api = container "Y"` later). Reference
   * Structurizr throws on this; we surface it as an issue so the linter
   * runs all rules but the user sees the collision. */
  | { kind: "duplicate-identifier"; identifier: string }
  | { kind: "self-relation"; element: string }
  | { kind: "unknown-kind"; element: string; raw: string }
  /**
   * Generic loader-emitted warning — для format-specific сообщений
   * которые не укладываются в фиксированные validation kinds выше.
   * `source` — имя формата ("compose" / "kubernetes" / ...), `code` —
   * sub-classification внутри формата ("version-obsolete" / "extends-
   * unsupported" / etc). Не блокирующее, не приводит к exitCode 1
   * автоматически — CLI текстовый рендер показывает как warn.
   */
  | {
      kind: "loader-warning";
      source: string;
      code: string;
      message: string;
      element?: string;
    };

const KNOWN_KINDS = new Set<ElementKind>([
  "Person",
  "System",
  "Container",
  "ContainerDb",
  "ContainerQueue",
  "Component",
  "ComponentDb",
  "ComponentQueue",
]);

/**
 * Single-pass O(V + E) проверка инвариантов Model. Loader'ы зовут после
 * построения; CLI surfaces issues пользователю с file:line context (если
 * SourceLocation заполнен).
 *
 * Duplicate names ловятся на loader-side (Record overwrites молча) — loader
 * должен явно проверять collision перед insertion и добавлять issue, либо
 * validateModel может опираться на тот факт, что Record не сохранит дубликат.
 * Здесь мы проверяем по уже-построенной Model — duplicates physically не
 * могут быть, но мы оставляем тип в union для loader'а / future use.
 */
export const validateModel = (model: Model): ModelIssue[] => {
  const issues: ModelIssue[] = [];

  // Element-level checks: relations targets, kinds, self-loops
  for (const element of Object.values(model.elements)) {
    if (!KNOWN_KINDS.has(element.kind)) {
      issues.push({
        kind: "unknown-kind",
        element: element.name,
        raw: element.kind,
      });
    }

    for (const rel of element.relations) {
      if (rel.to === element.name) {
        issues.push({ kind: "self-relation", element: element.name });
        continue;
      }
      if (!(rel.to in model.elements)) {
        issues.push({
          kind: "dangling-relation",
          from: element.name,
          to: rel.to,
        });
      }
    }
  }

  // Boundary-level checks: child element refs, child boundary refs
  for (const boundary of Object.values(model.boundaries)) {
    for (const elementName of boundary.elementNames) {
      if (!(elementName in model.elements)) {
        issues.push({
          kind: "element-in-boundary-not-in-model",
          element: elementName,
          boundary: boundary.name,
        });
      }
    }
    for (const childName of boundary.boundaryNames) {
      if (!(childName in model.boundaries)) {
        issues.push({
          kind: "boundary-not-in-model",
          parent: boundary.name,
          child: childName,
        });
      }
    }
  }

  // Boundary cycle detection: DFS from each root, tracking visit stack
  detectBoundaryCycles(model, issues);

  return issues;
};

const detectBoundaryCycles = (model: Model, issues: ModelIssue[]): void => {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  const visit = (name: string): readonly string[] | undefined => {
    color.set(name, GRAY);
    const b = model.boundaries[name];
    if (b) {
      for (const child of b.boundaryNames) {
        const c = color.get(child) ?? WHITE;
        if (c === GRAY) {
          // Found cycle — reconstruct path from `name` back to `child`
          const path: string[] = [child];
          let cursor: string | undefined = name;
          while (cursor !== undefined && cursor !== child) {
            path.unshift(cursor);
            cursor = parent.get(cursor);
          }
          if (cursor === child) path.unshift(child);
          return path;
        }
        if (c === WHITE) {
          parent.set(child, name);
          const cyclePath = visit(child);
          if (cyclePath) return cyclePath;
        }
      }
    }
    color.set(name, BLACK);
    return undefined;
  };

  const seenCycles = new Set<string>();
  for (const root of Object.keys(model.boundaries)) {
    if ((color.get(root) ?? WHITE) !== WHITE) continue;
    const cyclePath = visit(root);
    if (cyclePath) {
      const sig = [...cyclePath]
        .toSorted((a, b) => a.localeCompare(b))
        .join(",");
      if (!seenCycles.has(sig)) {
        seenCycles.add(sig);
        issues.push({ kind: "boundary-cycle", path: cyclePath });
      }
    }
  }
};

// Helper для loader'ов: возвращает true если name уже занят в существующем
// Record (для surfacing duplicate-* issues на этапе сборки).
export const isDuplicateElement = (
  elements: Readonly<Record<string, Element>>,
  name: string,
): boolean => name in elements;
