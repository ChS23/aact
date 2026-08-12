import { meaningfulTags } from "./tags";
import type { Boundary, Element, Model, WorkspaceMetadata } from "./types";
import type { ModelIssue } from "./validate";
import { validateModel } from "./validate";

/**
 * Strip implicit styling tags (`Element` / `Container` / `External` /
 * `Relationship` / …) from an element and its relations. Every loader
 * flows through here, so this is the one place that guarantees
 * `Model.tags` holds only user-authored tags — see `./tags.ts`.
 */
const withMeaningfulTags = (e: Element): Element =>
  Object.freeze({
    ...e,
    tags: Object.freeze(meaningfulTags(e.tags)),
    relations: Object.freeze(
      e.relations.map((r) =>
        Object.freeze({ ...r, tags: Object.freeze(meaningfulTags(r.tags)) }),
      ),
    ),
  });

const boundaryWithMeaningfulTags = (b: Boundary): Boundary =>
  Object.freeze({ ...b, tags: Object.freeze(meaningfulTags(b.tags)) });

/**
 * Все loader'ы (PlantUML, Structurizr, Kubernetes, future Mermaid/Compose/
 * LikeC4) строят Model через эту единственную точку. Гарантии:
 *
 *  1. Duplicate name detection — перед insertion'ом в Record. Issue вместо
 *     silent overwrite (что Record делает по умолчанию).
 *  2. Final validateModel pass — dangling refs, boundary cycles, unknown
 *     kinds. Issues аккумулируются с pre-build duplicates.
 *  3. Immutable Model — Object.freeze на elements/boundaries/root names.
 *  4. Stable insertion order — sorted by name для deterministic output
 *     (JSON snapshot тестов, diff-friendly serialization).
 *
 * Tests могут конструировать Model вручную через literal, но через
 * buildModel гарантия проверок одинакова с loader'ами.
 */
export interface ModelBuildInput {
  readonly elements: readonly Element[];
  readonly boundaries: readonly Boundary[];
  readonly rootBoundaryNames: readonly string[];
  /** Workspace-level metadata (name, description, extends target).
   *  Optional — formats without a workspace header omit it. */
  readonly workspace?: WorkspaceMetadata;
  /** Issues найденные loader'ом до сборки (parse errors etc.) — добавляются к ModelIssue'ам валидации. */
  readonly preIssues?: readonly ModelIssue[];
}

export interface ModelBuildResult {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
}

export const buildModel = (input: ModelBuildInput): ModelBuildResult => {
  const issues: ModelIssue[] = [...(input.preIssues ?? [])];

  const elementMap: Record<string, Element> = Object.create(null) as Record<
    string,
    Element
  >;
  for (const e of [...input.elements].toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (e.name in elementMap) {
      issues.push({ kind: "duplicate-element-name", name: e.name });
      continue;
    }
    elementMap[e.name] = withMeaningfulTags(e);
  }

  const boundaryMap: Record<string, Boundary> = Object.create(null) as Record<
    string,
    Boundary
  >;
  for (const b of [...input.boundaries].toSorted((x, y) =>
    x.name.localeCompare(y.name),
  )) {
    if (b.name in boundaryMap) {
      issues.push({ kind: "duplicate-boundary-name", name: b.name });
      continue;
    }
    boundaryMap[b.name] = boundaryWithMeaningfulTags(b);
  }

  const model: Model = Object.freeze({
    elements: Object.freeze(elementMap),
    boundaries: Object.freeze(boundaryMap),
    rootBoundaryNames: Object.freeze([...input.rootBoundaryNames]),
    ...(input.workspace ? { workspace: Object.freeze(input.workspace) } : {}),
  });

  return {
    model,
    issues: Object.freeze([...issues, ...validateModel(model)]),
  };
};
