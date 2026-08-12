/**
 * C4-PlantUML lexical tokens — chevrotain `createToken` definitions.
 *
 * Grounded in the stdlib macros at `.parser-refs/C4-PlantUML/*.puml`.
 * Only C4-specific macros are recognised as named tokens; everything
 * else (skinparam, title, note, generic PlantUML productions) is
 * tokenized as Identifier / StringLiteral / opaque punctuation so the
 * grammar can route it to opaque-skip without lex failures.
 *
 * Token ordering matters in chevrotain — longer / more-specific
 * patterns precede shorter ones, and keywords delegate to `Identifier`
 * via `longer_alt` so `ContainerXYZ` parses as an identifier rather
 * than `Container` + `XYZ`.
 */

import { createToken, Lexer } from "chevrotain";

// ── Whitespace and comments ────────────────────────────────────────────

/** Skipped horizontal whitespace. */
export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
});

/** Skipped newlines. PUML is line-oriented but our grammar relies on
 *  the ()-and-{} structure of macro calls, so newlines need no
 *  preservation — every statement is one macro invocation. */
export const Newline = createToken({
  name: "Newline",
  pattern: /\r?\n/,
  group: Lexer.SKIPPED,
});

/** PUML block comment `/' ... '/`. */
export const BlockComment = createToken({
  name: "BlockComment",
  pattern: /\/'[\s\S]*?'\//,
  group: Lexer.SKIPPED,
});

// ── Literals ───────────────────────────────────────────────────────────

/** `"..."` — double-quoted string with backslash escapes. */
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:[^"\\]|\\.)*"/,
});

/** `'...'` — accepted by PlantUML/C4 examples for labels. */
export const SingleStringLiteral = createToken({
  name: "SingleStringLiteral",
  pattern: /'(?:[^'\\\r\n]|\\.)*'/,
});

/** PUML line comment — starts with a single quote `'` and runs to end
 *  of line. Distinct from PUML's block `/' ... '/` form above. */
export const LineComment = createToken({
  name: "LineComment",
  pattern: /'[^\r\n]*/,
  group: Lexer.SKIPPED,
});

/**
 * Bare integer — `$index=2`, `Lay_Distance(a, b, 5)`. We DON'T accept
 * floats because the stdlib macros only consume integers for the args
 * we care about (`$index`, `$distance`). A float here would surprise
 * the user more than help them.
 */
export const IntegerLiteral = createToken({
  name: "IntegerLiteral",
  pattern: /-?\d+/,
});

// ── Punctuation ────────────────────────────────────────────────────────

export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
export const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
export const Equals = createToken({ name: "Equals", pattern: /=/ });

// ── Identifier + named-arg key ─────────────────────────────────────────

/**
 * PUML aliases are word characters; stdlib macros use camelCase /
 * `snake_case` for the alias slot. Leading char must be a letter or
 * underscore; digits and underscores allowed after.
 */
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-zA-Z_]\w*/,
});

/**
 * Named-arg key — `$tags`, `$link`, `$sprite`, `$index`, `$rel`,
 * `$type`, `$descr`, `$techn`, etc. The leading `$` distinguishes
 * them from bare identifiers. See `C4_Container.puml` signature.
 */
export const NamedArgKey = createToken({
  name: "NamedArgKey",
  pattern: /\$[a-zA-Z_]\w*/,
});

// ── Macro keywords ─────────────────────────────────────────────────────

/** Helper: keyword token that defers to Identifier on the longer-alt
 *  rule, so names that contain a macro keyword as a prefix
 *  (`ContainerXYZ`) tokenize as Identifier, not `Container` + `XYZ`. */
const keyword = (name: string, lexeme: string) =>
  createToken({
    name,
    pattern: new RegExp(String.raw`${lexeme}\b`),
    longer_alt: Identifier,
  });

// @startuml / @enduml
export const StartUml = createToken({
  name: "StartUml",
  pattern: /@startuml[^\r\n]*/,
});
export const EndUml = createToken({
  name: "EndUml",
  pattern: /@enduml\b/,
});

// Element macros — Context level (C4_Context.puml)
export const Person = keyword("Person", "Person");
export const PersonExt = keyword("PersonExt", "Person_Ext");
export const System = keyword("System", "System");
export const SystemExt = keyword("SystemExt", "System_Ext");
export const SystemDb = keyword("SystemDb", "SystemDb");
export const SystemDbExt = keyword("SystemDbExt", "SystemDb_Ext");
export const SystemQueue = keyword("SystemQueue", "SystemQueue");
export const SystemQueueExt = keyword("SystemQueueExt", "SystemQueue_Ext");

// Element macros — Container level (C4_Container.puml)
export const Container = keyword("Container", "Container");
export const ContainerExt = keyword("ContainerExt", "Container_Ext");
export const ContainerDb = keyword("ContainerDb", "ContainerDb");
export const ContainerDbExt = keyword("ContainerDbExt", "ContainerDb_Ext");
export const ContainerQueue = keyword("ContainerQueue", "ContainerQueue");
export const ContainerQueueExt = keyword(
  "ContainerQueueExt",
  "ContainerQueue_Ext",
);

// Element macros — Component level (C4_Component.puml)
export const Component = keyword("Component", "Component");
export const ComponentExt = keyword("ComponentExt", "Component_Ext");
export const ComponentDb = keyword("ComponentDb", "ComponentDb");
export const ComponentDbExt = keyword("ComponentDbExt", "ComponentDb_Ext");
export const ComponentQueue = keyword("ComponentQueue", "ComponentQueue");
export const ComponentQueueExt = keyword(
  "ComponentQueueExt",
  "ComponentQueue_Ext",
);

// Boundary macros — C4_Context / C4_Container / C4.puml
// Note: `Component_Boundary` does NOT exist in stdlib (verified —
// see grammar.md §135–141 + the prior fix in commit db69912).
export const SystemBoundary = keyword("SystemBoundary", "System_Boundary");
export const ContainerBoundary = keyword(
  "ContainerBoundary",
  "Container_Boundary",
);
export const EnterpriseBoundary = keyword(
  "EnterpriseBoundary",
  "Enterprise_Boundary",
);
/** Plain `Boundary(alias, label, $type=..., ...)` — generic boundary
 *  whose kind is signalled via `$type` arg or a tag postfix. */
export const Boundary = keyword("Boundary", "Boundary");

// Relationship macros — base + directional + back-arrow variants.
// `relKeyword` is an alias for `keyword` kept for readability so the
// long block below telegraphs "these are Rel-family tokens".
const relKeyword = keyword;

// Base Rel
export const Rel = relKeyword("Rel", "Rel");
// Directional shorthand
export const RelDown = relKeyword("RelDown", "Rel_D");
export const RelUp = relKeyword("RelUp", "Rel_U");
export const RelLeft = relKeyword("RelLeft", "Rel_L");
export const RelRight = relKeyword("RelRight", "Rel_R");
// Long-form directional aliases
export const RelDownLong = relKeyword("RelDownLong", "Rel_Down");
export const RelUpLong = relKeyword("RelUpLong", "Rel_Up");
export const RelLeftLong = relKeyword("RelLeftLong", "Rel_Left");
export const RelRightLong = relKeyword("RelRightLong", "Rel_Right");
// Back-arrow (semantically Rel(to, from))
export const RelBack = relKeyword("RelBack", "Rel_Back");
export const RelBackDown = relKeyword("RelBackDown", "Rel_Back_D");
export const RelBackUp = relKeyword("RelBackUp", "Rel_Back_U");
export const RelBackLeft = relKeyword("RelBackLeft", "Rel_Back_L");
export const RelBackRight = relKeyword("RelBackRight", "Rel_Back_R");
// Neighbor layout-hint variants — preserve `Rel`/`Rel_Back` semantics
// (one Relation entry, optional source/dest swap).
export const RelNeighbor = relKeyword("RelNeighbor", "Rel_Neighbor");
export const RelBackNeighbor = relKeyword(
  "RelBackNeighbor",
  "Rel_Back_Neighbor",
);
// Bidirectional
export const BiRel = relKeyword("BiRel", "BiRel");
export const BiRelDown = relKeyword("BiRelDown", "BiRel_D");
export const BiRelUp = relKeyword("BiRelUp", "BiRel_U");
export const BiRelLeft = relKeyword("BiRelLeft", "BiRel_L");
export const BiRelRight = relKeyword("BiRelRight", "BiRel_R");
export const BiRelNeighbor = relKeyword("BiRelNeighbor", "BiRel_Neighbor");
// Long-form BiRel directional aliases
export const BiRelDownLong = relKeyword("BiRelDownLong", "BiRel_Down");
export const BiRelUpLong = relKeyword("BiRelUpLong", "BiRel_Up");
export const BiRelLeftLong = relKeyword("BiRelLeftLong", "BiRel_Left");
export const BiRelRightLong = relKeyword("BiRelRightLong", "BiRel_Right");
// Indexed (Dynamic diagram step ordering)
export const RelIndex = relKeyword("RelIndex", "RelIndex");
export const RelIndexBack = relKeyword("RelIndexBack", "RelIndex_Back");
export const RelIndexNeighbor = relKeyword(
  "RelIndexNeighbor",
  "RelIndex_Neighbor",
);
export const RelIndexBackNeighbor = relKeyword(
  "RelIndexBackNeighbor",
  "RelIndex_Back_Neighbor",
);
export const RelIndexDown = relKeyword("RelIndexDown", "RelIndex_D");
export const RelIndexUp = relKeyword("RelIndexUp", "RelIndex_U");
export const RelIndexLeft = relKeyword("RelIndexLeft", "RelIndex_L");
export const RelIndexRight = relKeyword("RelIndexRight", "RelIndex_R");
export const RelIndexDownLong = relKeyword("RelIndexDownLong", "RelIndex_Down");
export const RelIndexUpLong = relKeyword("RelIndexUpLong", "RelIndex_Up");
export const RelIndexLeftLong = relKeyword("RelIndexLeftLong", "RelIndex_Left");
export const RelIndexRightLong = relKeyword(
  "RelIndexRightLong",
  "RelIndex_Right",
);

// Layout hint macros — `Lay_<dir>(from, to)` makes a layout
// constraint without producing a visible edge.
export const LayDown = relKeyword("LayDown", "Lay_D");
export const LayUp = relKeyword("LayUp", "Lay_U");
export const LayLeft = relKeyword("LayLeft", "Lay_L");
export const LayRight = relKeyword("LayRight", "Lay_R");
export const LayDownLong = relKeyword("LayDownLong", "Lay_Down");
export const LayUpLong = relKeyword("LayUpLong", "Lay_Up");
export const LayLeftLong = relKeyword("LayLeftLong", "Lay_Left");
export const LayRightLong = relKeyword("LayRightLong", "Lay_Right");
export const LayDistance = relKeyword("LayDistance", "Lay_Distance");

// Preprocessor — `!include`, `!define`, etc. Each `!keyword` is a
// distinct token so the parser routes to the correct handling.
const directive = (name: string, pattern: RegExp) =>
  createToken({ name, pattern });

export const BangInclude = directive("BangInclude", /!include\b/);
export const BangIncludeUrl = directive("BangIncludeUrl", /!includeurl\b/);
export const BangDefine = directive("BangDefine", /!define\b/);
export const BangDefineLong = directive("BangDefineLong", /!definelong\b/);
export const BangProcedure = directive("BangProcedure", /!procedure\b/);
export const BangFunction = directive("BangFunction", /!function\b/);
export const BangEndProcedure = directive(
  "BangEndProcedure",
  /!endprocedure\b/,
);
export const BangEndFunction = directive("BangEndFunction", /!endfunction\b/);
export const BangReturn = directive("BangReturn", /!return\b/);
export const BangIf = directive("BangIf", /!if\b/);
export const BangElse = directive("BangElse", /!else\b/);
export const BangElseIf = directive("BangElseIf", /!elseif\b/);
export const BangEndIf = directive("BangEndIf", /!endif\b/);
export const BangIfNDef = directive("BangIfNDef", /!ifndef\b/);
export const BangIfDef = directive("BangIfDef", /!ifdef\b/);

// ── Token order matters — longest-match-first ─────────────────────────

/**
 * Order chevrotain tries tokens. Higher in the list = tried first.
 *
 * Notable orderings:
 *  - `_Ext` / `Db` / `Queue` suffix variants BEFORE their bases
 *    (`ContainerExt` before `Container`) so the longer match wins.
 *  - Same for `_Down/_Up/_Left/_Right/_Back` variants of `Rel`.
 *  - `RelIndex_D` before `Rel_D` — `Rel_Index_D` spelling too.
 *  - `BiRel_Neighbor` before `BiRel`.
 *  - Bang directives before any generic `Identifier`.
 */
export const allTokens = [
  // Whitespace / comments (skipped)
  WhiteSpace,
  Newline,
  BlockComment,

  // Literals
  SingleStringLiteral,
  LineComment,
  StringLiteral,
  IntegerLiteral,

  // Punctuation
  LParen,
  RParen,
  Comma,
  LBrace,
  RBrace,
  Equals,

  // @startuml / @enduml
  StartUml,
  EndUml,

  // !directives (before Identifier so they win)
  BangIncludeUrl, // before BangInclude
  BangInclude,
  BangDefineLong, // before BangDefine
  BangDefine,
  BangProcedure,
  BangFunction,
  BangEndProcedure,
  BangEndFunction,
  BangReturn,
  BangElseIf, // before BangElse
  BangElse,
  BangEndIf,
  BangIfNDef, // before BangIfDef
  BangIfDef,
  BangIf,

  // Element macros — _Ext / Db / Queue variants BEFORE bases
  PersonExt,
  Person,
  SystemDbExt,
  SystemDb,
  SystemQueueExt,
  SystemQueue,
  SystemExt,
  System,
  ContainerDbExt,
  ContainerDb,
  ContainerQueueExt,
  ContainerQueue,
  ContainerExt,
  Container,
  ComponentDbExt,
  ComponentDb,
  ComponentQueueExt,
  ComponentQueue,
  ComponentExt,
  Component,

  // Boundary macros
  SystemBoundary,
  ContainerBoundary,
  EnterpriseBoundary,
  Boundary,

  // Relationship macros — long-form / suffixed BEFORE bases.
  // `_Back_Neighbor` must precede `_Back_*` and `_Back` so the longest
  // match wins; same for `_Neighbor` before any plain direction.
  RelBackNeighbor,
  RelBackDown,
  RelBackUp,
  RelBackLeft,
  RelBackRight,
  RelBack,
  RelNeighbor,
  RelDownLong,
  RelUpLong,
  RelLeftLong,
  RelRightLong,
  RelDown,
  RelUp,
  RelLeft,
  RelRight,

  BiRelNeighbor,
  BiRelDownLong,
  BiRelUpLong,
  BiRelLeftLong,
  BiRelRightLong,
  BiRelDown,
  BiRelUp,
  BiRelLeft,
  BiRelRight,
  BiRel,

  // RelIndex family — longest first
  RelIndexBackNeighbor,
  RelIndexBack,
  RelIndexNeighbor,
  RelIndexDownLong,
  RelIndexUpLong,
  RelIndexLeftLong,
  RelIndexRightLong,
  RelIndexDown,
  RelIndexUp,
  RelIndexLeft,
  RelIndexRight,
  RelIndex,

  Rel,

  // Layout macros
  LayDistance,
  LayDownLong,
  LayUpLong,
  LayLeftLong,
  LayRightLong,
  LayDown,
  LayUp,
  LayLeft,
  LayRight,

  // Named-arg keys before Identifier (they start with `$` so there is
  // no ambiguity at the regex level, but keeping a fixed order makes
  // the priority explicit).
  NamedArgKey,

  // Identifier last among text tokens
  Identifier,
];

/** The chevrotain Lexer instance. Re-used across parse calls. */
export const C4PumlLexer = new Lexer(allTokens, {
  // Position tracking is mandatory for SourceLocation contract.
  positionTracking: "full",
});
