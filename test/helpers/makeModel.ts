import type {
  Boundary,
  BoundaryKind,
  Element,
  ElementKind,
  Model,
  SourceLocation,
} from "../../src/model";
import { buildModel } from "../../src/model";

export interface ElementSpec {
  readonly name: string;
  readonly label?: string;
  readonly kind?: ElementKind;
  readonly external?: boolean;
  readonly description?: string;
  readonly technology?: string;
  readonly tags?: readonly string[];
  readonly sprite?: string;
  readonly relations?: readonly RelationSpec[];
  readonly link?: string;
  readonly properties?: Readonly<Record<string, string>>;
  /** Override the synthetic SourceLocation makeModel attaches by default. */
  readonly sourceLocation?: SourceLocation;
}

export interface RelationSpec {
  readonly to: string;
  readonly description?: string;
  readonly technology?: string;
  readonly tags?: readonly string[];
  readonly order?: number;
  readonly link?: string;
  readonly properties?: Readonly<Record<string, string>>;
  /** Lets rule tests pin precise-anchor behavior without going through a
   * full parser pass. Loaders populate this in production; here we inject
   * a fixture location and assert the rule echoed it back on the
   * resulting `Violation`. Defaults to a synthetic range so range-based
   * fix engines emit edits (the synth offsets don't match a real source
   * string — callers that pipe edits through `applyEdits` should load
   * via the format parser instead). */
  readonly sourceLocation?: SourceLocation;
}

export interface BoundarySpec {
  readonly name: string;
  readonly label?: string;
  readonly kind?: BoundaryKind;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly elementNames?: readonly string[];
  readonly boundaryNames?: readonly string[];
  readonly link?: string;
}

// Synthetic SourceLocation factory — every node gets one so range-based
// `--fix` engines emit edits even on fully-synthetic models. The offsets
// don't correspond to any real source; tests that need byte-correct
// splicing must load through the real format parser
// (`loadPumlString`, etc.) instead.
let synthOffset = 0;
const synthRange = (file = "synth.puml"): SourceLocation => {
  const start = synthOffset;
  const end = start + 10;
  synthOffset = end + 1;
  return {
    file,
    start: { line: 1, col: start + 1, offset: start },
    end: { line: 1, col: end + 1, offset: end },
  };
};

const makeElement = (spec: ElementSpec): Element => ({
  name: spec.name,
  label: spec.label ?? spec.name,
  kind: spec.kind ?? "Container",
  external: spec.external ?? false,
  description: spec.description ?? "",
  technology: spec.technology,
  tags: spec.tags ?? [],
  sprite: spec.sprite,
  relations: (spec.relations ?? []).map((r) => ({
    to: r.to,
    description: r.description,
    technology: r.technology,
    tags: r.tags ?? [],
    order: r.order,
    properties: r.properties,
    link: r.link,
    sourceLocation: r.sourceLocation ?? synthRange(),
  })),
  link: spec.link,
  properties: spec.properties,
  sourceLocation: spec.sourceLocation ?? synthRange(),
});

const makeBoundary = (spec: BoundarySpec): Boundary => ({
  name: spec.name,
  label: spec.label ?? spec.name,
  kind: spec.kind ?? "System",
  description: spec.description,
  tags: spec.tags ?? [],
  elementNames: spec.elementNames ?? [],
  boundaryNames: spec.boundaryNames ?? [],
  link: spec.link,
});

export interface ModelSpec {
  readonly elements?: readonly ElementSpec[];
  readonly boundaries?: readonly BoundarySpec[];
  readonly rootBoundaryNames?: readonly string[];
}

export const makeModel = (spec: ModelSpec): Model => {
  // Reset the synth-offset counter per call so subsequent makeModel
  // invocations in the same test don't drift indefinitely — keeps
  // ranges deterministic and human-readable when debugging.
  synthOffset = 0;
  const elements = (spec.elements ?? []).map(makeElement);
  const boundaries = (spec.boundaries ?? []).map(makeBoundary);
  const rootBoundaryNames =
    spec.rootBoundaryNames ?? boundaries.map((b) => b.name);
  return buildModel({ elements, boundaries, rootBoundaryNames }).model;
};
