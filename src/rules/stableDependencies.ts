import { Container, EXTERNAL_SYSTEM_TYPE } from "../model";
import { Violation } from "./types";

export interface StableDependenciesOptions {
  externalType?: string;
}

const computeCoupling = (
  internal: Container[],
  internalNames: Set<string>,
): { ca: Map<string, number>; ce: Map<string, number> } => {
  const ca = new Map<string, number>();
  const ce = new Map<string, number>();

  for (const c of internal) {
    ca.set(c.name, 0);
    ce.set(c.name, 0);
  }

  for (const c of internal) {
    for (const rel of c.relations) {
      if (!internalNames.has(rel.to.name)) continue;
      ce.set(c.name, ce.get(c.name)! + 1);
      ca.set(rel.to.name, ca.get(rel.to.name)! + 1);
    }
  }

  return { ca, ce };
};

export const checkStableDependencies = (
  containers: Container[],
  options?: StableDependenciesOptions,
): Violation[] => {
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const violations: Violation[] = [];

  const internal = containers.filter((c) => c.type !== externalType);
  const internalNames = new Set(internal.map((c) => c.name));
  const { ca, ce } = computeCoupling(internal, internalNames);

  const instability = (name: string): number => {
    const afferent = ca.get(name)!;
    const efferent = ce.get(name)!;
    if (afferent + efferent === 0) return 1;
    return efferent / (afferent + efferent);
  };

  for (const c of internal) {
    for (const rel of c.relations) {
      if (!internalNames.has(rel.to.name)) continue;
      const iSource = instability(c.name);
      const iTarget = instability(rel.to.name);
      if (iSource < iTarget) {
        violations.push({
          container: c.name,
          message: `stable module (I=${iSource.toFixed(2)}) depends on less stable "${rel.to.name}" (I=${iTarget.toFixed(2)}) — dependencies should point toward stability`,
        });
      }
    }
  }

  return violations;
};
