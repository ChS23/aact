import {
  ArchitectureModel,
  Boundary,
  Container,
  CONTAINER_DB_TYPE,
  EXTERNAL_SYSTEM_TYPE,
  Relation,
} from "./model";

export interface CouplingRelation {
  from: string;
  to: string;
}

export interface BoundaryAnalysis {
  name: string;
  label: string;
  cohesion: number;
  coupling: number;
  couplingRelations: CouplingRelation[];
}

export interface AnalysisReport {
  elementsCount: number;
  syncApiCalls: number;
  asyncApiCalls: number;
  databases: DatabasesInfo;
  boundaries: BoundaryAnalysis[];
}

export interface AnalyzedArchitecture {
  model: ArchitectureModel;
  report: AnalysisReport;
}

interface DatabasesInfo {
  count: number;
  consumes: number;
}

interface RelationWithSource {
  from: Container;
  relation: Relation;
}

export interface AnalyzeOptions {
  apiTechnologies?: string[];
  externalType?: string;
  dbType?: string;
}

const DEFAULT_API_TECHNOLOGIES = ["http", "grpc", "tcp"];

const allRelations = (model: ArchitectureModel): RelationWithSource[] =>
  model.allContainers.flatMap((container) =>
    container.relations.map((relation) => ({ from: container, relation })),
  );

const classifyRelation = (
  names: Set<string>,
  childNames: Set<string> | undefined,
  parentBoundary: Boundary | undefined,
  from: Container,
  relation: Relation,
  result: BoundaryAnalysis,
  parentResult: BoundaryAnalysis | undefined,
): void => {
  if (!names.has(from.name)) return;

  if (names.has(relation.to.name)) {
    result.cohesion++;
    return;
  }

  const isInParentSibling = childNames?.has(relation.to.name) ?? false;

  if (!parentBoundary || isInParentSibling) {
    result.coupling++;
    result.couplingRelations.push({ from: from.name, to: relation.to.name });
    if (parentResult) parentResult.cohesion++;
  } else if (parentResult) {
    parentResult.coupling++;
    parentResult.couplingRelations.push({
      from: from.name,
      to: relation.to.name,
    });
  }
};

interface BoundaryLookups {
  nameSet: Set<string>;
  childNames: Set<string> | undefined;
  parentBoundary: Boundary | undefined;
}

const buildBoundaryLookups = (
  boundaries: Boundary[],
): Map<string, BoundaryLookups> => {
  const nameSets = new Map(
    boundaries.map((b) => [b.name, new Set(b.containers.map((c) => c.name))]),
  );

  const parentMap = new Map<string, Boundary>();
  for (const b of boundaries) {
    for (const child of b.boundaries) parentMap.set(child.name, b);
  }

  const result = new Map<string, BoundaryLookups>();
  for (const b of boundaries) {
    const parentBoundary = parentMap.get(b.name);
    let childNames: Set<string> | undefined;
    if (parentBoundary) {
      childNames = new Set<string>();
      for (const sibling of parentBoundary.boundaries) {
        for (const c of sibling.containers) childNames.add(c.name);
      }
    }
    result.set(b.name, {
      nameSet: nameSets.get(b.name)!,
      childNames,
      parentBoundary,
    });
  }
  return result;
};

const isSyncApiCall = (
  it: RelationWithSource,
  externalType: string,
  apiTechnologies: string[],
): boolean => {
  if (it.relation.tags?.includes("async")) return false;
  if (it.relation.to.type === externalType) return true;
  return apiTechnologies.some((t) =>
    (it.relation.technology ?? "").toLowerCase().includes(t),
  );
};

const analyzeModel = (
  model: ArchitectureModel,
  options?: AnalyzeOptions,
): AnalysisReport => {
  const apiTechnologies = options?.apiTechnologies ?? DEFAULT_API_TECHNOLOGIES;
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const dbType = options?.dbType ?? CONTAINER_DB_TYPE;
  const relations = allRelations(model);

  const asyncApiCalls = relations.filter((it) =>
    it.relation.tags?.includes("async"),
  );
  const syncApiCalls = relations.filter((it) =>
    isSyncApiCall(it, externalType, apiTechnologies),
  );

  const lookups = buildBoundaryLookups(model.boundaries);

  const boundaryResults = new Map<string, BoundaryAnalysis>();
  for (const boundary of model.boundaries) {
    boundaryResults.set(boundary.name, {
      name: boundary.name,
      label: boundary.label,
      cohesion: 0,
      coupling: 0,
      couplingRelations: [],
    });
  }

  for (const boundary of model.boundaries) {
    const { nameSet, childNames, parentBoundary } = lookups.get(boundary.name)!;
    const result = boundaryResults.get(boundary.name)!;
    const parentResult = parentBoundary
      ? boundaryResults.get(parentBoundary.name)
      : undefined;

    for (const { from, relation } of relations) {
      classifyRelation(
        nameSet,
        childNames,
        parentBoundary,
        from,
        relation,
        result,
        parentResult,
      );
    }
  }

  return {
    elementsCount: model.allContainers.length,
    syncApiCalls: syncApiCalls.length,
    asyncApiCalls: asyncApiCalls.length,
    databases: analyzeDatabases(model, dbType),
    boundaries: [...boundaryResults.values()],
  };
};

const analyzeDatabases = (
  model: ArchitectureModel,
  dbType: string,
): DatabasesInfo => {
  const dbNames = new Set(
    model.allContainers.filter((it) => it.type === dbType).map((it) => it.name),
  );

  let consumes = 0;
  for (const container of model.allContainers) {
    for (const r of container.relations) {
      if (dbNames.has(r.to.name)) consumes++;
    }
  }

  return {
    count: dbNames.size,
    consumes,
  };
};

export const analyzeArchitecture = (
  model: ArchitectureModel,
  options?: AnalyzeOptions,
): AnalyzedArchitecture => {
  return {
    model,
    report: analyzeModel(model, options),
  };
};
