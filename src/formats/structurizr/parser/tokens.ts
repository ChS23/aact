/**
 * Structurizr DSL lexical tokens — chevrotain `createToken` definitions.
 *
 * Grounded in `.parser-refs/java/structurizr-dsl/src/main/java/com/structurizr/dsl/StructurizrDslTokens.java`
 * (token strings) and `StructurizrDslParser.java:30-49` (lexical patterns).
 *
 * Token ordering matters in chevrotain — longer/more-specific patterns
 * must come BEFORE shorter/more-general ones. Keywords are matched via
 * `longer_alt: Identifier` so that bare identifiers like `personnel`
 * don't greedily match the `person` keyword prefix.
 */

import { createToken, Lexer } from "chevrotain";

// ── Whitespace and comments ────────────────────────────────────────────

/** Skipped. Newlines are NOT skipped — they're significant for the
 * line-based reference dispatch and we preserve that semantics. */
export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
});

/** `\r?\n` — physical newline. Logical-line joining via `\` continuation
 * is a pre-lex pass; by the time the lexer sees the source, lines are
 * already concatenated where needed. */
export const Newline = createToken({
  name: "Newline",
  pattern: /\r?\n/,
  group: Lexer.SKIPPED,
});

export const LineComment = createToken({
  name: "LineComment",
  pattern: /(?:\/\/|#)[^\r\n]*/,
  group: Lexer.SKIPPED,
});

/** Block comments are line-scoped in the reference — `/*` must open at
 * the start of a line and `*\/` must close at end of line. For lex
 * purposes we accept the more permissive multi-line form; if real-world
 * sources rely on the line-scoped quirk, we tighten later. */
export const BlockComment = createToken({
  name: "BlockComment",
  pattern: /\/\*[\s\S]*?\*\//,
  group: Lexer.SKIPPED,
});

// ── Literals ───────────────────────────────────────────────────────────

/** `"..."` — double-quoted string with backslash escapes. */
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:[^"\\]|\\.)*"/,
});

/** `"""..."""` — Structurizr DSL text block. Greedily multi-line. The
 * pattern goes BEFORE `StringLiteral` so triple-quote opens are not
 * misread as empty string + content + empty string. */
export const TextBlock = createToken({
  name: "TextBlock",
  pattern: /"""[\s\S]*?"""/,
});

/** Bare URL token used by official DSL forms such as
 * `url https://example.com`. Kept narrower than "any bare value" so
 * identifiers and include paths stay context-specific. */
export const UrlLiteral = createToken({
  name: "UrlLiteral",
  pattern: /[a-zA-Z][a-zA-Z0-9+.-]{0,32}:\/\/[^\s{}"]+/,
});

// ── Operators and punctuation ──────────────────────────────────────────

export const NoRelationship = createToken({
  name: "NoRelationship",
  pattern: /-\/>/,
});

export const Relationship = createToken({
  name: "Relationship",
  pattern: /->/,
});

export const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
export const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
export const Equals = createToken({ name: "Equals", pattern: /=/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
/**
 * Standalone `/` token. Used as a property value (`structurizr.
 * groupSeparator /`) — the reference whitespace tokeniser accepts any
 * non-empty token in that slot. We surface it as a dedicated token so
 * the parser can OR over it where bare punctuation is expected. */
export const Slash = createToken({ name: "Slash", pattern: /\// });

// ── Identifier (referenced by keyword `longer_alt`) ────────────────────

/**
 * Identifier per `IdentifiersRegister.IDENTIFIER_PATTERN`:
 * `\w[a-zA-Z0-9_-]*`. The reference forbids period and slash inside
 * a single identifier — both come up downstream (period as the
 * hierarchical-reference separator, slash inside `!include` and
 * `extends` path arguments).
 *
 * We widen the lexical pattern to accept both forms as one token:
 *   - `bank.api.controller` — hierarchical reference, split on `.` in toModel
 *   - `path/to/file.dsl` — bare relative path argument to `!include`/`extends`
 * The grammar then accepts the same `Identifier` token in identifier
 * slots and in path slots; downstream code disambiguates by context.
 */
export const Identifier = createToken({
  name: "Identifier",
  pattern: /\w[a-zA-Z0-9_./-]*/,
});

// ── Directives (start with `!`) ────────────────────────────────────────

/** Helper to declare a `!keyword` directive that out-prioritises a
 * generic `Bang` catch-all and falls back to it for unknown bang
 * tokens (see BangDirective below). */
const directive = (name: string, pattern: RegExp) =>
  createToken({ name, pattern, longer_alt: undefined });

export const BangInclude = directive("BangInclude", /!include\b/);
export const BangIncludeUrl = directive("BangIncludeUrl", /!includeurl\b/);
export const BangConst = directive("BangConst", /!const\b/);
export const BangVar = directive("BangVar", /!var\b/);
export const BangConstantHardError = directive(
  "BangConstantHardError",
  /!constant\b/,
);
export const BangIdentifiers = directive("BangIdentifiers", /!identifiers\b/);
export const BangImpliedRelationships = directive(
  "BangImpliedRelationships",
  /!impliedRelationships\b/,
);
export const BangDocs = directive("BangDocs", /!docs\b/);
export const BangDecisions = directive("BangDecisions", /!decisions\b/);
export const BangPlugin = directive("BangPlugin", /!plugin\b/);
export const BangScript = directive("BangScript", /!script\b/);
export const BangAdrs = directive("BangAdrs", /!adrs\b/);
export const BangComponents = directive("BangComponents", /!components\b/);
export const BangRefHardError = directive("BangRefHardError", /!ref\b/);
export const BangExtendHardError = directive(
  "BangExtendHardError",
  /!extend\b/,
);
export const BangElementSelector = directive(
  "BangElementSelector",
  /!element\b/,
);
export const BangElementsSelector = directive(
  "BangElementsSelector",
  /!elements\b/,
);
export const BangRelationshipSelector = directive(
  "BangRelationshipSelector",
  /!relationship\b/,
);
export const BangRelationshipsSelector = directive(
  "BangRelationshipsSelector",
  /!relationships\b/,
);

// ── Keywords ───────────────────────────────────────────────────────────

/** Helper: keyword tokens delegate to Identifier for the longer-alt
 * rule, so identifiers starting with a keyword (`workspaceName`) parse
 * as identifiers rather than `workspace` + `Name`.
 *
 * Match is case-sensitive in the lexer. The reference parser's
 * whitespace-only tokeniser does case-insensitive dispatch later in
 * the pipeline; we approximate by lowercasing keys before storing /
 * looking up identifiers in toModel, which handles the realistic
 * cases (`softwareSystem` vs `softwaresystem` references). A
 * case-insensitive lexer pattern is rejected because it would match
 * idiomatic uppercase constants (`NAME`, `FOO`) as the `name`/`foo`
 * keywords. */
const keyword = (name: string, lexeme: string) =>
  createToken({
    name,
    pattern: new RegExp(String.raw`${lexeme}\b`),
    longer_alt: Identifier,
  });

// Workspace / model structure
export const Workspace = keyword("Workspace", "workspace");
export const Extends = keyword("Extends", "extends");
export const Model = keyword("Model", "model");
export const Archetypes = keyword("Archetypes", "archetypes");

// Elements
export const Person = keyword("Person", "person");
export const SoftwareSystem = keyword("SoftwareSystem", "softwareSystem");
export const Container = keyword("Container", "container");
export const Component = keyword("Component", "component");
export const Group = keyword("Group", "group");
/** `element` (CustomElement). Reference `CustomElementParser` accepts
 * `element <name> [metadata] [description] [tags]`. */
export const Element = keyword("Element", "element");

// Element body statements
export const Name = keyword("Name", "name");
export const Description = keyword("Description", "description");
export const Technology = keyword("Technology", "technology");
export const Tags = keyword("Tags", "tags");
export const Tag = keyword("Tag", "tag");
export const Url = keyword("Url", "url");
export const Properties = keyword("Properties", "properties");
export const Perspectives = keyword("Perspectives", "perspectives");
export const Metadata = keyword("Metadata", "metadata");
export const This = keyword("This", "this");

// Deployment (parsed-then-info-issue)
export const DeploymentEnvironment = keyword(
  "DeploymentEnvironment",
  "deploymentEnvironment",
);
export const DeploymentNode = keyword("DeploymentNode", "deploymentNode");
export const DeploymentGroup = keyword("DeploymentGroup", "deploymentGroup");
export const InfrastructureNode = keyword(
  "InfrastructureNode",
  "infrastructureNode",
);
export const SoftwareSystemInstance = keyword(
  "SoftwareSystemInstance",
  "softwareSystemInstance",
);
export const ContainerInstance = keyword(
  "ContainerInstance",
  "containerInstance",
);
export const InstanceOf = keyword("InstanceOf", "instanceOf");
export const HealthCheck = keyword("HealthCheck", "healthCheck");

// Opaque blocks (round-trip via LoadResult.raw)
export const Views = keyword("Views", "views");
export const Styles = keyword("Styles", "styles");
export const Configuration = keyword("Configuration", "configuration");
export const Branding = keyword("Branding", "branding");
export const Terminology = keyword("Terminology", "terminology");
export const Themes = keyword("Themes", "themes");
export const Theme = keyword("Theme", "theme");

// Hard-removed (reference throws; we match to keep aligned)
export const EnterpriseHardError = keyword("EnterpriseHardError", "enterprise");

/** Bare `impliedRelationships <value>` form — `!impliedRelationships`
 *  is the `BangImpliedRelationships` directive token above. The
 *  reference dispatch (`StructurizrDslParser.java`) accepts both
 *  spellings via `equalsIgnoreCase` against `!impliedRelationships`
 *  and its bang-stripped variant. */
export const ImpliedRelationships = keyword(
  "ImpliedRelationships",
  "impliedRelationships",
);

// ── Token order matters — longest-match-first ─────────────────────────

/**
 * The order chevrotain tries tokens. Higher in the list = tried first.
 * Rules of thumb:
 *  - skipped trivia first (cheap to discard)
 *  - text block `"""` before `StringLiteral` (longer prefix)
 *  - multi-char operators (`-/>`, `->`) before single chars
 *  - `!keyword` directives before generic `Identifier`
 *  - keywords before Identifier (delegated via `longer_alt`)
 *  - Identifier last among text-like tokens
 */
export const allTokens = [
  // Whitespace / comments (skipped)
  WhiteSpace,
  Newline,
  LineComment,
  BlockComment,

  // Literals
  TextBlock,
  StringLiteral,
  UrlLiteral,

  // Operators / punctuation
  NoRelationship,
  Relationship,
  LBrace,
  RBrace,
  Equals,
  Comma,
  // Slash must come AFTER NoRelationship/Relationship/etc so they win
  // when they appear; standalone `/` only matches when no longer
  // operator does. Slash also competes with Identifier (which now
  // accepts `/` mid-token); `/` at the START of a token does not
  // match Identifier (Identifier requires a leading `\w`), so the
  // standalone slash falls through to here.
  Slash,

  // !directives
  BangIncludeUrl, // before BangInclude (longer prefix)
  BangInclude,
  BangConstantHardError, // before BangConst (longer prefix)
  BangConst,
  BangVar,
  BangIdentifiers,
  BangImpliedRelationships,
  BangDocs,
  BangDecisions,
  BangPlugin,
  BangScript,
  BangAdrs,
  BangComponents,
  BangRefHardError,
  BangExtendHardError,
  BangElementsSelector, // before BangElementSelector
  BangElementSelector,
  BangRelationshipsSelector, // before BangRelationshipSelector
  BangRelationshipSelector,

  // Keywords (each defers to Identifier via longer_alt)
  Workspace,
  Extends,
  Model,
  Archetypes,
  Person,
  SoftwareSystem,
  Container,
  Component,
  Group,
  Element,
  Name,
  Description,
  Technology,
  Tags,
  Tag,
  Url,
  Properties,
  Perspectives,
  Metadata,
  This,
  DeploymentEnvironment,
  DeploymentNode,
  DeploymentGroup,
  InfrastructureNode,
  SoftwareSystemInstance,
  ContainerInstance,
  InstanceOf,
  HealthCheck,
  Views,
  Styles,
  Configuration,
  Branding,
  Terminology,
  Themes,
  Theme,
  EnterpriseHardError,
  ImpliedRelationships,

  // Identifier last among text tokens
  Identifier,
];

/** The chevrotain Lexer instance. Re-used across parse calls. */
export const StructurizrLexer = new Lexer(allTokens, {
  // Position tracking is mandatory for our SourceLocation contract.
  positionTracking: "full",
});
