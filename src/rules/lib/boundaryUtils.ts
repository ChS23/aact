import consola from "consola";

import type { Boundary, Element, Model } from "../../model";
import { allElements, getElement, isDatabaseElement } from "../../model";

/**
 * Maps container name → boundary that contains it. Используется fix-функциями
 * для определения cross-boundary access patterns.
 */
export const buildElementBoundaryMap = (
  model: Model,
): Map<string, Boundary> => {
  const map = new Map<string, Boundary>();
  for (const boundary of Object.values(model.boundaries)) {
    for (const containerName of boundary.elementNames) {
      map.set(containerName, boundary);
    }
  }
  return map;
};

/**
 * Находит "public API" container в boundary — predicate for redirect target.
 * Prefers containers с highest in-degree (incoming relations from outside).
 * Excludes DBs и repo-tagged containers (они internal).
 */
export const findPublicApiCandidate = (
  targetBoundary: Boundary,
  ownerTags: readonly string[],
  model: Model,
  elementBoundaryMap: Map<string, Boundary>,
): Element | undefined => {
  const candidates = targetBoundary.elementNames
    .map((name) => getElement(model, name))
    .filter((c): c is Element => c !== undefined)
    .filter(
      (c) =>
        !isDatabaseElement(c) && !ownerTags.some((t) => c.tags.includes(t)),
    );

  // Stryker disable next-line ConditionalExpression
  if (candidates.length === 0) return undefined;
  // Stryker disable next-line ConditionalExpression
  if (candidates.length === 1) return candidates[0];

  const candidateNames = new Set(candidates.map((c) => c.name));
  // Stryker disable next-line ArrayDeclaration
  const inDegree = new Map<string, number>(candidates.map((c) => [c.name, 0]));

  for (const element of allElements(model)) {
    if (elementBoundaryMap.get(element.name) === targetBoundary) continue;
    for (const rel of element.relations) {
      if (candidateNames.has(rel.to)) {
        inDegree.set(rel.to, (inDegree.get(rel.to) ?? 0) + 1);
      }
    }
  }

  return candidates.toSorted(
    (a, b) => (inDegree.get(b.name) ?? 0) - (inDegree.get(a.name) ?? 0),
  )[0];
};

/**
 * Resolves redirect target для accessor → DB. Same boundary → owner (repo).
 * Cross-boundary → public API of target boundary. Returns undefined если
 * no valid target — consola.warn для manual review.
 */
export const resolveRedirectTarget = (
  accessor: Element,
  db: Element,
  owner: Element,
  ownerTags: readonly string[],
  model: Model,
  elementBoundaryMap: Map<string, Boundary>,
  ruleName: string,
): Element | undefined => {
  const accessorBoundary = elementBoundaryMap.get(accessor.name);
  const dbBoundary = elementBoundaryMap.get(db.name);

  const isCrossBoundary =
    accessorBoundary !== undefined &&
    dbBoundary !== undefined &&
    accessorBoundary !== dbBoundary;

  if (!isCrossBoundary) return owner;

  const publicApi = findPublicApiCandidate(
    dbBoundary,
    ownerTags,
    model,
    elementBoundaryMap,
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
