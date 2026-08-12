/**
 * C4-PlantUML AST — typed nodes emitted by the chevrotain parser.
 *
 * Grounded in `src/formats/plantuml/parser/grammar.md`, which is
 * itself grounded in `.parser-refs/C4-PlantUML/` macro signatures.
 * Every node shape here corresponds 1-to-1 with a row in grammar.md;
 * anything not documented in grammar.md does not appear here.
 *
 * Design rules (same as the Structurizr AST):
 *
 *   1. Every node carries `range: SourceLocation` — mandatory.
 *   2. Discriminated union on `kind`.
 *   3. 1-to-1 with the Model contract per Phase 0 inventory.
 *   4. Opaque / out-of-scope material lives under `OpaqueMacroCall`
 *      or `InfoIssueMacroCall`.
 *   5. No semantic validation here.
 *
 * Conceptual model. A C4-PlantUML source is a sequence of `@startuml
 * ... @enduml` diagrams; each diagram is a sequence of statements. A
 * statement is either a macro call (`Container(...)`, `Rel(...)`,
 * `Container_Boundary(...) { ... }`) or a preprocessor directive
 * (`!include`, `!define`, `!if`/`!else`, ...). The C4 macro layer
 * sits on top of plain PlantUML — anything the lexer does not
 * recognise as a C4 macro or directive is tokenized-and-ignored.
 *
 * Reference: see grammar.md sections cited in each node's JSDoc.
 */

import type { SourceLocation } from "../../../model";

// ── Base ────────────────────────────────────────────────────────────────

interface AstNodeBase {
  readonly kind: string;
  readonly range: SourceLocation;
}

/** See Structurizr ast.ts for the recovery semantics — identical here. */
interface RecoverableNode extends AstNodeBase {
  readonly recovered?: true;
}

// ── File ────────────────────────────────────────────────────────────────

/**
 * A `.puml` source file. May contain multiple `@startuml ... @enduml`
 * diagrams. aact processes only the first; subsequent ones surface as
 * an info-issue. See grammar.md §6.
 */
export interface FileNode extends AstNodeBase {
  readonly kind: "file";
  readonly diagrams: readonly DiagramNode[];
}

/**
 * `@startuml [name] ... @enduml`. The `name` slot is optional and may
 * be a bare identifier, a quoted string, or a path-like token.
 */
export interface DiagramNode extends RecoverableNode {
  readonly kind: "diagram";
  readonly name?: DiagramName;
  readonly statements: readonly DiagramStatement[];
}

/** `name` token after `@startuml` — three accepted forms. */
export interface DiagramName extends AstNodeBase {
  readonly kind: "diagramName";
  /** As written, unescaped (quotes stripped if quoted). */
  readonly value: string;
  /** Token form actually used by the source. */
  readonly form: "identifier" | "string" | "path";
}

export type DiagramStatement =
  | ElementMacro
  | BoundaryMacro
  | RelationMacro
  | LayoutMacro
  | PreprocessorDirective
  | OpaqueMacroCall
  | InfoIssueMacroCall;

// ── Element macros (Person / System / Container / Component) ───────────

/**
 * The set of accepted element macro names (per grammar.md §1.x
 * Element macros). `toModel` switches on this to map to
 * `Container.kind` and `Container.external`. Context-level macros
 * (Person/System*) do NOT have a `$techn` slot; their `$type`
 * positional carries the architectural technology string instead.
 */
export type ElementMacroName =
  // Context family
  | "Person"
  | "Person_Ext"
  | "System"
  | "SystemDb"
  | "SystemQueue"
  | "System_Ext"
  | "SystemDb_Ext"
  | "SystemQueue_Ext"
  // Container family
  | "Container"
  | "ContainerDb"
  | "ContainerQueue"
  | "Container_Ext"
  | "ContainerDb_Ext"
  | "ContainerQueue_Ext"
  // Component family
  | "Component"
  | "ComponentDb"
  | "ComponentQueue"
  | "Component_Ext"
  | "ComponentDb_Ext"
  | "ComponentQueue_Ext";

/**
 * Every C4 element macro shares the same positional structure: alias
 * first, then label, then a family-specific subset of (technology,
 * description, sprite, tags, link, type, baseShape). Named-argument
 * syntax (`$tags=`, `$sprite=`, `$link=`, `$index=`) may appear at
 * any position. We capture both.
 *
 * The exact list of accepted named args is open-ended — `C4_Sequence`
 * adds `$rel`, future stdlib versions may add more. The parser routes
 * unknown named args into `unknownNamedArgs` so future extensions
 * don't crash existing files. See grammar.md §1.1 "Named arg".
 *
 * Per macro family, the `positionals` are interpreted differently
 * (Context has no `$techn` slot; Container/Component do). `toModel`
 * disambiguates via `macroName`.
 */
export interface ElementMacro extends RecoverableNode {
  readonly kind: "elementMacro";
  readonly macroName: ElementMacroName;
  readonly positionals: readonly ArgumentValue[];
  readonly namedArgs: readonly NamedArg[];
  readonly unknownNamedArgs: readonly NamedArg[];
}

// ── Boundary macros (open a `{ ... }` block) ───────────────────────────

/**
 * The set of accepted boundary macro names. Verified against the
 * C4-PlantUML stdlib (`.parser-refs/C4-PlantUML/`): there is NO
 * `Component_Boundary` macro. To group Components, use
 * `Container_Boundary` (per upstream README and c4model.com — no
 * concept of "component boundary" exists in the C4 model).
 */
export type BoundaryMacroName =
  | "Enterprise_Boundary"
  | "System_Boundary"
  | "Container_Boundary"
  | "Boundary"; // generic, has $type slot

/**
 * Boundary macro signature (per grammar.md §1.2 Boundary macros):
 *   <BoundaryMacro>($alias, $label, $tags="", $link="", $descr="")
 * Note the argument order — `$tags` / `$link` come BEFORE `$descr`,
 * which differs from element macros.
 *
 * The generic `Boundary` macro has an extra `$type` slot at position 3
 * (`Boundary($alias, $label, $type="", $tags="", $link="", $descr="")`)
 * which carries the architectural kind string ("Enterprise" /
 * "System" / "Container" / arbitrary).
 *
 * `children` carries the nested statements inside the `{ ... }`
 * block — nested elements, nested boundaries, relations.
 */
export interface BoundaryMacro extends RecoverableNode {
  readonly kind: "boundaryMacro";
  readonly macroName: BoundaryMacroName;
  readonly positionals: readonly ArgumentValue[];
  readonly namedArgs: readonly NamedArg[];
  readonly unknownNamedArgs: readonly NamedArg[];
  readonly children: readonly DiagramStatement[];
}

// ── Relations (Rel*, RelIndex*, BiRel*) ─────────────────────────────────

/**
 * The C4 relation family. All variants share the same argument shape
 * apart from `RelIndex*` which prepends a mandatory `$e_index`
 * positional, and `BiRel*` which omits the `$index` slot entirely.
 *
 * `direction` decodes the suffix on the macro name; `back` decodes the
 * `_Back` variant; `neighbor` decodes `_Neighbor`. These flags drive
 * the toModel mapping per grammar.md §1.x Relationships:
 *
 *   - `BiRel*` → emit two `Relation` entries (one each direction).
 *   - `Rel_Back*` → swap source / destination semantically.
 *   - `RelIndex*` → populate `Relation.order = $e_index`.
 *   - Other suffixes (`_D`, `_U`, etc.) are layout hints; toModel
 *     ignores them for the Model but the AST records them so the
 *     generator can round-trip the layout choice.
 *
 * Asymmetry pinned: `BiRel` has NO `_Back` or `_Back_Neighbor`
 * variants — only `BiRel`, `BiRel_Neighbor`, and the 4 directional
 * pairs. `RelIndex` has all 12 directional + neighbor + back +
 * back-neighbor combinations.
 */
export interface RelationMacro extends RecoverableNode {
  readonly kind: "relationMacro";
  readonly macroName: string;
  /** Bidirectional (`BiRel` family) or unidirectional. */
  readonly bidirectional: boolean;
  /** `_Back` variant — semantic source/destination swap. */
  readonly back: boolean;
  /** `_Neighbor` variant — layout hint, no Model semantics. */
  readonly neighbor: boolean;
  /** `_D`/`_Down`/`_U`/`_Up`/`_L`/`_Left`/`_R`/`_Right` or undefined. */
  readonly direction?: "D" | "U" | "L" | "R";
  /** Mandatory first positional for `RelIndex*`; undefined for `Rel*` / `BiRel*`. */
  readonly indexPositional?: ArgumentValue;
  readonly positionals: readonly ArgumentValue[];
  readonly namedArgs: readonly NamedArg[];
  readonly unknownNamedArgs: readonly NamedArg[];
}

// ── Layout macros (Lay_*) ───────────────────────────────────────────────

/**
 * `Lay_D` / `Lay_Down` / `Lay_U` / `Lay_Up` / `Lay_L` / `Lay_Left` /
 * `Lay_R` / `Lay_Right` / `Lay_Distance`. Two-argument layout hints
 * (`Lay_*($from, $to)`) plus `Lay_Distance($from, $to, $distance="0")`.
 * Lex recognises; AST captures; toModel does NOT emit them as Model
 * relations — they are graphical hints, not architectural relations.
 */
export interface LayoutMacro extends AstNodeBase {
  readonly kind: "layoutMacro";
  readonly macroName: string;
  readonly positionals: readonly ArgumentValue[];
}

// ── Preprocessor directives ─────────────────────────────────────────────

export type PreprocessorDirective = IncludeDirective | PuTokenIgnore;

/**
 * `!include <url|path>` — inlines another `.puml` file. `!includeurl`
 * is a legacy alias accepted for compatibility. URLs are recognised
 * but NOT fetched — they are marker tokens declaring the C4-PlantUML
 * dialect. See grammar.md §1.x Preprocessor.
 */
export interface IncludeDirective extends AstNodeBase {
  readonly kind: "include";
  /** Whether the source used the legacy `!includeurl` spelling. */
  readonly legacyUrlSpelling: boolean;
  readonly target: StringLiteral;
}

/**
 * Any other preprocessor directive — `!define`, `!procedure`,
 * `!function`, `!unquoted procedure`, `!unquoted function`,
 * `!endprocedure`, `!endfunction`, `!if`, `!else`, `!elseif`,
 * `!endif`, `!ifndef`, `!variable_exists`, `!return`, `!global`. The
 * lexer recognises them; the parser captures the directive name and
 * raw body without interpretation. See grammar.md §1.x Preprocessor.
 *
 * The C4-PlantUML stdlib itself uses `!if`/`!variable_exists`/etc.
 * (e.g. `C4_Dynamic.puml:2`) so the parser MUST handle these
 * gracefully or it will choke on `!include` of the stdlib.
 */
export interface PuTokenIgnore extends AstNodeBase {
  readonly kind: "preprocessorTokenIgnore";
  /** The `!` directive name as written (e.g. `!define`). */
  readonly name: string;
  readonly rawContent: string;
}

// ── Opaque and info-issue macro calls ──────────────────────────────────

/**
 * Macros the parser recognises but does not interpret —
 * `LAYOUT_*`, `HIDE_STEREOTYPE`, `SHOW_LEGEND` family,
 * `SetPropertyHeader` / `AddProperty` / `WithoutPropertyHeader`,
 * `AddElementTag` / `AddRelTag` / `AddBoundaryTag` family,
 * `UpdateElementStyle` / `UpdateRelStyle` / `Update*BoundaryStyle`
 * family, `SET_SKETCH_STYLE`, `SetDefaultLegendEntries`,
 * `UpdateLegendTitle`. Captured for raw round-trip via
 * `LoadResult.raw`. See grammar.md §2.
 */
export interface OpaqueMacroCall extends AstNodeBase {
  readonly kind: "opaqueMacroCall";
  readonly macroName: string;
  readonly positionals: readonly ArgumentValue[];
  readonly namedArgs: readonly NamedArg[];
}

/**
 * `C4_Deployment` family — `Deployment_Node`, `Node`, `Node_L`,
 * `Node_R`, `Deployment_Node_L`, `Deployment_Node_R`. Recognised so a
 * legal C4-PUML file does not crash, but `toModel` emits
 * `ModelIssue` severity=info ("deployment view is outside aact's
 * C4 scope; ignored"). See grammar.md §3.
 */
export interface InfoIssueMacroCall extends RecoverableNode {
  readonly kind: "infoIssueMacroCall";
  readonly macroName: string;
  readonly positionals: readonly ArgumentValue[];
  readonly namedArgs: readonly NamedArg[];
  /** Deployment macros may have a `{ ... }` body; captured raw. */
  readonly rawBody?: string;
}

// ── Argument values ─────────────────────────────────────────────────────

/**
 * A macro argument value. Per grammar.md §1.1 "Function-call argument"
 * the value may be a string literal, a bare identifier (often a
 * macro/element alias), or an inline function call (e.g. `Index()`,
 * `RoundedBoxShape()`, `LEGEND()`, `Small()`).
 */
export type ArgumentValue = StringLiteral | BareToken | FunctionCallValue;

export interface BareToken extends AstNodeBase {
  readonly kind: "bareToken";
  readonly value: string;
}

/**
 * Inline function-call expression used as an argument value —
 * `Index()`, `RoundedBoxShape()`, `LEGEND()`, `Small()`,
 * `DottedLine()`, etc. Captured verbatim; toModel evaluates only the
 * subset relevant to Model (currently: `Index()` for `Relation.order`
 * when used as `$index=Index()`).
 */
export interface FunctionCallValue extends AstNodeBase {
  readonly kind: "functionCallValue";
  readonly functionName: string;
  readonly args: readonly ArgumentValue[];
}

/**
 * Named argument `$name=value`. Known names on `Rel*` per the stdlib:
 * `$tags`, `$sprite`, `$link`, `$index`. The parser also routes
 * unknown `$name=` args into `unknownNamedArgs` on the enclosing
 * macro to preserve future stdlib additions without breaking
 * existing files.
 */
export interface NamedArg extends AstNodeBase {
  readonly kind: "namedArg";
  readonly name: string;
  readonly value: ArgumentValue;
}

// ── Leaves ──────────────────────────────────────────────────────────────

/**
 * A double-quoted string in source. `value` is the unescaped string;
 * `range` spans opening to closing quote inclusive.
 */
export interface StringLiteral extends AstNodeBase {
  readonly kind: "string";
  readonly value: string;
}
