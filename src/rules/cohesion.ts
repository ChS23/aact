import type { Boundary, Model } from "../model";
import { getBoundary, getElement } from "../model";
import type { RuleDefinition, Violation } from "./types";

/** Reserved options shape — `Record<string, never>` rejects unknown
 *  keys today; future fields land via a non-empty interface and a
 *  breaking-change note. */
export type CohesionOptions = Record<string, never>;

/**
 * Common Closure Principle: контейнеры одного boundary должны быть более
 * связаны между собой (cohesion) чем с внешними (coupling). Иначе
 * boundary плохо определён.
 *
 * v3: external определяется через `target.external === true` (orthogonal flag).
 */

const getBoundaryCohesion = (model: Model, boundary: Boundary): number => {
  const names = new Set(boundary.elementNames);
  let result = 0;
  for (const containerName of boundary.elementNames) {
    const element = getElement(model, containerName);
    if (!element) continue;
    result += element.relations.filter((r) => names.has(r.to)).length;
  }
  for (const innerName of boundary.boundaryNames) {
    const inner = getBoundary(model, innerName);
    if (inner) result += getBoundaryCoupling(model, inner);
  }
  return result;
};

const getBoundaryCoupling = (model: Model, boundary: Boundary): number => {
  const names = new Set(boundary.elementNames);
  let result = 0;

  for (const containerName of boundary.elementNames) {
    const element = getElement(model, containerName);
    if (!element) continue;
    result += element.relations.filter((r) => {
      const target = getElement(model, r.to);
      return target && !target.external && !names.has(r.to);
    }).length;
  }

  for (const innerName of boundary.boundaryNames) {
    const inner = getBoundary(model, innerName);
    if (!inner) continue;
    for (const containerName of inner.elementNames) {
      const element = getElement(model, containerName);
      if (!element) continue;
      result += element.relations.filter(
        (r) => getElement(model, r.to)?.external === true,
      ).length;
    }
  }

  return result;
};

export const cohesionRule: RuleDefinition<CohesionOptions> = {
  name: "cohesion",
  description:
    "Each boundary should be more cohesive than coupled; parent boundaries less cohesive than inner ones",
  rationale:
    "A boundary that has more cross-edges than internal edges is a fiction over a chatty graph — the grouping isn't a real cluster, just a wrapper around services that mostly talk outward. Cascade-decoupling (Safin) generalises this: each level should keep internal cohesion at least as high as its external coupling, and a parent boundary should be loosely coupled compared to its children. When the rule fires, the right response is usually to redraw the boundary along the actual call patterns, not to add edges.",
  examples: [
    {
      label: "bad",
      source: `System_Boundary(checkout, "Checkout") {
  Container(orders, "Orders")
  Container(billing, "Billing")
}
Container(notifications, "Notifications")
Rel(orders, notifications, "")
Rel(billing, notifications, "")`,
      note: "Two of `checkout`'s containers each call outward; zero internal edges → coupling > cohesion.",
    },
    {
      label: "good",
      source: `System_Boundary(checkout, "Checkout") {
  Container(orders, "Orders")
  Container(billing, "Billing")
}
Rel(orders, billing, "settles via")`,
      note: "Internal edge present; cohesion=1 ≥ coupling=0.",
    },
  ],

  check(model) {
    const violations: Violation[] = [];

    for (const boundary of Object.values(model.boundaries)) {
      const cohesion = getBoundaryCohesion(model, boundary);
      const coupling = getBoundaryCoupling(model, boundary);

      // Cohesion violations live on the boundary — anchor on its
      // declaration line. The `container` field carries the boundary
      // name (legacy field name from when the Violation type didn't
      // distinguish; the CLI envelope renders it identically).
      const loc = boundary.sourceLocation;

      if (cohesion <= coupling) {
        violations.push({
          target: boundary.name,
          targetKind: "boundary" as const,
          message: `coupling (${coupling}) ≥ cohesion (${cohesion}) — more cross-boundary dependencies than internal connections`,
          ...(loc ? { sourceLocation: loc } : {}),
        });
      }

      if (boundary.boundaryNames.length > 0) {
        const innerCohesionSum = boundary.boundaryNames.reduce<number>(
          (sum, innerName) => {
            const inner = getBoundary(model, innerName);
            return sum + (inner ? getBoundaryCohesion(model, inner) : 0);
          },
          0,
        );
        if (cohesion >= innerCohesionSum) {
          violations.push({
            target: boundary.name,
            targetKind: "boundary" as const,
            message: `parent cohesion (${cohesion}) ≥ sum of inner cohesions (${innerCohesionSum}) — parent boundary should be less cohesive than its sub-boundaries`,
            ...(loc ? { sourceLocation: loc } : {}),
          });
        }
      }
    }

    return violations;
  },
};
