import type { Boundary, Model, SourceLocation } from "../model";
import { allElements } from "../model";
import type { RuleDefinition, Violation } from "./types";

/** Reserved options shape — `Record<string, never>` rejects unknown
 *  keys today; future fields land via a non-empty interface and a
 *  breaking-change note. */
export type CommonReuseOptions = Record<string, never>;

/**
 * Common Reuse Principle: если consumer использует часть public surface
 * другого boundary, он должен использовать всё. "Используешь часть —
 * используй полностью, или не используй вообще."
 */

const buildBoundaryLookup = (model: Model): Map<string, Boundary> => {
  const map = new Map<string, Boundary>();
  for (const boundary of Object.values(model.boundaries)) {
    for (const containerName of boundary.elementNames) {
      map.set(containerName, boundary);
    }
  }
  return map;
};

const collectPublicAndUsage = (
  model: Model,
  boundaryOf: Map<string, Boundary>,
): {
  publicOf: Map<Boundary, Set<string>>;
  used: Map<string, Set<string>>;
  /** First cross-boundary edge seen per (consumer, provider) pair — used
   * as the violation anchor so the lint-style table / OSC8 link jumps to
   * the partial-usage call instead of the consumer boundary header. */
  firstEdgeLoc: Map<string, SourceLocation>;
} => {
  const publicOf = new Map<Boundary, Set<string>>();
  const used = new Map<string, Set<string>>();
  const firstEdgeLoc = new Map<string, SourceLocation>();

  for (const source of allElements(model)) {
    const srcBoundary = boundaryOf.get(source.name);
    if (!srcBoundary) continue;

    for (const rel of source.relations) {
      const tgtBoundary = boundaryOf.get(rel.to);
      if (!tgtBoundary || tgtBoundary === srcBoundary) continue;

      let pub = publicOf.get(tgtBoundary);
      if (!pub) {
        pub = new Set();
        publicOf.set(tgtBoundary, pub);
      }
      pub.add(rel.to);

      const key = `${srcBoundary.name}\0${tgtBoundary.name}`;
      let u = used.get(key);
      if (!u) {
        u = new Set();
        used.set(key, u);
      }
      u.add(rel.to);
      if (rel.sourceLocation && !firstEdgeLoc.has(key)) {
        firstEdgeLoc.set(key, rel.sourceLocation);
      }
    }
  }

  return { publicOf, used, firstEdgeLoc };
};

export const commonReuseRule: RuleDefinition<CommonReuseOptions> = {
  name: "commonReuse",
  description:
    "Consumers using part of a boundary's public surface should use all of it",
  rationale:
    "Robert Martin's Common Reuse Principle: 'classes that are reused together belong in the same package.' Applied at the C4 boundary level, this means a context's public API is either consumed as a coherent whole or not at all — picking-and-choosing parts forces the boundary to maintain unstable shapes for every consumer's slice. If most consumers only need a fraction, that fraction wants to move to its own boundary; if everyone uses everything, the current boundary is correctly sized.",
  examples: [
    {
      label: "bad",
      source: `System_Boundary(billing, "Billing") {
  Container(invoice, "Invoice")
  Container(tax, "Tax")
  Container(refund, "Refund")
}
Container(orders, "Orders")
Rel(orders, invoice, "")`,
      note: "`orders` uses 1 of 3 billing containers — partial coupling. Either `invoice` belongs elsewhere, or `orders` should pull more from `billing`.",
    },
    {
      label: "good",
      source: `System_Boundary(billing, "Billing") {
  Container(invoice, "Invoice")
  Container(tax, "Tax")
}
Container(orders, "Orders")
Rel(orders, invoice, "")
Rel(orders, tax, "")`,
      note: "Full coverage of billing's public surface.",
    },
  ],
  adrPath: "ADRs/Common Reuse Principle.md",

  check(model) {
    const boundaryOf = buildBoundaryLookup(model);
    const { publicOf, used, firstEdgeLoc } = collectPublicAndUsage(
      model,
      boundaryOf,
    );
    const violations: Violation[] = [];

    for (const [provider, pubNames] of publicOf) {
      if (pubNames.size < 2) continue;

      for (const consumer of Object.values(model.boundaries)) {
        if (consumer === provider) continue;

        const key = `${consumer.name}\0${provider.name}`;
        const usedNames = used.get(key);
        if (!usedNames || usedNames.size >= pubNames.size) continue;

        const missing = [...pubNames].filter((n) => !usedNames.has(n));
        const loc = firstEdgeLoc.get(key);
        violations.push({
          target: consumer.name,
          targetKind: "boundary" as const,
          message: `uses ${[...usedNames].join(", ")} of "${provider.name}" but not ${missing.join(", ")} — all public services of a context should be used together`,
          ...(loc ? { sourceLocation: loc } : {}),
        });
      }
    }

    return violations;
  },
};
