import {
  ArchitectureModel,
  Boundary,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
} from "../model";
import { Violation } from "./types";

export interface CohesionOptions {
  externalType?: string;
  internalType?: string;
}

const getBoundaryCohesion = (
  boundary: Boundary,
  externalType: string,
  internalType: string,
): number => {
  const names = new Set(boundary.containers.map((c) => c.name));
  let result = 0;
  for (const container of boundary.containers) {
    result += container.relations.filter((r) => names.has(r.to.name)).length;
  }
  for (const innerBoundary of boundary.boundaries) {
    result += getBoundaryCoupling(innerBoundary, externalType, internalType);
  }
  return result;
};

const getBoundaryCoupling = (
  boundary: Boundary,
  externalType: string,
  internalType: string,
): number => {
  const names = new Set(boundary.containers.map((c) => c.name));
  let result = 0;

  for (const container of boundary.containers) {
    result += container.relations.filter(
      (r) => r.to.type === internalType && !names.has(r.to.name),
    ).length;
  }

  for (const innerBoundary of boundary.boundaries) {
    for (const container of innerBoundary.containers) {
      result += container.relations.filter(
        (r) => r.to.type === externalType,
      ).length;
    }
  }

  return result;
};

export const checkCohesion = (
  model: ArchitectureModel,
  options?: CohesionOptions,
): Violation[] => {
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const internalType = options?.internalType ?? CONTAINER_TYPE;
  const violations: Violation[] = [];

  for (const boundary of model.boundaries) {
    const cohesion = getBoundaryCohesion(boundary, externalType, internalType);
    const coupling = getBoundaryCoupling(boundary, externalType, internalType);

    if (cohesion <= coupling) {
      violations.push({
        container: boundary.name,
        message: `coupling (${coupling}) ≥ cohesion (${cohesion}) — more cross-boundary dependencies than internal connections`,
      });
    }

    if (boundary.boundaries.length > 0) {
      const innerCohesionSum = boundary.boundaries.reduce(
        (sum, current) =>
          sum + getBoundaryCohesion(current, externalType, internalType),
        0,
      );
      if (cohesion >= innerCohesionSum) {
        violations.push({
          container: boundary.name,
          message: `parent cohesion (${cohesion}) ≥ sum of inner cohesions (${innerCohesionSum}) — parent boundary should be less cohesive than its sub-boundaries`,
        });
      }
    }
  }

  return violations;
};
