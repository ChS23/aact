import type { BoundaryKind, ElementKind } from "../../model";

/**
 * PlantUML C4 stdlib и Mermaid C4 имеют идентичные macro names (Microsoft
 * скопировали API). Один mapper покрывает оба формата.
 *
 * `external` orthogonal flag — для variants с `_Ext` суффиксом возвращаем
 * базовый kind + external=true. Это убирает 8 дополнительных kind'ов из
 * ElementKind union'а.
 */
interface C4Kind {
  readonly kind: ElementKind;
  readonly external: boolean;
}

const C4_KIND_MAP: Readonly<Record<string, C4Kind>> = Object.freeze({
  // Person
  Person: { kind: "Person", external: false },
  Person_Ext: { kind: "Person", external: true },
  // System / SystemDb / SystemQueue + _Ext variants
  System: { kind: "System", external: false },
  SystemDb: { kind: "System", external: false },
  SystemQueue: { kind: "System", external: false },
  System_Ext: { kind: "System", external: true },
  SystemDb_Ext: { kind: "System", external: true },
  SystemQueue_Ext: { kind: "System", external: true },
  // Container variants
  Container: { kind: "Container", external: false },
  ContainerDb: { kind: "ContainerDb", external: false },
  ContainerQueue: { kind: "ContainerQueue", external: false },
  Container_Ext: { kind: "Container", external: true },
  ContainerDb_Ext: { kind: "ContainerDb", external: true },
  ContainerQueue_Ext: { kind: "ContainerQueue", external: true },
  // Component variants
  Component: { kind: "Component", external: false },
  ComponentDb: { kind: "ComponentDb", external: false },
  ComponentQueue: { kind: "ComponentQueue", external: false },
  Component_Ext: { kind: "Component", external: true },
  ComponentDb_Ext: { kind: "ComponentDb", external: true },
  ComponentQueue_Ext: { kind: "ComponentQueue", external: true },
});

/**
 * Распарсить C4 macro name (PlantUML stdlib / Mermaid C4 — синтаксис идентичен)
 * в Container kind + external flag. Возвращает undefined для unknown macros —
 * loader решает что делать (fallback "Container" + warn, или сохранить
 * как "unknown-kind" ModelIssue).
 */
export const parseC4MacroKind = (macroName: string): C4Kind | undefined =>
  C4_KIND_MAP[macroName];

// Component_Boundary intentionally omitted — it is NOT in the C4-PlantUML
// stdlib (no macro definition; the README's "system or component boundary"
// language refers to Container_Boundary as the way to group components).
// c4model.com has no concept of a component boundary either.
const BOUNDARY_KIND_MAP: Readonly<Record<string, BoundaryKind>> = Object.freeze(
  {
    Boundary: "System", // generic — sensible default
    System_Boundary: "System",
    Container_Boundary: "Container",
    Enterprise_Boundary: "Enterprise",
  },
);

/**
 * Распарсить boundary macro в BoundaryKind. Generic `Boundary(...)` без
 * префикса маппится на "System" (наиболее распространённый use case в
 * existing diagrams).
 */
export const parseBoundaryMacro = (macroName: string): BoundaryKind =>
  BOUNDARY_KIND_MAP[macroName] ?? "System";

/**
 * Reverse mapping для generate-side: (kind, external) → C4 macro name.
 * Используется PlantUML/Mermaid generator'ами для round-trip. Identity
 * для kinds без Db/Queue subtypes (Person/Component используют base name).
 */
export const c4MacroName = (kind: ElementKind, external: boolean): string => {
  if (kind === "Person") return external ? "Person_Ext" : "Person";
  if (kind === "System") return external ? "System_Ext" : "System";
  return external ? `${kind}_Ext` : kind;
};

/**
 * Reverse mapping: BoundaryKind → boundary macro name.
 */
export const boundaryMacroName = (kind: BoundaryKind): string => {
  if (kind === "System") return "System_Boundary";
  if (kind === "Container") return "Container_Boundary";
  // "Component" kind has no PlantUML boundary macro (no Component_Boundary
  // in stdlib). Fall back to Container_Boundary — the canonical way the
  // C4-PlantUML stdlib groups components.
  if (kind === "Component") return "Container_Boundary";
  return "Enterprise_Boundary";
};
