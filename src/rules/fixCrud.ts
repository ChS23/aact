import consola from "consola";

import type { ArchitectureModel, Container } from "../model";
import { CONTAINER_DB_TYPE } from "../model";
import {
  buildContainerBoundaryMap,
  resolveRedirectTarget,
} from "./boundaryUtils";
import type { CrudOptions } from "./crud";
import type { FixResult, SourceSyntax } from "./fix";
import {
  detectNamingConvention,
  joinName,
  type NamingConvention,
} from "./namingUtils";
import type { Violation } from "./types";

const stripDbWord = (name: string): string => {
  const lower = name.toLowerCase();
  for (const suffix of [
    "_database",
    "-database",
    "database",
    "_db",
    "-db",
    "db",
  ]) {
    if (lower.endsWith(suffix)) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
};

const deriveRepoName = (
  dbName: string,
  convention: NamingConvention,
): string => {
  const base = stripDbWord(dbName);
  return joinName(base || dbName, "repo", convention);
};

const deriveRepoLabel = (dbName: string): string => {
  const base = stripDbWord(dbName);
  const word = base || dbName;
  return (
    word.charAt(0).toUpperCase() + word.slice(1).replaceAll("_", " ") + " Repo"
  );
};

const fixNonRepoAccessesDb = (
  accessor: Container,
  model: ArchitectureModel,
  syntax: SourceSyntax,
  dbType: string,
  ownerTags: string[],
  convention: NamingConvention,
): FixResult | undefined => {
  const dbRels = accessor.relations.filter((r) => r.to.type === dbType);
  if (dbRels.length === 0) return undefined;

  const containerBoundaryMap = buildContainerBoundaryMap(model);

  const edits = dbRels.flatMap((rel) => {
    const db = rel.to;

    const existingRepo = model.allContainers.find(
      (c) =>
        c !== accessor &&
        c.relations.some((r) => r.to.name === db.name) &&
        ownerTags.some((t) => c.tags?.includes(t)),
    );

    if (existingRepo) {
      const redirectTarget = resolveRedirectTarget(
        accessor,
        db,
        existingRepo,
        dbType,
        ownerTags,
        model,
        containerBoundaryMap,
        "crud",
      );
      if (!redirectTarget) return [];

      return [
        {
          type: "replace" as const,
          search: syntax.relationPattern(accessor.name, db.name),
          content: syntax.relationDecl(
            accessor.name,
            redirectTarget.name,
            rel.technology,
          ),
        },
      ];
    }

    // No existing repo — only create one within the same boundary
    const accessorBoundary = containerBoundaryMap.get(accessor.name);
    const dbBoundary = containerBoundaryMap.get(db.name);
    if (
      accessorBoundary !== undefined &&
      dbBoundary !== undefined &&
      accessorBoundary !== dbBoundary
    ) {
      consola.warn(
        `fix crud: "${accessor.name}" accesses "${db.name}" cross-boundary with no existing repo — fix manually`,
      );
      return [];
    }

    const repoName = deriveRepoName(db.name, convention);

    if (model.allContainers.some((c) => c.name === repoName)) {
      consola.warn(
        `fix crud: cannot create repo for "${db.name}" — "${repoName}" already exists`,
      );
      return [];
    }

    return [
      {
        type: "add" as const,
        search: syntax.containerPattern(db.name),
        content: syntax.containerDecl(
          repoName,
          deriveRepoLabel(db.name),
          ownerTags[0] ?? "repo",
        ),
      },
      {
        type: "add" as const,
        search: syntax.containerPattern(repoName),
        content: syntax.relationDecl(repoName, db.name, rel.technology),
      },
      {
        type: "replace" as const,
        search: syntax.relationPattern(accessor.name, db.name),
        content: syntax.relationDecl(accessor.name, repoName, rel.technology),
      },
    ];
  });

  if (edits.length === 0) return undefined;

  return {
    rule: "crud",
    description: `Add repo intermediary for ${accessor.name} → ${dbRels.map((r) => r.to.name).join(", ")}`,
    edits,
  };
};

const fixRepoWithNonDbDeps = (
  repo: Container,
  syntax: SourceSyntax,
  dbType: string,
): FixResult | undefined => {
  const nonDbRels = repo.relations.filter((r) => r.to.type !== dbType);
  if (nonDbRels.length === 0) return undefined;

  return {
    rule: "crud",
    description: `Remove non-database dependencies from repo ${repo.name}`,
    edits: nonDbRels.map((rel) => ({
      type: "remove" as const,
      search: syntax.relationPattern(repo.name, rel.to.name),
    })),
  };
};

export const fixCrud = (
  model: ArchitectureModel,
  violations: Violation[],
  syntax: SourceSyntax,
  options?: CrudOptions,
): FixResult[] => {
  const dbType = options?.dbType ?? CONTAINER_DB_TYPE;
  const ownerTags = options?.repoTags ?? ["repo", "relay"];
  const convention = detectNamingConvention(model);
  const results: FixResult[] = [];

  for (const violation of violations) {
    const container = model.allContainers.find(
      (c) => c.name === violation.container,
    );
    if (!container) continue;

    const isRepo = ownerTags.some((t) => container.tags?.includes(t));

    if (isRepo) {
      const fix = fixRepoWithNonDbDeps(container, syntax, dbType);
      if (fix) results.push(fix);
    } else {
      const fix = fixNonRepoAccessesDb(
        container,
        model,
        syntax,
        dbType,
        ownerTags,
        convention,
      );
      if (fix) results.push(fix);
    }
  }

  return results;
};
