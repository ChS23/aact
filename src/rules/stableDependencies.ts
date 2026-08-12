import type { Element } from "../model";
import { allElements, getElement } from "../model";
import type { RuleDefinition, Violation } from "./types";

/** Reserved options shape — `Record<string, never>` rejects unknown
 *  keys today; future fields land via a non-empty interface and a
 *  breaking-change note. */
export type StableDependenciesOptions = Record<string, never>;

/**
 * Stable Dependencies Principle: зависимости должны идти от менее стабильных
 * к более стабильным (instability = efferent / (afferent + efferent)).
 * External containers excluded из computation.
 */

const computeCoupling = (
  internal: readonly Element[],
  internalNames: ReadonlySet<string>,
): { ca: Map<string, number>; ce: Map<string, number> } => {
  const ca = new Map<string, number>();
  const ce = new Map<string, number>();

  for (const c of internal) {
    ca.set(c.name, 0);
    ce.set(c.name, 0);
  }

  for (const c of internal) {
    for (const rel of c.relations) {
      // Stryker disable next-line ConditionalExpression
      if (!internalNames.has(rel.to)) continue;
      // Stryker disable next-line ArithmeticOperator
      ce.set(c.name, ce.get(c.name)! + 1);
      // Stryker disable next-line ArithmeticOperator
      ca.set(rel.to, ca.get(rel.to)! + 1);
    }
  }

  return { ca, ce };
};

export const stableDependenciesRule: RuleDefinition<StableDependenciesOptions> =
  {
    name: "stableDependencies",
    description:
      "Dependencies should point toward more stable containers (instability calculation)",
    rationale:
      "Robert Martin's Stable Dependencies Principle: depend in the direction of stability. Instability `I = Ce / (Ca + Ce)` (efferent / total coupling) approximates how often a component is likely to change — a leaf consumer (`I=1`) is volatile, a widely-depended-on shared kernel (`I=0`) is stable. When a stable component depends on a volatile one, the volatility ripples backwards into the foundation — every change in the leaf forces a re-release of the core. Pointing dependencies toward stability prevents this cascade.",
    examples: [
      {
        label: "bad",
        source: `Container(user_lib, "User Lib")
Container(feature_x, "Feature X")
Container(consumer_a, "A")
Container(consumer_b, "B")
Rel(consumer_a, user_lib, "")
Rel(consumer_b, user_lib, "")
Rel(user_lib, feature_x, "")`,
        note: "`user_lib` is stable (Ca=2, Ce=1 → I≈0.33) but depends on `feature_x` (Ce-only, I=1) — volatile leaf is now in the foundation.",
      },
      {
        label: "good",
        source: `Container(user_lib, "User Lib")
Container(feature_x, "Feature X")
Rel(feature_x, user_lib, "")`,
        note: "Dependency reversed — volatile feature depends on stable lib.",
      },
    ],

    check(model) {
      const violations: Violation[] = [];
      const internal = allElements(model).filter((c) => !c.external);
      const internalNames = new Set(internal.map((c) => c.name));
      const { ca, ce } = computeCoupling(internal, internalNames);

      const instability = (name: string): number => {
        const afferent = ca.get(name)!;
        const efferent = ce.get(name)!;
        // Stryker disable next-line ConditionalExpression
        if (afferent + efferent === 0) return 1;
        return efferent / (afferent + efferent);
      };

      for (const c of internal) {
        for (const rel of c.relations) {
          // Stryker disable next-line ConditionalExpression
          if (!internalNames.has(rel.to)) continue;
          const iSource = instability(c.name);
          const iTarget = instability(rel.to);
          if (iSource < iTarget) {
            // Anchor on the offending edge so the lint-style table /
            // OSC8 hyperlink jumps straight to the `Rel(c, rel.to, …)`
            // line that broke the principle — same precision as crud/
            // acl/acyclic. Falls back to the source container in the
            // CLI layer when the loader didn't populate `sourceLocation`.
            const target = getElement(model, rel.to);
            violations.push({
              target: c.name,
              targetKind: "element" as const,
              message: `stable module (I=${iSource.toFixed(2)}) depends on less stable "${rel.to}" (I=${iTarget.toFixed(2)}) — dependencies should point toward stability`,
              ...(rel.sourceLocation
                ? { sourceLocation: rel.sourceLocation }
                : {}),
              ...(target?.sourceLocation
                ? {
                    relatedLocations: [
                      {
                        sourceLocation: target.sourceLocation,
                        message: `less stable dependency: ${rel.to} (I=${iTarget.toFixed(2)})`,
                      },
                    ],
                  }
                : {}),
            });
          }
        }
      }

      return violations;
    },
  };
