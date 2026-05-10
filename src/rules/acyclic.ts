import { Container, Relation } from "../model";
import { Violation } from "./types";

export const checkAcyclic = (containers: Container[]): Violation[] => {
  const violations: Violation[] = [];

  const findCycle = (
    relations: Relation[],
    sourceContainerName: string,
    visited: Set<string> = new Set(),
  ): boolean => {
    for (const rel of relations) {
      if (rel.to.name === sourceContainerName) {
        return true;
      }
      if (visited.has(rel.to.name)) continue;
      visited.add(rel.to.name);

      if (findCycle(rel.to.relations, sourceContainerName, visited)) {
        return true;
      }
    }
    return false;
  };

  for (const container of containers) {
    if (findCycle(container.relations, container.name)) {
      violations.push({
        container: container.name,
        message: "participates in a dependency cycle",
      });
    }
  }

  return violations;
};
