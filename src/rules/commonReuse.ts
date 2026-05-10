import type { ArchitectureModel, Boundary } from "../model";
import type { Violation } from "./types";

const buildBoundaryLookup = (
  model: ArchitectureModel,
): Map<string, Boundary> => {
  const map = new Map<string, Boundary>();
  for (const boundary of model.boundaries) {
    for (const c of boundary.containers) {
      map.set(c.name, boundary);
    }
  }
  return map;
};

const collectPublicAndUsage = (
  model: ArchitectureModel,
  boundaryOf: Map<string, Boundary>,
): {
  publicOf: Map<Boundary, Set<string>>;
  used: Map<string, Set<string>>;
} => {
  const publicOf = new Map<Boundary, Set<string>>();
  const used = new Map<string, Set<string>>();

  for (const source of model.allContainers) {
    const srcBoundary = boundaryOf.get(source.name);
    if (!srcBoundary) continue;

    for (const rel of source.relations) {
      const tgtBoundary = boundaryOf.get(rel.to.name);
      if (!tgtBoundary || tgtBoundary === srcBoundary) continue;

      let pub = publicOf.get(tgtBoundary);
      if (!pub) {
        pub = new Set();
        publicOf.set(tgtBoundary, pub);
      }
      pub.add(rel.to.name);

      const key = `${srcBoundary.name}\0${tgtBoundary.name}`;
      let u = used.get(key);
      if (!u) {
        u = new Set();
        used.set(key, u);
      }
      u.add(rel.to.name);
    }
  }

  return { publicOf, used };
};

export const checkCommonReuse = (model: ArchitectureModel): Violation[] => {
  const boundaryOf = buildBoundaryLookup(model);
  const { publicOf, used } = collectPublicAndUsage(model, boundaryOf);
  const violations: Violation[] = [];

  for (const [provider, pubNames] of publicOf) {
    if (pubNames.size < 2) continue;

    for (const consumer of model.boundaries) {
      if (consumer === provider) continue;

      const key = `${consumer.name}\0${provider.name}`;
      const usedNames = used.get(key);
      if (!usedNames || usedNames.size >= pubNames.size) continue;

      const missing = [...pubNames].filter((n) => !usedNames.has(n));
      violations.push({
        container: consumer.name,
        message: `uses ${[...usedNames].join(", ")} of "${provider.name}" but not ${missing.join(", ")} — all public services of a context should be used together`,
      });
    }
  }

  return violations;
};
