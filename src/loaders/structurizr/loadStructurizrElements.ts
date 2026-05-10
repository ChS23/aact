import fs from "node:fs/promises";
import path from "node:path";

import {
  ArchitectureModel,
  Boundary,
  BOUNDARY_TYPE,
  Container,
  CONTAINER_DB_TYPE,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
  PERSON_TYPE,
  Relation,
} from "../../model";
import {
  STRUCTURIZR_INTERACTION_ASYNC,
  STRUCTURIZR_LOCATION_EXTERNAL,
  STRUCTURIZR_TAG_ASYNC,
} from "./dslTypes";
import {
  StructurizrProperties,
  StructurizrRelationship,
  StructurizrSoftwareSystem,
  StructurizrWorkspace,
} from "./types";

const dslId = (id: string, properties?: StructurizrProperties): string =>
  properties?.["structurizr.dsl.identifier"] ?? id;

const DATABASE_TECHNOLOGIES = [
  "postgresql",
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "mongo",
  "redis",
  "elasticsearch",
  "dynamodb",
  "cassandra",
  "sqlite",
  "oracle",
  "sqlserver",
  "mssql",
  "database",
  "db",
];

const isDatabase = (technology?: string, name?: string): boolean => {
  const techLower = technology?.toLowerCase() ?? "";
  const nameLower = name?.toLowerCase() ?? "";

  // Check technology
  if (DATABASE_TECHNOLOGIES.some((db) => techLower.includes(db))) {
    return true;
  }

  // Check if name ends with DB or Database
  if (
    nameLower.endsWith(" db") ||
    nameLower.endsWith("_db") ||
    nameLower.endsWith("database")
  ) {
    return true;
  }

  return false;
};

// Heuristic: infer `repo` / `acl` tags from container name substrings so
// rules that key off these tags work without explicit tagging in the
// source workspace. Caveat: a container named for unrelated reasons (e.g.
// `crud_processor`) will receive a phantom `repo` tag. To opt out, tag
// the container explicitly in Structurizr — explicit tags are preserved.
const enrichTags = (existingTags?: string, name?: string): string[] => {
  const tags: string[] =
    existingTags
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean) ?? [];
  const nameLower = name?.toLowerCase() ?? "";

  // Add "repo" tag for CRUD services
  if (nameLower.includes("crud") && !tags.includes("repo")) {
    tags.push("repo");
  }

  // Add "acl" tag for ACL services
  if (nameLower.includes("acl") && !tags.includes("acl")) {
    tags.push("acl");
  }

  return tags;
};

export const loadStructurizrWorkspace = async (
  filePath: string,
): Promise<StructurizrWorkspace> => {
  const filepath = path.resolve(filePath);
  const data = await fs.readFile(filepath, "utf8");
  return JSON.parse(data) as StructurizrWorkspace;
};

interface ElementRegistry {
  allElements: Map<string, Container>;
  containers: Container[];
  boundaries: Boundary[];
}

const processExternalSystem = (
  system: StructurizrSoftwareSystem,
  registry: ElementRegistry,
): void => {
  const container: Container = {
    name: dslId(system.id, system.properties),
    label: system.name,
    type: EXTERNAL_SYSTEM_TYPE,
    tags: system.tags
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    description: system.description ?? "",
    relations: [],
  };
  registry.containers.push(container);
  registry.allElements.set(system.id, container);
};

const processInternalSystem = (
  system: StructurizrSoftwareSystem,
  registry: ElementRegistry,
): void => {
  const systemContainers: Container[] = [];

  for (const cont of system.containers ?? []) {
    const container: Container = {
      name: dslId(cont.id, cont.properties),
      label: cont.name,
      type: isDatabase(cont.technology, cont.name)
        ? CONTAINER_DB_TYPE
        : CONTAINER_TYPE,
      tags: enrichTags(cont.tags, cont.name),
      description: cont.description ?? "",
      relations: [],
    };
    systemContainers.push(container);
    registry.containers.push(container);
    registry.allElements.set(cont.id, container);
  }

  registry.boundaries.push({
    name: dslId(system.id, system.properties),
    label: system.name,
    type: BOUNDARY_TYPE,
    boundaries: [],
    containers: systemContainers,
  });
};

const addRelations = (
  allElements: Map<string, Container>,
  sourceId: string,
  relationships: StructurizrRelationship[] | undefined,
): void => {
  const sourceContainer = allElements.get(sourceId);
  if (!sourceContainer || !relationships) return;

  for (const rel of relationships) {
    const targetContainer = allElements.get(rel.destinationId);
    if (!targetContainer) continue;

    let tags = rel.tags?.split(",").map((t) => t.trim());
    if (rel.interactionStyle === STRUCTURIZR_INTERACTION_ASYNC) {
      tags = [...(tags ?? []), STRUCTURIZR_TAG_ASYNC];
    }

    const relation: Relation = {
      to: targetContainer,
      technology:
        rel.technology ??
        (rel.description?.includes(" ") ? undefined : rel.description),
      tags,
    };

    sourceContainer.relations.push(relation);
  }
};

export const mapContainersFromStructurizr = (
  workspace: StructurizrWorkspace,
): ArchitectureModel => {
  const registry: ElementRegistry = {
    allElements: new Map<string, Container>(),
    containers: [],
    boundaries: [],
  };

  for (const system of workspace.model.softwareSystems ?? []) {
    if (
      system.location === STRUCTURIZR_LOCATION_EXTERNAL ||
      system.tags?.includes(STRUCTURIZR_LOCATION_EXTERNAL)
    ) {
      processExternalSystem(system, registry);
    } else {
      processInternalSystem(system, registry);
    }
  }

  for (const person of workspace.model.people ?? []) {
    const container: Container = {
      name: dslId(person.id, person.properties),
      label: person.name,
      type: PERSON_TYPE,
      tags: person.tags
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      description: person.description ?? "",
      relations: [],
    };
    registry.containers.push(container);
    registry.allElements.set(person.id, container);
  }

  for (const system of workspace.model.softwareSystems ?? []) {
    addRelations(registry.allElements, system.id, system.relationships);
    for (const cont of system.containers ?? []) {
      addRelations(registry.allElements, cont.id, cont.relationships);
      for (const comp of cont.components ?? []) {
        addRelations(registry.allElements, comp.id, comp.relationships);
      }
    }
  }

  for (const person of workspace.model.people ?? []) {
    addRelations(registry.allElements, person.id, person.relationships);
  }

  return {
    allContainers: registry.containers.toSorted((a, b) =>
      a.name.localeCompare(b.name),
    ),
    boundaries: registry.boundaries,
  };
};

export const loadStructurizrElements = async (
  filePath: string,
): Promise<ArchitectureModel> => {
  const workspace = await loadStructurizrWorkspace(filePath);
  return mapContainersFromStructurizr(workspace);
};
