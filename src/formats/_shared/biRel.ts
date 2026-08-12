import type { Relation } from "../../model";

/**
 * PlantUML/Mermaid `BiRel(a, b, ...)` семантически = `Rel(a, b, ...) +
 * Rel(b, a, ...)`. Loader разворачивает в две directed relations при load'е.
 * Generator может определить симметричные пары и эмитить BiRel обратно для
 * round-trip без шумного diff'а.
 *
 * attrs — все остальные поля Relation кроме `to` (technology, description,
 * tags, etc.). Оба направления получают одинаковые attrs.
 */
export const expandBiRel = (
  from: string,
  to: string,
  attrs: Omit<Relation, "to">,
): readonly [Relation, Relation] => [
  { to, ...attrs },
  { to: from, ...attrs },
];
