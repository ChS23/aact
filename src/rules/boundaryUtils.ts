import consola from "consola";

import type { ArchitectureModel, Boundary, Container } from "../model";

export const buildContainerBoundaryMap = (
  model: ArchitectureModel,
): Map<string, Boundary> => {
  const map = new Map<string, Boundary>();
  for (const boundary of model.boundaries) {
    for (const container of boundary.containers) {
      map.set(container.name, boundary);
    }
  }
  return map;
};

/**
 * Finds the best "public API" container in a boundary to serve as redirect
 * target for cross-boundary accessors. Prefers containers with the most
 * incoming relations from outside the boundary (highest in-degree).
 */
export const findPublicApiCandidate = (
  targetBoundary: Boundary,
  dbType: string,
  ownerTags: string[],
  model: ArchitectureModel,
  containerBoundaryMap: Map<string, Boundary>,
): Container | undefined => {
  const candidates = targetBoundary.containers.filter(
    (c) => c.type !== dbType && !ownerTags.some((t) => c.tags?.includes(t)),
  );

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const candidateNames = new Set(candidates.map((c) => c.name));
  const inDegree = new Map<string, number>(candidates.map((c) => [c.name, 0]));

  for (const container of model.allContainers) {
    if (containerBoundaryMap.get(container.name) === targetBoundary) continue;
    for (const rel of container.relations) {
      if (candidateNames.has(rel.to.name)) {
        inDegree.set(rel.to.name, (inDegree.get(rel.to.name) ?? 0) + 1);
      }
    }
  }

  return candidates.toSorted(
    (a, b) => (inDegree.get(b.name) ?? 0) - (inDegree.get(a.name) ?? 0),
  )[0];
};

/**
 * Resolves the redirect target for an accessor trying to reach a DB.
 * Same boundary → owner (repo). Cross-boundary → public API of target boundary.
 * Returns undefined if no valid target can be determined.
 */
export const resolveRedirectTarget = (
  accessor: Container,
  db: Container,
  owner: Container,
  dbType: string,
  ownerTags: string[],
  model: ArchitectureModel,
  containerBoundaryMap: Map<string, Boundary>,
  ruleName: string,
): Container | undefined => {
  const accessorBoundary = containerBoundaryMap.get(accessor.name);
  const dbBoundary = containerBoundaryMap.get(db.name);

  const isCrossBoundary =
    accessorBoundary !== undefined &&
    dbBoundary !== undefined &&
    accessorBoundary !== dbBoundary;

  if (!isCrossBoundary) return owner;

  const publicApi = findPublicApiCandidate(
    dbBoundary,
    dbType,
    ownerTags,
    model,
    containerBoundaryMap,
  );

  if (!publicApi) {
    consola.warn(
      `fix ${ruleName}: boundary "${dbBoundary.name}" has no public API — cannot auto-redirect "${accessor.name}" away from "${db.name}", fix manually`,
    );
    return undefined;
  }

  if (publicApi === owner) {
    consola.warn(
      `fix ${ruleName}: the only public API candidate in "${dbBoundary.name}" is the repo owner — cross-boundary access from "${accessor.name}" requires manual review`,
    );
    return undefined;
  }

  return publicApi;
};
