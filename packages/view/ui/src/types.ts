/**
 * Minimal types matching the aact Model JSON shape — only the
 * fields the UI actually reads. We could import the full `Model`
 * type from `aact`, but the SPA build is browser-only and we want
 * to keep `aact` out of the client bundle. Re-declaring the slice
 * we touch keeps the boundary explicit.
 */

export type ElementKind =
  | "Person"
  | "System"
  | "SystemDb"
  | "SystemQueue"
  | "Container"
  | "ContainerDb"
  | "ContainerQueue"
  | "Component"
  | "ComponentDb"
  | "ComponentQueue";

export type BoundaryKind = "System" | "Container" | "Component" | "Enterprise";

export interface SourceLocation {
  readonly file: string;
  readonly start: { readonly line: number; readonly col: number };
  readonly end: { readonly line: number; readonly col: number };
}

export interface Relation {
  readonly to: string;
  readonly description?: string;
  readonly technology?: string;
  readonly tags: readonly string[];
  readonly link?: string;
  readonly sourceLocation?: SourceLocation;
}

export interface Element {
  readonly name: string;
  readonly label: string;
  readonly kind: ElementKind;
  readonly external: boolean;
  readonly description?: string;
  readonly technology?: string;
  readonly tags: readonly string[];
  readonly link?: string;
  readonly relations: readonly Relation[];
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

export interface Boundary {
  readonly name: string;
  readonly label: string;
  readonly kind: BoundaryKind;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly elementNames: readonly string[];
  readonly boundaryNames: readonly string[];
  readonly link?: string;
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

export interface Model {
  readonly elements: Readonly<Record<string, Element>>;
  readonly boundaries: Readonly<Record<string, Boundary>>;
  readonly rootBoundaryNames: readonly string[];
  readonly workspace?: {
    readonly name?: string;
    readonly description?: string;
  };
}

export interface ModelIssue {
  readonly kind: string;
  readonly message?: string;
  readonly element?: string;
  readonly boundary?: string;
}

/** Architecture metrics surfaced on the envelope so the SPA can
 *  render an Analyze overlay without a second round-trip. Mirrors
 *  the public `AnalysisReport` shape exported by aact core. */
export interface AnalysisReport {
  readonly elementsCount: number;
  readonly elementsByKind: Readonly<Record<string, number>>;
  readonly databases: { readonly count: number; readonly consumes: number };
  readonly relationsByStyle: {
    readonly sync: number;
    readonly async: number;
    readonly unspecified: number;
  };
  readonly boundaries: ReadonlyArray<{
    readonly name: string;
    readonly label: string;
    readonly cohesion: number;
    readonly coupling: number;
    readonly syncCoupling: number;
    readonly asyncCoupling: number;
    readonly unspecifiedCoupling: number;
    readonly ratio: number | null;
  }>;
  readonly fanIn: ReadonlyArray<{
    readonly name: string;
    readonly count: number;
  }>;
  readonly fanOut: ReadonlyArray<{
    readonly name: string;
    readonly count: number;
  }>;
  readonly cycles: {
    readonly count: number;
    readonly smallest: readonly string[] | null;
  };
}

/** Minimal mirror of aact's `Change` / `ChangeGroup` / `DiffData`
 *  shapes — UI only reads the fields it needs to render the overlay.
 *  Renaming/adding fields on the aact side must keep these in sync. */
export interface FieldChange {
  readonly field: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly added?: readonly string[];
  readonly removed?: readonly string[];
}

export type ChangeAction =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "moved";
export type ChangeSeverity = "structural" | "semantic" | "cosmetic";

interface ChangeBase {
  readonly action: ChangeAction;
  readonly severity: ChangeSeverity;
  readonly address: string;
  readonly fields: readonly FieldChange[];
}

export interface ElementDiffChange extends ChangeBase {
  readonly entity: "element";
  readonly name: string;
  readonly previousName?: string;
  readonly confidence?: number;
  readonly kind: ElementKind;
}

export interface BoundaryDiffChange extends ChangeBase {
  readonly entity: "boundary";
  readonly name: string;
  readonly previousName?: string;
  readonly confidence?: number;
  readonly kind: BoundaryKind;
}

export interface RelationDiffChange extends ChangeBase {
  readonly entity: "relation";
  readonly from: string;
  readonly to: string;
  readonly technology?: string;
}

export interface WorkspaceDiffChange extends ChangeBase {
  readonly entity: "workspace";
}

export type DiffChange =
  | ElementDiffChange
  | BoundaryDiffChange
  | RelationDiffChange
  | WorkspaceDiffChange;

export interface DiffChangeGroup {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly severity: ChangeSeverity;
  readonly confidence: number;
  readonly changeAddresses: readonly string[];
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface DiffSummary {
  readonly headline: string;
  readonly bySeverity: Readonly<Record<ChangeSeverity, number>>;
  readonly byAction: Readonly<Record<ChangeAction, number>>;
  readonly byEntity: Readonly<Record<string, number>>;
}

export interface DiffData {
  readonly summary: DiffSummary;
  readonly changes: readonly DiffChange[];
  readonly groups?: readonly DiffChangeGroup[];
}

export interface ModelEnvelope {
  readonly schemaVersion: 1;
  readonly command: "view";
  readonly ok: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly data: {
    readonly model: Model;
    readonly issues: readonly ModelIssue[];
    readonly analysis: AnalysisReport;
    /** Present when the workbench is in diff mode (booted with
     *  `aact view --diff <baseline>`). UI renders status colours on
     *  current nodes/relations plus a sidebar list for removed items. */
    readonly diff?: {
      readonly baselineModel: Model;
      readonly data: DiffData;
    };
  };
  readonly meta: {
    readonly aactVersion: string;
    readonly durationMs: number;
    readonly configPath: string | null;
    readonly source: string | null;
  };
}

export interface ViewError {
  readonly message: string;
  readonly source: string | null;
  readonly configPath: string | null;
  readonly durationMs: number;
  readonly at: string;
}

export type ServerMessage =
  | { readonly type: "model-update"; readonly envelope: ModelEnvelope }
  | { readonly type: "model-error"; readonly error: ViewError };

/**
 * One step on the drill-down stack. `landscape` is the implicit
 * root that's always at the bottom; entries above it identify a
 * boundary the user descended into. Element focus is rendered as
 * a side-panel selection on the current stack level, not as a
 * dedicated stack entry — the graph still shows the same level,
 * the right pane just zeroes in on the picked node.
 */
export type BreadcrumbEntry =
  | { readonly kind: "landscape" }
  | {
      readonly kind: "boundary";
      readonly name: string;
      readonly label: string;
    };
