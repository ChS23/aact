import fs from "node:fs/promises";

import path from "pathe";

import type {
  Boundary,
  Element,
  ElementKind,
  ModelIssue,
  Relation,
} from "../../model";
import { buildModel } from "../../model";
import { inferKindFromTechnology } from "../_shared/kindHeuristics";
import { parseCsvTags } from "../_shared/tags";
import type { LoadResult } from "../types";
import { parseSource } from "./parser";
import type {
  StructurizrComponent,
  StructurizrContainer,
  StructurizrPerson,
  StructurizrProperties,
  StructurizrRelationship,
  StructurizrSoftwareSystem,
  StructurizrWorkspace,
} from "./types";
import {
  STRUCTURIZR_INTERACTION_ASYNC,
  STRUCTURIZR_LOCATION_EXTERNAL,
  STRUCTURIZR_TAG_ASYNC,
} from "./types";

const STRUCTURIZR_DSL_IDENTIFIER = "structurizr.dsl.identifier";

/** Resolve human-readable name через `structurizr.dsl.identifier` property,
 * fallback на raw id. Это позволяет правилам ссылаться на читаемые имена. */
const dslId = (id: string, properties?: StructurizrProperties): string =>
  properties?.[STRUCTURIZR_DSL_IDENTIFIER] ?? id;

/**
 * Composite properties bag: user-defined + group (как prefix `group`) +
 * perspectives (как `perspective.<name>` + опциональный `perspective.<name>.value`).
 *
 * Solution Architect добавляет perspectives (security/scalability/ops view)
 * к одной модели — сохраняем для round-trip без потерь. Без этого rules не
 * увидят что у container'а есть security-related metadata.
 */
const toProperties = (
  base: StructurizrProperties | undefined,
  group?: string,
  perspectives?: Record<string, { description: string; value?: string }>,
): Element["properties"] => {
  const out: Record<string, string> = {};
  if (base) {
    for (const [k, v] of Object.entries(base)) {
      if (k === STRUCTURIZR_DSL_IDENTIFIER) continue;
      if (typeof v === "string") out[k] = v;
    }
  }
  if (group !== undefined && group.length > 0) out.group = group;
  if (perspectives) {
    for (const [name, p] of Object.entries(perspectives)) {
      out[`perspective.${name}`] = p.description;
      if (p.value !== undefined) out[`perspective.${name}.value`] = p.value;
    }
  }
  if (Object.keys(out).length === 0) return undefined;
  return Object.freeze(out);
};

const isExternal = (system: StructurizrSoftwareSystem): boolean =>
  system.location === STRUCTURIZR_LOCATION_EXTERNAL ||
  (system.tags?.includes(STRUCTURIZR_LOCATION_EXTERNAL) ?? false);

const buildPersonContainer = (p: StructurizrPerson): Element => ({
  name: dslId(p.id, p.properties),
  label: p.name,
  kind: "Person",
  external: false,
  description: p.description ?? "",
  tags: parseCsvTags(p.tags),
  relations: [],
  link: p.url,
  properties: toProperties(p.properties, p.group, p.perspectives),
});

const buildExternalSystemContainer = (
  s: StructurizrSoftwareSystem,
): Element => ({
  name: dslId(s.id, s.properties),
  label: s.name,
  kind: "System",
  external: true,
  description: s.description ?? "",
  tags: parseCsvTags(s.tags),
  relations: [],
  link: s.url,
  properties: toProperties(s.properties, s.group, s.perspectives),
});

const buildInternalSystemContainer = (
  s: StructurizrSoftwareSystem,
): Element => ({
  name: dslId(s.id, s.properties),
  label: s.name,
  kind: "System",
  external: false,
  description: s.description ?? "",
  tags: parseCsvTags(s.tags),
  relations: [],
  link: s.url,
  properties: toProperties(s.properties, s.group, s.perspectives),
});

const buildContainer = (c: StructurizrContainer): Element => ({
  name: dslId(c.id, c.properties),
  label: c.name,
  kind: inferKindFromTechnology(c.technology, c.name),
  external: false,
  description: c.description ?? "",
  technology: c.technology,
  tags: parseCsvTags(c.tags),
  relations: [],
  link: c.url,
  properties: toProperties(c.properties, c.group, c.perspectives),
});

const componentKindFromTechnology = (
  technology: string | undefined,
  name: string,
): ElementKind => {
  const inferred = inferKindFromTechnology(technology, name);
  if (inferred === "ContainerDb") return "ComponentDb";
  if (inferred === "ContainerQueue") return "ComponentQueue";
  return "Component";
};

const buildComponent = (c: StructurizrComponent): Element => ({
  name: dslId(c.id, c.properties),
  label: c.name,
  kind: componentKindFromTechnology(c.technology, c.name),
  external: false,
  description: c.description ?? "",
  technology: c.technology,
  tags: parseCsvTags(c.tags),
  relations: [],
  link: c.url,
  properties: toProperties(c.properties, c.group, c.perspectives),
});

const hasComponents = (c: StructurizrContainer): boolean =>
  (c.components?.length ?? 0) > 0;

const buildContainerBoundary = (c: StructurizrContainer): Boundary => ({
  name: dslId(c.id, c.properties),
  label: c.name,
  kind: "Container",
  description: c.description,
  tags: parseCsvTags(c.tags),
  elementNames: (c.components ?? []).map((component) =>
    dslId(component.id, component.properties),
  ),
  boundaryNames: [],
  link: c.url,
  properties: toProperties(c.properties, c.group, c.perspectives),
});

const buildSystemBoundary = (
  s: StructurizrSoftwareSystem,
  childContainers: readonly StructurizrContainer[],
): Boundary => ({
  name: dslId(s.id, s.properties),
  label: s.name,
  kind: "System",
  description: s.description,
  tags: parseCsvTags(s.tags),
  elementNames: childContainers
    .filter((c) => !hasComponents(c))
    .map((c) => dslId(c.id, c.properties)),
  boundaryNames: childContainers
    .filter(hasComponents)
    .map((c) => dslId(c.id, c.properties)),
  link: s.url,
  properties: toProperties(s.properties, s.group, s.perspectives),
});

const buildRelation = (
  rel: StructurizrRelationship,
  targetName: string,
): Relation => {
  const baseTags = parseCsvTags(rel.tags);
  const tags =
    rel.interactionStyle === STRUCTURIZR_INTERACTION_ASYNC
      ? [...baseTags, STRUCTURIZR_TAG_ASYNC]
      : baseTags;
  return {
    to: targetName,
    description: rel.description,
    technology: rel.technology,
    tags,
    link: rel.url,
    properties: toProperties(rel.properties, undefined, rel.perspectives),
  };
};

const HTTP_URL_RE = /^https?:\/\//i;

const stripQuoted = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseLocalIncludeTarget = (line: string): string | undefined => {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("!include")) return undefined;
  const raw = trimmed.slice("!include".length);
  if (raw.length === 0 || !/\s/u.test(raw[0])) return undefined;

  const value = raw.trim();
  const target =
    value.startsWith('"') || value.startsWith("'")
      ? stripQuoted(value)
      : (value.split(/\s+/u)[0] ?? "");
  if (target.length === 0 || HTTP_URL_RE.test(target)) return undefined;
  return target;
};

const expandDslIncludePath = async (
  includePath: string,
  stack: Set<string>,
): Promise<string> => {
  const stat = await fs.stat(includePath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(includePath, { withFileTypes: true });
    const parts: string[] = [];
    for (const entry of entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      parts.push(
        await expandDslIncludes(path.join(includePath, entry.name), stack),
      );
    }
    return parts.join("\n");
  }
  return expandDslIncludes(includePath, stack);
};

const expandDslIncludes = async (
  filepath: string,
  stack = new Set<string>(),
): Promise<string> => {
  const absPath = path.resolve(filepath);
  if (stack.has(absPath)) {
    throw new Error(`Structurizr DSL include cycle detected: ${absPath}`);
  }

  stack.add(absPath);
  try {
    const text = await fs.readFile(absPath, "utf8");
    const out: string[] = [];
    for (const line of text.split(/(?<=\n)/u)) {
      let newline = "";
      if (line.endsWith("\r\n")) {
        newline = "\r\n";
      } else if (line.endsWith("\n")) {
        newline = "\n";
      }
      const content = newline ? line.slice(0, -newline.length) : line;
      const target = parseLocalIncludeTarget(content);
      if (target === undefined) {
        out.push(line);
        continue;
      }

      const includePath = path.resolve(path.dirname(absPath), target);
      const expanded = await expandDslIncludePath(includePath, stack);
      out.push(expanded);
      if (newline && !expanded.endsWith("\n")) out.push(newline);
    }
    return out.join("");
  } finally {
    stack.delete(absPath);
  }
};

interface ElementWithRelations {
  readonly sourceId: string;
  readonly relationships?: readonly StructurizrRelationship[];
}

/**
 * Structurizr workspace.json → Model.
 *
 * Known limitations (документируется в README):
 *  - System-level relations на decomposed internal SoftwareSystems
 *    (которые мапятся в Boundary) surfaced как loader-warning, потому что
 *    Boundary в v3 Model не имеет outgoing relations.
 *  - Tag inheritance (Structurizr auto-наследование "Software System" tag)
 *    отключено — user tags только из workspace.json.
 *  - enrichTagsFromNames эвристика v2 (имя содержит "crud" → tag "repo") убрана.
 *    Solution Architects явно тэгируют контейнеры в DSL.
 */
export const load = async (filePath: string): Promise<LoadResult> => {
  const filepath = path.resolve(filePath);
  // Dispatch on extension. `.dsl` (Structurizr DSL source) goes
  // through the chevrotain parser; `.json` (structurizr-cli output)
  // stays on the existing JSON walker. Solution Architects who edit
  // DSL directly can now point aact at `workspace.dsl` without first
  // compiling through structurizr-cli.
  if (filepath.toLowerCase().endsWith(".dsl")) {
    return loadFromDsl(filepath);
  }
  const data = await fs.readFile(filepath, "utf8");
  const workspace = JSON.parse(data) as StructurizrWorkspace;

  const containers: Element[] = [];
  const boundaries: Boundary[] = [];
  const rootBoundaryNames: string[] = [];
  const loaderIssues: ModelIssue[] = [];
  const idToName = new Map<string, string>();
  /** Subset of idToName — только те id'шники которые мапятся в Container
   * (не Boundary). Relations можно push'ать только сюда. */
  const idToContainerName = new Map<string, string>();

  // Pass 1: people
  for (const person of workspace.model.people ?? []) {
    const c = buildPersonContainer(person);
    containers.push(c);
    idToName.set(person.id, c.name);
    idToContainerName.set(person.id, c.name);
  }

  // Pass 2: software systems
  // - external systems → Element(kind=System, external=true)
  // - internal leaf systems → Element(kind=System)
  // - internal decomposed systems → Boundary + child Containers/Components
  for (const system of workspace.model.softwareSystems ?? []) {
    if (isExternal(system)) {
      const c = buildExternalSystemContainer(system);
      containers.push(c);
      idToName.set(system.id, c.name);
      idToContainerName.set(system.id, c.name);
    } else if ((system.containers?.length ?? 0) === 0) {
      const c = buildInternalSystemContainer(system);
      containers.push(c);
      idToName.set(system.id, c.name);
      idToContainerName.set(system.id, c.name);
    } else {
      const childContainers = system.containers ?? [];
      const boundary = buildSystemBoundary(system, childContainers);
      boundaries.push(boundary);
      rootBoundaryNames.push(boundary.name);
      idToName.set(system.id, boundary.name);

      for (const cont of childContainers) {
        if (hasComponents(cont)) {
          const b = buildContainerBoundary(cont);
          boundaries.push(b);
          idToName.set(cont.id, b.name);

          for (const component of cont.components ?? []) {
            const c = buildComponent(component);
            containers.push(c);
            idToName.set(component.id, c.name);
            idToContainerName.set(component.id, c.name);
          }
        } else {
          const c = buildContainer(cont);
          containers.push(c);
          idToName.set(cont.id, c.name);
          idToContainerName.set(cont.id, c.name);
        }
      }
    }
  }

  // Collect all relation-bearing elements for second-pass relation building
  const elementsWithRelations: ElementWithRelations[] = [];
  for (const person of workspace.model.people ?? []) {
    if (person.relationships) {
      elementsWithRelations.push({
        sourceId: person.id,
        relationships: person.relationships,
      });
    }
  }
  for (const system of workspace.model.softwareSystems ?? []) {
    if (system.relationships) {
      elementsWithRelations.push({
        sourceId: system.id,
        relationships: system.relationships,
      });
    }
    for (const cont of system.containers ?? []) {
      if (cont.relationships) {
        elementsWithRelations.push({
          sourceId: cont.id,
          relationships: cont.relationships,
        });
      }
      for (const component of cont.components ?? []) {
        if (component.relationships) {
          elementsWithRelations.push({
            sourceId: component.id,
            relationships: component.relationships,
          });
        }
      }
    }
  }

  // Pass 3: relations — push only into Element-mapped sources.
  // Boundary sources can't carry outgoing relations in v3 Model, so make
  // the loss explicit instead of pretending the exported JSON fully loaded.
  const containersByName = new Map<string, Element>(
    containers.map((c) => [c.name, c]),
  );
  for (const { sourceId, relationships } of elementsWithRelations) {
    // Structurizr JSON includes derived aggregate relationships linked
    // to concrete author-level relations. Those are view duplicates.
    const authorRelationships = relationships?.filter(
      (rel) => !rel.linkedRelationshipId,
    );
    const sourceName = idToContainerName.get(sourceId);
    if (!authorRelationships || authorRelationships.length === 0) continue;
    if (!sourceName) {
      const mappedName = idToName.get(sourceId);
      if (mappedName !== undefined) {
        loaderIssues.push({
          kind: "loader-warning",
          source: "structurizr",
          code: "boundary-source-relationship-not-represented",
          message: `Relationship from "${mappedName}" is attached to a Structurizr element that maps to a Boundary in aact; Boundary relations are not represented in v3 Model.`,
          element: mappedName,
        });
      }
      continue;
    }
    const source = containersByName.get(sourceName);
    if (!source) continue;

    const newRelations: Relation[] = [...source.relations];
    for (const rel of authorRelationships) {
      const mappedTargetName = idToName.get(rel.destinationId);
      if (
        mappedTargetName !== undefined &&
        !containersByName.has(mappedTargetName)
      ) {
        loaderIssues.push({
          kind: "loader-warning",
          source: "structurizr",
          code: "boundary-target-relationship-not-represented",
          message: `Relationship to "${mappedTargetName}" targets a Structurizr element that maps to a Boundary in aact; Boundary relations are not represented in v3 Model.`,
          element: sourceName,
        });
        continue;
      }
      const targetName = mappedTargetName ?? rel.destinationId;
      newRelations.push(buildRelation(rel, targetName));
    }
    containersByName.set(sourceName, { ...source, relations: newRelations });
  }

  return buildModel({
    elements: [...containersByName.values()],
    boundaries,
    rootBoundaryNames,
    preIssues: loaderIssues,
  });
};

/**
 * Read a Structurizr DSL source file directly via the chevrotain
 * parser. Parse errors are surfaced through a thrown Error — the
 * loader contract guarantees a usable Model or an exception. Model
 * issues from the parser's own toModel pass propagate as
 * `LoadResult.issues` for the linter to render.
 */
const loadFromDsl = async (filepath: string): Promise<LoadResult> => {
  const text = await expandDslIncludes(filepath);
  const result = parseSource(text, filepath);
  if (result.parseErrors.length > 0) {
    const summary = result.parseErrors
      .slice(0, 5)
      .map((e) => `  ${e.line ?? "?"}:${e.column ?? "?"} ${e.message}`)
      .join("\n");
    const more =
      result.parseErrors.length > 5
        ? `\n  ...and ${result.parseErrors.length - 5} more.`
        : "";
    throw new Error(
      `Failed to parse Structurizr DSL ${filepath}:\n${summary}${more}`,
    );
  }
  return { model: result.model, issues: result.issues };
};
