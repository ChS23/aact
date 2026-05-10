import {
  Stdlib_C4_Boundary,
  Stdlib_C4_Container_Component,
  Stdlib_C4_Context,
  Stdlib_C4_Dynamic_Rel,
  UMLElement,
} from "plantuml-parser";

import { ArchitectureModel, Boundary, Container } from "../../model";

const addDependency = (
  containers: Container[],
  relation: Stdlib_C4_Dynamic_Rel,
): void => {
  const containerFrom = containers.find((x) => x.name === relation.from);
  if (!containerFrom) return;
  const containerTo = containers.find((x) => x.name === relation.to);
  if (!containerTo) return;
  containerFrom.relations.push({
    to: containerTo,
    technology: relation.techn,
    tags: relation.descr?.split(",").map((t) => t.trim()),
  });
};

export const mapContainersFromPlantumlElements = (
  elements: UMLElement[],
): ArchitectureModel => {
  const containers: Container[] = elements
    .filter(
      (element) =>
        element instanceof Stdlib_C4_Container_Component ||
        element instanceof Stdlib_C4_Context,
    )
    .map((element) => {
      const component = element as Stdlib_C4_Container_Component;
      return {
        name: component.alias,
        label: component.label,
        type: component.type_.name,
        relations: [],
        tags: component.sprite ? [component.sprite] : undefined,
        description: component.descr,
      };
    });

  for (const element of elements) {
    if (element instanceof Stdlib_C4_Container_Component) {
      continue;
    }

    if (element instanceof Stdlib_C4_Dynamic_Rel) {
      addDependency(containers, element);
    }
  }

  const boundaries: Boundary[] = elements
    .filter((element) => element instanceof Stdlib_C4_Boundary)
    .map((element) => {
      const component = element;
      return {
        name: component.alias,
        label: component.label,
        type: component.type_.name,
        boundaries: [],
        containers: containers.filter((container) =>
          component.elements
            .filter(
              (element) => element instanceof Stdlib_C4_Container_Component,
            )
            .some((e) => e.alias == container.name),
        ),
      };
    });

  for (const boundary of boundaries) {
    const component = elements.find(
      (element) =>
        element instanceof Stdlib_C4_Boundary && element.alias == boundary.name,
    ) as Stdlib_C4_Boundary;

    boundary.boundaries = boundaries.filter((b) =>
      component.elements
        .filter((element) => element instanceof Stdlib_C4_Boundary)
        .some((e) => e.alias == b.name),
    );
  }

  return {
    allContainers: containers.toSorted((a, b) => a.name.localeCompare(b.name)),
    boundaries: boundaries,
  };
};
