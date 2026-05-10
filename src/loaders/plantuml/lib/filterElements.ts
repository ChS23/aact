import {
  Comment,
  Relationship,
  Stdlib_C4_Boundary,
  Stdlib_C4_Container_Component,
  Stdlib_C4_Context,
  Stdlib_C4_Dynamic_Rel,
  UMLElement,
} from "plantuml-parser";

import {
  PLANTUML_BOUNDARY,
  PLANTUML_COMPONENT,
  PLANTUML_CONTAINER,
  PLANTUML_CONTAINER_BOUNDARY,
  PLANTUML_CONTAINER_DB,
  PLANTUML_PERSON,
  PLANTUML_SYSTEM,
  PLANTUML_SYSTEM_BOUNDARY,
  PLANTUML_SYSTEM_EXT,
} from "../c4Types";

export const filterElements = (elements: UMLElement[]): UMLElement[] => {
  const result: UMLElement[] = [];

  for (const element of elements) {
    if (element instanceof Comment) continue;
    if (
      (element as Stdlib_C4_Container_Component).type_.name ===
        PLANTUML_CONTAINER ||
      (element as Stdlib_C4_Container_Component).type_.name ===
        PLANTUML_CONTAINER_DB ||
      (element as Stdlib_C4_Container_Component).type_.name ===
        PLANTUML_COMPONENT ||
      (element as Stdlib_C4_Context).type_.name === PLANTUML_SYSTEM_EXT ||
      (element as Stdlib_C4_Context).type_.name === PLANTUML_SYSTEM ||
      (element as Stdlib_C4_Context).type_.name === PLANTUML_PERSON ||
      element instanceof Stdlib_C4_Dynamic_Rel ||
      element instanceof Relationship
    ) {
      result.push(element);
    }

    const elementAsBoundary = element as Stdlib_C4_Boundary;
    if (
      [
        PLANTUML_SYSTEM_BOUNDARY,
        PLANTUML_CONTAINER_BOUNDARY,
        PLANTUML_BOUNDARY,
      ].includes(elementAsBoundary.type_.name)
    ) {
      result.push(elementAsBoundary);
      const resultFromBoundary = filterElements(elementAsBoundary.elements);
      result.push(...resultFromBoundary);
    }

    if (Array.isArray(element)) {
      const resultFromArray = filterElements(element);
      result.push(...resultFromArray);
    }
  }

  return result;
};
