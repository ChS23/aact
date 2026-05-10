import { Container, CONTAINER_DB_TYPE } from "../model";
import { Violation } from "./types";

export interface DbPerServiceOptions {
  dbType?: string;
  ownerTags?: string[];
}

export const checkDbPerService = (
  containers: Container[],
  options?: DbPerServiceOptions,
): Violation[] => {
  const dbType = options?.dbType ?? CONTAINER_DB_TYPE;
  const violations: Violation[] = [];

  const dbAccessMap = new Map<string, string[]>();

  for (const container of containers) {
    for (const rel of container.relations) {
      if (rel.to.type === dbType) {
        const accessors = dbAccessMap.get(rel.to.name) ?? [];
        accessors.push(container.name);
        dbAccessMap.set(rel.to.name, accessors);
      }
    }
  }

  for (const [db, accessors] of dbAccessMap) {
    if (accessors.length > 1) {
      violations.push({
        container: db,
        message: `shared between ${accessors.join(", ")} — each database should have a single owner`,
      });
    }
  }

  return violations;
};
