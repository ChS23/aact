/**
 * Structurizr DSL AST — typed nodes emitted by the chevrotain parser.
 *
 * Grounded in `src/formats/structurizr/parser/grammar.md`, which is
 * itself grounded in `.parser-refs/java/structurizr-dsl/`. Every node
 * shape here corresponds 1-to-1 with a row in grammar.md; anything not
 * documented in grammar.md does not appear here.
 *
 * Design rules:
 *
 *   1. Every node carries `range: SourceLocation` — mandatory, no
 *      placeholder values. If the parser cannot place a node in the
 *      file, it does not emit the node.
 *   2. The AST is a discriminated union on `kind`. Every node has a
 *      unique `kind` string; the `toModel` mapper switches on it.
 *   3. AST → Model mapping is 1-to-1 with the field matrix in
 *      `docs/v3-parser-phase-0-inventory.md`. Constructs the linter
 *      does not model (`views` / `styles` / deployment blocks, etc.)
 *      are stripped from the token stream pre-parse and never reach
 *      the AST — see `preParse.ts`.
 *   4. Identifiers are kept as written. Identifier resolution
 *      (hierarchical vs flat scopes, archetype-alias lookup,
 *      `structurizr.dsl.identifier` property) is a `toModel` concern,
 *      not the parser's.
 *   5. No semantic validation here. Duplicate names, dangling refs,
 *      boundary cycles — all live in `validateModel`.
 *
 * Reference: see grammar.md sections cited in each node's JSDoc.
 */

import type { SourceLocation } from "../../../model";

// ── Base ────────────────────────────────────────────────────────────────

/** Every AST node has a kind discriminator + a mandatory source range. */
interface AstNodeBase {
  readonly kind: string;
  readonly range: SourceLocation;
}

/**
 * Marker propagated up an AST node when its body contained a parse
 * error and the parser recovered to the next sync point. `toModel`
 * skips nodes with `recovered: true` when building Model but still
 * emits the parser error as a `ModelIssue`. See grammar.md §5.
 */
interface RecoverableNode extends AstNodeBase {
  readonly recovered?: true;
}

// ── Workspace root ──────────────────────────────────────────────────────

/**
 * `workspace [name] [description] { ... }` plus optional `workspace
 * extends <file|url> { ... }`.
 *
 * `extendsTarget` carries the file/url string when the workspace
 * declares an extends. The reference parser would load and merge the
 * referenced workspace; aact does not (scope discipline — emit
 * info-issue at toModel time). See grammar.md §1.2.
 *
 * `body` carries the children in their source order: the `model`
 * block, every opaque block (views, styles, configuration, branding,
 * terminology, themes), every top-level directive, and the workspace
 * body overrides (`name "..."`, `description "..."`).
 */
export interface WorkspaceNode extends RecoverableNode {
  readonly kind: "workspace";
  readonly name?: StringLiteral;
  readonly description?: StringLiteral;
  readonly extendsTarget?: StringLiteral;
  readonly body: readonly WorkspaceBodyNode[];
}

export type WorkspaceBodyNode =
  | ModelNode
  | NameOverride
  | DescriptionOverride
  | DirectiveNode;

export interface NameOverride extends AstNodeBase {
  readonly kind: "nameOverride";
  readonly value: StringLiteral;
}

export interface DescriptionOverride extends AstNodeBase {
  readonly kind: "descriptionOverride";
  readonly value: StringLiteral;
}

// ── Model block ─────────────────────────────────────────────────────────

/**
 * `model { ... }` — top of the architecture model. Children may appear
 * in any order (the reference parser dispatches line by line); the AST
 * preserves source order.
 *
 * `archetypes { ... }` blocks are stripped opaque at lex time so their
 * declarations never reach the AST. Archetype usage forms (`<alias>
 * <id> "name"`, `a --<alias>-> b`) are documented gaps — see
 * grammar.md "Remaining gaps".
 */
export interface ModelNode extends RecoverableNode {
  readonly kind: "model";
  readonly children: readonly ModelChildNode[];
}

/**
 * Per grammar.md §1.x Elements, only `person` / `softwareSystem` /
 * `group` should appear at model scope; `container` / `component` live
 * inside `softwareSystem` / `container`. The parser is permissive
 * (admits any element kind anywhere), and `toModel` enforces the
 * nesting rules. This union therefore lists every element kind — a
 * misplaced `container` at model scope surfaces as a `ModelIssue`
 * later, not as a parse error here.
 */
export type ModelChildNode =
  | ElementNode
  | RelationshipNode
  | ReopenNode
  | DirectiveNode
  | PropertiesBlock;

/**
 * Re-open a previously declared element to attach more body
 * statements / nested elements / relationships. Source form:
 *
 *   api {
 *     description "Updated"
 *     -> db "writes"
 *   }
 *
 * The `target` identifier (possibly hierarchical: `bank.api`) resolves
 * via the same identifier map used for relationship endpoints; toModel
 * merges body statements into the existing Container or Boundary.
 */
export interface ReopenNode extends RecoverableNode {
  readonly kind: "reopen";
  readonly target: IdentifierRef;
  readonly body: readonly ElementBodyNode[];
}

// ── Elements ────────────────────────────────────────────────────────────

export type ElementNode =
  | PersonNode
  | SoftwareSystemNode
  | ContainerNode
  | ComponentNode
  | GroupNode
  | CustomElementNode;

/**
 * Common element fields. Maps to `Model.Container` after `toModel`.
 *
 * `assignedIdentifier` is the optional `name = ` prefix on the
 * declaration line (`api = container "API"`). When absent the parser
 * leaves it undefined and `toModel` falls back to a generated
 * identifier.
 *
 * `body` carries every statement found in the element's `{ ... }`
 * block in source order — both metadata statements (description /
 * technology / tags etc.) and nested elements. Per-element nesting
 * rules are validated downstream, not in the AST.
 */
interface ElementBase extends RecoverableNode {
  readonly assignedIdentifier?: Identifier;
  /** Element header positionals — `<keyword> "<name>" [...]`. */
  readonly name: StringLiteral;
  /** Tags string from the element header positional slot, if present. */
  readonly headerTags?: StringLiteral;
  readonly body: readonly ElementBodyNode[];
}

/**
 * `person <name> [description] [tags] { ... }`. No technology slot
 * (per `PersonParser.GRAMMAR`). `person` body has no nested elements
 * and no `technology` body statement. See grammar.md §1.x Elements.
 */
export interface PersonNode extends ElementBase {
  readonly kind: "person";
  readonly headerDescription?: StringLiteral;
}

/**
 * `softwareSystem <name> [description] [tags] { ... }`. No technology
 * slot. Body may contain `container` / `group` / `!docs` / `!decisions`
 * plus the common body statements. See grammar.md §1.x Elements.
 */
export interface SoftwareSystemNode extends ElementBase {
  readonly kind: "softwareSystem";
  readonly headerDescription?: StringLiteral;
}

/**
 * `container <name> [description] [technology] [tags] { ... }`. Has
 * technology slot. Body may contain `component` / `group` / `!docs` /
 * `!decisions`. See grammar.md §1.x Elements.
 */
export interface ContainerNode extends ElementBase {
  readonly kind: "container";
  readonly headerDescription?: StringLiteral;
  readonly headerTechnology?: StringLiteral;
}

/**
 * `component <name> [description] [technology] [tags] { ... }`. Has
 * technology slot. Body may contain `group` / `!docs` / `!decisions`
 * (no element children). See grammar.md §1.x Elements.
 */
export interface ComponentNode extends ElementBase {
  readonly kind: "component";
  readonly headerDescription?: StringLiteral;
  readonly headerTechnology?: StringLiteral;
}

/**
 * `group <name> { ... }`. Visual grouping; permitted inside model /
 * softwareSystem / container / component. The body holds the elements
 * being grouped — those elements inherit the `group` for downstream
 * filtering. See grammar.md §1.x Elements.
 */
export interface GroupNode extends RecoverableNode {
  readonly kind: "group";
  readonly assignedIdentifier?: Identifier;
  readonly name: StringLiteral;
  readonly members: readonly (ElementNode | RelationshipNode)[];
}

/**
 * `element <name> [metadata] [description] [tags]` — CustomElement.
 * The reference treats it as a 6th element kind with a tag set of
 * just `["Element"]` (no kind-specific second tag). We map it to a
 * Model Container with kind = "Container".
 *
 * The `[metadata]` positional slot has no Model field today and is
 * dropped by the visitor — reintroduce a `headerMetadata?` field
 * here when a rule or generator needs it.
 */
export interface CustomElementNode extends RecoverableNode {
  readonly kind: "element";
  readonly assignedIdentifier?: Identifier;
  readonly name: StringLiteral;
  readonly headerDescription?: StringLiteral;
  readonly headerTags?: StringLiteral;
  readonly body: readonly ElementBodyNode[];
}

// ── Element body statements ─────────────────────────────────────────────

/**
 * Per-element-kind nesting (softwareSystem may contain container; container
 * may contain component; person/component have no element children) is a
 * `toModel` concern, not a parser one — so this union accepts every
 * element kind. Misplaced elements surface as `ModelIssue` downstream.
 */
export type ElementBodyNode =
  // Metadata statements
  | DescriptionStatement
  | TechnologyStatement
  | TagsStatement
  | TagStatement
  | UrlStatement
  | PropertiesBlock
  | PerspectivesBlock
  // Nested elements (any kind — toModel enforces nesting rules)
  | ElementNode
  // Relationships within the element body (`-> other` implicit or
  // `<src> -> other` explicit forms)
  | RelationshipNode;

export interface DescriptionStatement extends AstNodeBase {
  readonly kind: "description";
  readonly value: StringLiteral;
}

/** Valid only in container / component bodies. */
export interface TechnologyStatement extends AstNodeBase {
  readonly kind: "technology";
  readonly value: StringLiteral;
}

/** `tags "<csv>"` — comma-separated list, appended to header tags. */
export interface TagsStatement extends AstNodeBase {
  readonly kind: "tags";
  readonly value: StringLiteral;
}

/** `tag "<single>"` — single tag, appended. */
export interface TagStatement extends AstNodeBase {
  readonly kind: "tag";
  readonly value: StringLiteral;
}

export interface UrlStatement extends AstNodeBase {
  readonly kind: "url";
  readonly value: StringLiteral;
}

// ── Relationships ───────────────────────────────────────────────────────

/**
 * `<identifier> -> <identifier> [description] [technology] [tags] { body? }`.
 * Source and destination are identifier references as written. Resolution
 * happens in `toModel`. See grammar.md §1.x Relationships.
 *
 * `assignedIdentifier` carries the optional `relId = src -> dst`
 * assignment form, used by deployment views and the no-relationship
 * (`-/>`) suppression mechanism.
 */
export interface RelationshipNode extends RecoverableNode {
  readonly kind: "relationship";
  readonly assignedIdentifier?: Identifier;
  /** The arrow token used. `->` is explicit; `-/>` is no-relationship. */
  readonly arrow: "->" | "-/>";
  /** Undefined when the relationship uses the implicit-source form. */
  readonly source?: IdentifierRef;
  readonly destination: IdentifierRef;
  readonly headerDescription?: StringLiteral;
  readonly headerTechnology?: StringLiteral;
  readonly headerTags?: StringLiteral;
  readonly body: readonly RelationshipBodyNode[];
}

/**
 * Body statements permitted inside a relationship `{ ... }`. Per
 * `RelationshipDslContext.getPermittedTokens()` in the reference:
 * tags, url, properties, perspectives — and **no** description /
 * technology / interactionStyle. See grammar.md §1.x Relationships.
 */
export type RelationshipBodyNode =
  | TagsStatement
  | TagStatement
  | UrlStatement
  | PropertiesBlock
  | PerspectivesBlock;

// ── Properties and perspectives ─────────────────────────────────────────

/**
 * `properties { <key> <value> [<key> <value> ...] }`. Values may be
 * unquoted bare tokens; quoting is required only when the value
 * contains whitespace. See grammar.md §1.4.
 */
export interface PropertiesBlock extends AstNodeBase {
  readonly kind: "properties";
  readonly entries: readonly PropertyEntry[];
}

export interface PropertyEntry extends AstNodeBase {
  readonly kind: "propertyEntry";
  readonly key: StringLiteral;
  readonly value: StringLiteral;
}

/**
 * `perspectives { <name> <description> [value] ... }` — exactly 2 or 3
 * tokens per line. Maps to `Container.properties["perspective.<name>"]`
 * during toModel. See grammar.md §1.4.
 */
export interface PerspectivesBlock extends AstNodeBase {
  readonly kind: "perspectives";
  readonly entries: readonly PerspectiveEntry[];
}

export interface PerspectiveEntry extends AstNodeBase {
  readonly kind: "perspectiveEntry";
  readonly name: Identifier;
  readonly description: StringLiteral;
  readonly value?: StringLiteral;
}

// ── Top-level directives ────────────────────────────────────────────────

export type DirectiveNode =
  | IncludeDirective
  | ConstDirective
  | VarDirective
  | IdentifiersDirective
  | ImpliedRelationshipsDirective;

/** `!include <file|directory|url>`. See grammar.md §1.2. */
export interface IncludeDirective extends AstNodeBase {
  readonly kind: "include";
  readonly target: StringLiteral;
}

/**
 * `!const <name> <value>`. `<name>` must match the reference's
 * `NameValueParser.NAME_REGEX = [a-zA-Z0-9-_.]+`. Valid at workspace
 * / model scope only.
 */
export interface ConstDirective extends AstNodeBase {
  readonly kind: "const";
  readonly name: StringLiteral;
  readonly value: StringLiteral;
}

/** `!var <name> <value>`. Same shape as `!const` but reassignable. */
export interface VarDirective extends AstNodeBase {
  readonly kind: "var";
  readonly name: StringLiteral;
  readonly value: StringLiteral;
}

/**
 * `!identifiers <flat|hierarchical>`. Valid at workspace / model scope
 * only — must appear before any element is declared.
 */
export interface IdentifiersDirective extends AstNodeBase {
  readonly kind: "identifiers";
  readonly scope: "flat" | "hierarchical";
}

/**
 * `!impliedRelationships <true|false|fqcn>` (also accepted bare as
 * `impliedRelationships`). The reference applies the strategy at
 * parse time; aact captures the directive on the AST and applies it
 * during `toModel`. Semantic effect on the resulting Model is
 * identical.
 */
export interface ImpliedRelationshipsDirective extends AstNodeBase {
  readonly kind: "impliedRelationships";
  readonly value: StringLiteral;
}

// ── Leaves ──────────────────────────────────────────────────────────────

/**
 * A string literal in source. Double-quoted by Structurizr DSL
 * convention; `!const` / `!var` value slots additionally accept
 * `"""text blocks"""`, which the visitor unwraps into the same
 * `StringLiteral` shape. Element headers, body statements, and
 * relationship slots only accept the regular `"..."` form. `value`
 * holds the unescaped string; `range` spans the opening to closing
 * quote inclusive.
 */
export interface StringLiteral extends AstNodeBase {
  readonly kind: "string";
  readonly value: string;
}

/**
 * A bare identifier — declared name on the LHS of `=`, perspective
 * name, etc. Reference DSL forbids `.` inside an identifier
 * (`IdentifiersRegister.IDENTIFIER_PATTERN = \w[a-zA-Z0-9_-]*`), but
 * our lexer (`tokens.ts:Identifier`) deliberately widens the pattern
 * to `\w[a-zA-Z0-9_./-]*` so hierarchical references (`bank.api.controller`)
 * and bare paths (`path/to/file.dsl`) tokenise as a single token —
 * context downstream disambiguates. `name` is therefore the raw image
 * and MAY contain `.` or `/`.
 */
export interface Identifier extends AstNodeBase {
  readonly kind: "identifier";
  readonly name: string;
}

/**
 * Reference to a previously-declared identifier (relationship
 * endpoints, `instanceOf` targets, etc.). Distinguished from
 * `Identifier` so `toModel` can attribute "undefined identifier"
 * diagnostics back to the reference site rather than the
 * declaration site. The `this` keyword (refers to the enclosing
 * element inside its body) is represented here with `name: "this"`
 * and `isThis: true`.
 */
export interface IdentifierRef extends AstNodeBase {
  readonly kind: "identifierRef";
  readonly name: string;
  readonly isThis?: true;
}
