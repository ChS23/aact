import {
  PLANTUML_COMPONENT,
  PLANTUML_CONTAINER,
  PLANTUML_CONTAINER_DB,
  PLANTUML_PERSON,
  PLANTUML_SYSTEM,
  PLANTUML_SYSTEM_EXT,
} from "../loaders/plantuml/c4Types";
import type { ArchitectureModel } from "../model";
import {
  COMPONENT_TYPE,
  CONTAINER_DB_TYPE,
  CONTAINER_TYPE,
  EXTERNAL_SYSTEM_TYPE,
  PERSON_TYPE,
  SYSTEM_TYPE,
} from "../model";
import type { Boundary } from "../model/boundary";
import type { Container } from "../model/container";

export interface PlantumlFromModelOptions {
  boundaryLabel?: string;
}

const containerTypeMap: Record<string, string> = {
  [CONTAINER_TYPE]: PLANTUML_CONTAINER,
  [CONTAINER_DB_TYPE]: PLANTUML_CONTAINER_DB,
  [EXTERNAL_SYSTEM_TYPE]: PLANTUML_SYSTEM_EXT,
  [PERSON_TYPE]: PLANTUML_PERSON,
  [SYSTEM_TYPE]: PLANTUML_SYSTEM,
  [COMPONENT_TYPE]: PLANTUML_COMPONENT,
};

const renderContainer = (container: Container): string => {
  const type =
    containerTypeMap[container.type ?? CONTAINER_TYPE] ?? PLANTUML_CONTAINER;
  const tags =
    container.tags && container.tags.length > 0
      ? `, $tags="${container.tags.join("+")}"`
      : "";
  const desc = container.description ? `, "${container.description}"` : "";
  return `${type}(${container.name}, "${container.label}"${desc}${tags})`;
};

const renderBoundary = (boundary: Boundary, indent: string): string => {
  const inner = indent + "  ";
  const children = [
    ...boundary.boundaries.map((child) => renderBoundary(child, inner)),
    ...boundary.containers.map(
      (container) => `${inner}${renderContainer(container)}`,
    ),
  ];
  return [
    `${indent}Boundary(${boundary.name}, "${boundary.label}") {`,
    ...children,
    `${indent}}`,
  ].join("\n");
};

const renderRelation = (
  container: Container,
  relation: Container["relations"][number],
): string => {
  const tech = relation.technology ? `, "${relation.technology}"` : "";
  const tags =
    relation.tags && relation.tags.length > 0
      ? `, $tags="${relation.tags.join("+")}"`
      : "";
  return `Rel(${container.name}, ${relation.to.name}, ""${tech}${tags})`;
};

const collectBoundaryContainerNames = (boundaries: Boundary[]): Set<string> => {
  const names = new Set<string>();
  const collect = (boundary: Boundary): void => {
    for (const c of boundary.containers) names.add(c.name);
    for (const b of boundary.boundaries) collect(b);
  };
  for (const boundary of boundaries) collect(boundary);
  return names;
};

const renderBody = (
  model: ArchitectureModel,
  standaloneContainers: Container[],
  boundaryLabel?: string,
): string[] => {
  if (boundaryLabel) {
    return [
      `Boundary(project, "${boundaryLabel}") {`,
      ...model.boundaries.map((b) => renderBoundary(b, "  ")),
      ...standaloneContainers.map((c) => `  ${renderContainer(c)}`),
      `}`,
    ];
  }

  return [
    ...model.boundaries.map((b) => renderBoundary(b, "")),
    ...standaloneContainers.map((c) => renderContainer(c)),
  ];
};

export const generatePlantumlFromModel = (
  model: ArchitectureModel,
  options?: PlantumlFromModelOptions,
): string => {
  const boundaryNames = collectBoundaryContainerNames(model.boundaries);
  const standaloneContainers = model.allContainers.filter(
    (c) => !boundaryNames.has(c.name),
  );

  const relations = model.allContainers.flatMap((container) =>
    container.relations.map((rel) => renderRelation(container, rel)),
  );

  return [
    `@startuml`,
    `!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml`,
    `LAYOUT_WITH_LEGEND()`,
    `AddRelTag("async", $lineStyle = DottedLine())`,
    "",
    ...renderBody(model, standaloneContainers, options?.boundaryLabel),
    "",
    ...relations,
    "@enduml",
  ].join("\n");
};
