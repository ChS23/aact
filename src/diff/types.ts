import type { BoundaryKind, ElementKind } from "../model";

/**
 * Architectural-change taxonomy for `aact diff`. The output is a
 * Terraform-style domain-grouped change log: every change identifies
 * an entity, an action, and the specific fields that moved. Optional
 * RFC 6902 `patch[]` rides along for tooling that wants to replay the
 * delta on a normalized Model JSON. Optional `ChangeGroup[]` is the
 * long-term extension point for higher-level architectural
 * interpretations over primitive changes.
 *
 * Why domain-grouped and not pure JSON Patch? Agents reading the
 * envelope reason about "what architecturally changed" — `added
 * relation web → api (HTTP)` is a useful sentence, whereas
 * `{op: "add", path: "/elements/web/relations/3", value: {…}}` forces
 * the consumer to re-derive intent. We keep both: the semantic layer
 * is primary, the patch layer is opt-in for round-trip.
 *
 * Severity heuristic (not configurable — kept neutral on purpose):
 *  - **structural** — added/removed elements, boundaries, relations;
 *    moves between boundaries; element/boundary kind transitions.
 *  - **semantic**   — technology / external / tags / order / properties
 *    changes; relation `from→to` technology swap (post-process collapse).
 *  - **cosmetic**   — label, description, sprite, link, workspace
 *    metadata.
 *
 * Renames are detected within the same `kind` only, with a similarity
 * score surfaced as `confidence`. Threshold defaults to 0.65; agents
 * gate on `confidence` if they want stricter rename behaviour.
 */
export type ChangeAction =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "moved";

export type ChangeSeverity = "structural" | "semantic" | "cosmetic";

/** Which Model sub-structure changed. Used inside `Change.fields[]`. */
export type FieldKind =
  | "kind"
  | "external"
  | "technology"
  | "description"
  | "label"
  | "tags"
  | "sprite"
  | "link"
  | "properties"
  | "boundary"
  | "order"
  | "workspace.name"
  | "workspace.description"
  | "workspace.extendsTarget"
  | "elementNames"
  | "boundaryNames";

export interface FieldChange {
  readonly field: FieldKind;
  readonly before: unknown;
  readonly after: unknown;
  /** Set delta for array-of-string fields (tags, elementNames, etc.) —
   *  computed once instead of forcing every consumer to diff before/after. */
  readonly added?: readonly string[];
  readonly removed?: readonly string[];
}

interface ChangeBase {
  readonly action: ChangeAction;
  readonly severity: ChangeSeverity;
  /**
   * Stable cross-reference ID — `element:api`, `relation:web→api`,
   * `boundary:platform`, `workspace`. Mirrors Terraform's
   * `address` convention; lets logs / PR comments link to a
   * specific change without ambiguity.
   */
  readonly address: string;
}

export interface ElementChange extends ChangeBase {
  readonly entity: "element";
  /** Current name (after rename, if applicable). */
  readonly name: string;
  /** Previous name when `action === "renamed"`, else absent. */
  readonly previousName?: string;
  /** Similarity score from the rename detector when
   *  `action === "renamed"` — agents gate on this when they want
   *  to ignore low-confidence rename guesses. */
  readonly confidence?: number;
  readonly kind: ElementKind;
  readonly fields: readonly FieldChange[];
}

export interface BoundaryChange extends ChangeBase {
  readonly entity: "boundary";
  readonly name: string;
  readonly previousName?: string;
  readonly confidence?: number;
  readonly kind: BoundaryKind;
  readonly fields: readonly FieldChange[];
}

export interface RelationChange extends ChangeBase {
  readonly entity: "relation";
  readonly from: string;
  readonly to: string;
  /**
   * Relation identity for matching: `(from, to, technology)`. The
   * differ matches on this triple first, then a post-process
   * pass collapses same-`(from, to)` removed+added pairs into a
   * single `modified` with `field: "technology"` — that surface
   * is much easier to read on PR review than two paired entries.
   */
  readonly technology?: string;
  readonly fields: readonly FieldChange[];
}

export interface WorkspaceChange extends ChangeBase {
  readonly entity: "workspace";
  readonly fields: readonly FieldChange[];
}

export type Change =
  | ElementChange
  | BoundaryChange
  | RelationChange
  | WorkspaceChange;

export interface ChangeGroup {
  /** Stable group id inside one diff result, e.g. `group:introducedRepository:orders`. */
  readonly id: string;
  /** Open-ended pattern key; consumers must ignore unknown values. */
  readonly kind: string;
  /** Template-generated human title, not LLM prose. */
  readonly title: string;
  /** Maximum severity of grouped primitive changes. */
  readonly severity: ChangeSeverity;
  /** Pattern confidence in [0,1]. */
  readonly confidence: number;
  /** Addresses of primitive `changes[]` entries this group explains. */
  readonly changeAddresses: readonly string[];
  /** Pattern-specific facts used to form the group and title. */
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface DiffSummary {
  /** One-liner reasoning seed for agents — `"+2 elements, -1 relation,
   *  1 technology change [structural]"`. First field they read. */
  readonly headline: string;
  readonly bySeverity: Record<ChangeSeverity, number>;
  readonly byAction: Record<ChangeAction, number>;
  readonly byEntity: Record<
    "element" | "boundary" | "relation" | "workspace",
    number
  >;
}

export interface DiffSide {
  /** Caller-supplied label — `"baseline.puml"`, `"main:architecture.puml"`,
   *  `"<stdin>"`, etc. Surfaces in headers and CI logs. */
  readonly source: string;
  /** Format id from the registry — `"plantuml"`, `"structurizr"`,
   *  `"model-json"`. */
  readonly format: string;
}

export interface JsonPatchOp {
  readonly op: "add" | "remove" | "replace";
  readonly path: string;
  readonly value?: unknown;
}

export interface DiffData {
  readonly summary: DiffSummary;
  /** Sorted: severity desc → action precedence (removed > added > modified
   *  > renamed > moved) → address asc. The first entries are always
   *  the highest-impact ones, so agents truncating to top-N never
   *  miss a structural change. */
  readonly changes: readonly Change[];
  /** Optional higher-level architectural interpretations over
   *  primitive changes. The primitive `changes[]` remain the source
   *  of truth; groups are explanatory and do not affect exit codes. */
  readonly groups?: readonly ChangeGroup[];
  /** RFC 6902 ops against the normalized Model JSON. Opt-in via
   *  `--with-patch` (CLI) or `{ withPatch: true }` (library). Omitted
   *  by default to keep payload size lean — agents reading the
   *  domain-grouped `changes[]` rarely need raw ops. */
  readonly patch?: readonly JsonPatchOp[];
  readonly baseline: DiffSide;
  readonly current: DiffSide;
}

export interface DiffOptions {
  /** Similarity threshold for rename detection (0..1). Default 0.65. */
  readonly renameThreshold?: number;
  /** Disable rename heuristic entirely — pure add/remove pairs. */
  readonly disableRenameDetection?: boolean;
  /** Include RFC 6902 `patch[]` in output. Default false. */
  readonly withPatch?: boolean;
}
