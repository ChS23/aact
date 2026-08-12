/**
 * C4-PlantUML parser (chevrotain `CstParser`).
 *
 * Mirrors the shape of the Structurizr parser one rule at a time:
 *   pumlFile → diagram* → statement* → macroCall | boundaryCall
 *
 * The grammar deliberately models the **C4 macro call layer** only —
 * everything else (raw PlantUML, opaque macros, `!directive` lines)
 * is stripped or normalised in a pre-parse pass and never reaches the
 * parser. See `preParse.ts` for that layer.
 *
 * Adding a new C4 macro:
 *   1. Add a token in `tokens.ts` (don't forget the longer_alt order).
 *   2. Add an ALT in `statement` / `boundaryCall`.
 *   3. Lower it in `visitor.ts` → AST node from `ast.ts`.
 *   4. Map the AST → Model in `toModel.ts`.
 *
 * Recovery: chevrotain in-built error recovery is enabled. The
 * visitor checks each CST node for `recoveredNode === true` and
 * marks the resulting AST node `recovered: true` so toModel can
 * surface a parse-issue without bringing the whole file down.
 */

import { CstParser } from "chevrotain";

import {
  allTokens,
  BiRel,
  BiRelDown,
  BiRelDownLong,
  BiRelLeft,
  BiRelLeftLong,
  BiRelNeighbor,
  BiRelRight,
  BiRelRightLong,
  BiRelUp,
  BiRelUpLong,
  Boundary,
  Comma,
  Component,
  ComponentDb,
  ComponentDbExt,
  ComponentExt,
  ComponentQueue,
  ComponentQueueExt,
  Container,
  ContainerBoundary,
  ContainerDb,
  ContainerDbExt,
  ContainerExt,
  ContainerQueue,
  ContainerQueueExt,
  EndUml,
  EnterpriseBoundary,
  Equals,
  Identifier,
  IntegerLiteral,
  LayDistance,
  LayDown,
  LayDownLong,
  LayLeft,
  LayLeftLong,
  LayRight,
  LayRightLong,
  LayUp,
  LayUpLong,
  LBrace,
  LParen,
  NamedArgKey,
  Person,
  PersonExt,
  RBrace,
  Rel,
  RelBack,
  RelBackDown,
  RelBackLeft,
  RelBackNeighbor,
  RelBackRight,
  RelBackUp,
  RelDown,
  RelDownLong,
  RelIndex,
  RelIndexBack,
  RelIndexBackNeighbor,
  RelIndexDown,
  RelIndexDownLong,
  RelIndexLeft,
  RelIndexLeftLong,
  RelIndexNeighbor,
  RelIndexRight,
  RelIndexRightLong,
  RelIndexUp,
  RelIndexUpLong,
  RelLeft,
  RelLeftLong,
  RelNeighbor,
  RelRight,
  RelRightLong,
  RelUp,
  RelUpLong,
  RParen,
  SingleStringLiteral,
  StartUml,
  StringLiteral,
  System,
  SystemBoundary,
  SystemDb,
  SystemDbExt,
  SystemExt,
  SystemQueue,
  SystemQueueExt,
} from "./tokens";

class C4PumlParser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: true,
      maxLookahead: 4,
    });
    this.performSelfAnalysis();
  }

  // ── Entry point ────────────────────────────────────────────────────

  public pumlFile = this.RULE("pumlFile", () => {
    this.MANY(() => this.SUBRULE(this.diagram));
  });

  // ── @startuml [name] ... @enduml ──────────────────────────────────

  private diagram = this.RULE("diagram", () => {
    this.CONSUME(StartUml);
    this.OPTION(() => this.SUBRULE(this.diagramName));
    this.MANY(() => this.SUBRULE(this.statement));
    this.CONSUME(EndUml);
  });

  /** Token slot after `@startuml`. Three forms per grammar.md §6:
   *  bare identifier, quoted string, or path-like (we capture
   *  whichever form chevrotain sees here). */
  private diagramName = this.RULE("diagramName", () => {
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(StringLiteral) },
    ]);
  });

  // ── Statement ─────────────────────────────────────────────────────

  /**
   * One C4 macro invocation. Boundary macros open a `{ ... }` block;
   * everything else is `<keyword>( args )`. Layout macros use the
   * same `( args )` shape as relations — we disambiguate in the
   * visitor by the keyword.
   */
  private statement = this.RULE("statement", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.boundaryCall) },
      { ALT: () => this.SUBRULE(this.elementCall) },
      { ALT: () => this.SUBRULE(this.relationCall) },
      { ALT: () => this.SUBRULE(this.layoutCall) },
    ]);
  });

  // ── Element macros ────────────────────────────────────────────────

  private elementCall = this.RULE("elementCall", () => {
    this.SUBRULE(this.elementKeyword);
    this.CONSUME(LParen);
    this.SUBRULE(this.argList);
    this.CONSUME(RParen);
  });

  private elementKeyword = this.RULE("elementKeyword", () => {
    this.OR([
      // Container family (typically most frequent in C4 files)
      { ALT: () => this.CONSUME(Container) },
      { ALT: () => this.CONSUME(ContainerDb) },
      { ALT: () => this.CONSUME(ContainerQueue) },
      { ALT: () => this.CONSUME(ContainerExt) },
      { ALT: () => this.CONSUME(ContainerDbExt) },
      { ALT: () => this.CONSUME(ContainerQueueExt) },
      // Component family
      { ALT: () => this.CONSUME(Component) },
      { ALT: () => this.CONSUME(ComponentDb) },
      { ALT: () => this.CONSUME(ComponentQueue) },
      { ALT: () => this.CONSUME(ComponentExt) },
      { ALT: () => this.CONSUME(ComponentDbExt) },
      { ALT: () => this.CONSUME(ComponentQueueExt) },
      // System / Person (Context family)
      { ALT: () => this.CONSUME(System) },
      { ALT: () => this.CONSUME(SystemDb) },
      { ALT: () => this.CONSUME(SystemQueue) },
      { ALT: () => this.CONSUME(SystemExt) },
      { ALT: () => this.CONSUME(SystemDbExt) },
      { ALT: () => this.CONSUME(SystemQueueExt) },
      { ALT: () => this.CONSUME(Person) },
      { ALT: () => this.CONSUME(PersonExt) },
    ]);
  });

  // ── Boundary macros (open `{ ... }`) ─────────────────────────────

  private boundaryCall = this.RULE("boundaryCall", () => {
    this.SUBRULE(this.boundaryKeyword);
    this.CONSUME(LParen);
    this.SUBRULE(this.argList);
    this.CONSUME(RParen);
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.statement));
    this.CONSUME(RBrace);
  });

  private boundaryKeyword = this.RULE("boundaryKeyword", () => {
    this.OR([
      { ALT: () => this.CONSUME(SystemBoundary) },
      { ALT: () => this.CONSUME(ContainerBoundary) },
      { ALT: () => this.CONSUME(EnterpriseBoundary) },
      { ALT: () => this.CONSUME(Boundary) },
    ]);
  });

  // ── Relation macros (Rel / Rel_*, BiRel / BiRel_*, RelIndex_*) ───

  private relationCall = this.RULE("relationCall", () => {
    this.SUBRULE(this.relationKeyword);
    this.CONSUME(LParen);
    this.SUBRULE(this.argList);
    this.CONSUME(RParen);
  });

  private relationKeyword = this.RULE("relationKeyword", () => {
    this.OR([
      // Back-arrow + back-neighbor variants first (longest match)
      { ALT: () => this.CONSUME(RelBackNeighbor) },
      { ALT: () => this.CONSUME(RelBackDown) },
      { ALT: () => this.CONSUME(RelBackUp) },
      { ALT: () => this.CONSUME(RelBackLeft) },
      { ALT: () => this.CONSUME(RelBackRight) },
      { ALT: () => this.CONSUME(RelBack) },
      // Plain neighbor (no direction)
      { ALT: () => this.CONSUME(RelNeighbor) },
      // RelIndex family (mandatory $e_index positional, handled in visitor).
      // Longest variants first so longer matches win at parser level.
      { ALT: () => this.CONSUME(RelIndexBackNeighbor) },
      { ALT: () => this.CONSUME(RelIndexBack) },
      { ALT: () => this.CONSUME(RelIndexNeighbor) },
      { ALT: () => this.CONSUME(RelIndexDownLong) },
      { ALT: () => this.CONSUME(RelIndexUpLong) },
      { ALT: () => this.CONSUME(RelIndexLeftLong) },
      { ALT: () => this.CONSUME(RelIndexRightLong) },
      { ALT: () => this.CONSUME(RelIndexDown) },
      { ALT: () => this.CONSUME(RelIndexUp) },
      { ALT: () => this.CONSUME(RelIndexLeft) },
      { ALT: () => this.CONSUME(RelIndexRight) },
      { ALT: () => this.CONSUME(RelIndex) },
      // BiRel
      { ALT: () => this.CONSUME(BiRelNeighbor) },
      { ALT: () => this.CONSUME(BiRelDownLong) },
      { ALT: () => this.CONSUME(BiRelUpLong) },
      { ALT: () => this.CONSUME(BiRelLeftLong) },
      { ALT: () => this.CONSUME(BiRelRightLong) },
      { ALT: () => this.CONSUME(BiRelDown) },
      { ALT: () => this.CONSUME(BiRelUp) },
      { ALT: () => this.CONSUME(BiRelLeft) },
      { ALT: () => this.CONSUME(BiRelRight) },
      { ALT: () => this.CONSUME(BiRel) },
      // Directional shorthand + long-form
      { ALT: () => this.CONSUME(RelDownLong) },
      { ALT: () => this.CONSUME(RelUpLong) },
      { ALT: () => this.CONSUME(RelLeftLong) },
      { ALT: () => this.CONSUME(RelRightLong) },
      { ALT: () => this.CONSUME(RelDown) },
      { ALT: () => this.CONSUME(RelUp) },
      { ALT: () => this.CONSUME(RelLeft) },
      { ALT: () => this.CONSUME(RelRight) },
      // Base
      { ALT: () => this.CONSUME(Rel) },
    ]);
  });

  // ── Layout hint macros (Lay_*) ──────────────────────────────────

  private layoutCall = this.RULE("layoutCall", () => {
    this.SUBRULE(this.layoutKeyword);
    this.CONSUME(LParen);
    this.SUBRULE(this.argList);
    this.CONSUME(RParen);
  });

  private layoutKeyword = this.RULE("layoutKeyword", () => {
    this.OR([
      { ALT: () => this.CONSUME(LayDistance) },
      { ALT: () => this.CONSUME(LayDownLong) },
      { ALT: () => this.CONSUME(LayUpLong) },
      { ALT: () => this.CONSUME(LayLeftLong) },
      { ALT: () => this.CONSUME(LayRightLong) },
      { ALT: () => this.CONSUME(LayDown) },
      { ALT: () => this.CONSUME(LayUp) },
      { ALT: () => this.CONSUME(LayLeft) },
      { ALT: () => this.CONSUME(LayRight) },
    ]);
  });

  // ── Argument list ────────────────────────────────────────────────

  /**
   * `( arg, arg, ... )` — positional values and / or `$name = value`
   * named args. Empty arg lists are legal (some opaque macros are
   * `LAYOUT_WITH_LEGEND()` etc.; they are pre-parse-stripped, but
   * the parser shouldn't blow up if one slips through).
   *
   * Trailing comma is NOT accepted by the reference C4-PlantUML stdlib
   * — `Container(api, "API",)` is a syntax error.
   */
  private argList = this.RULE("argList", () => {
    this.OPTION(() => {
      this.SUBRULE(this.argument);
      this.MANY(() => {
        this.CONSUME(Comma);
        this.SUBRULE1(this.argument);
      });
    });
  });

  /**
   * `argument` discriminates named vs positional by lookahead at
   * `NamedArgKey` `=`. Named args may carry the same value forms as
   * positional ones (string / bare token / inline function call).
   */
  private argument = this.RULE("argument", () => {
    this.OR([
      {
        GATE: () => this.LA(2).tokenType === Equals,
        ALT: () => this.SUBRULE(this.namedArg),
      },
      { ALT: () => this.SUBRULE(this.argValue) },
    ]);
  });

  private namedArg = this.RULE("namedArg", () => {
    this.CONSUME(NamedArgKey);
    this.CONSUME(Equals);
    this.SUBRULE(this.argValue);
  });

  /**
   * `argValue` — string literal, bare identifier (typically a
   * referenced alias), or inline `Identifier(...)` call (sprites,
   * shapes, legend builders).
   */
  private argValue = this.RULE("argValue", () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(SingleStringLiteral) },
      { ALT: () => this.CONSUME(IntegerLiteral) },
      {
        // `Identifier(...)` — inline function call value (e.g.
        // `$index=Index()`, `$sprite=img:logo.png`, `RoundedBoxShape()`).
        GATE: () => this.LA(2).tokenType === LParen,
        ALT: () => this.SUBRULE(this.functionCallValue),
      },
      { ALT: () => this.CONSUME(Identifier) },
      // `$sprite=$img` / `$baseShape=$shape` variable references lex as
      // NamedArgKey, but semantically they are just bare values.
      { ALT: () => this.CONSUME(NamedArgKey) },
      // C4/PlantUML examples occasionally use aliases that are exact
      // macro keywords, e.g. `Component(Component, "Component")`.
      { ALT: () => this.SUBRULE(this.keywordArgValue) },
    ]);
  });

  private functionCallValue = this.RULE("functionCallValue", () => {
    this.CONSUME(Identifier);
    this.CONSUME(LParen);
    this.SUBRULE(this.argList);
    this.CONSUME(RParen);
  });

  private keywordArgValue = this.RULE("keywordArgValue", () => {
    this.OR([
      // Element keywords.
      { ALT: () => this.CONSUME(Container) },
      { ALT: () => this.CONSUME(ContainerDb) },
      { ALT: () => this.CONSUME(ContainerQueue) },
      { ALT: () => this.CONSUME(ContainerExt) },
      { ALT: () => this.CONSUME(ContainerDbExt) },
      { ALT: () => this.CONSUME(ContainerQueueExt) },
      { ALT: () => this.CONSUME(Component) },
      { ALT: () => this.CONSUME(ComponentDb) },
      { ALT: () => this.CONSUME(ComponentQueue) },
      { ALT: () => this.CONSUME(ComponentExt) },
      { ALT: () => this.CONSUME(ComponentDbExt) },
      { ALT: () => this.CONSUME(ComponentQueueExt) },
      { ALT: () => this.CONSUME(System) },
      { ALT: () => this.CONSUME(SystemDb) },
      { ALT: () => this.CONSUME(SystemQueue) },
      { ALT: () => this.CONSUME(SystemExt) },
      { ALT: () => this.CONSUME(SystemDbExt) },
      { ALT: () => this.CONSUME(SystemQueueExt) },
      { ALT: () => this.CONSUME(Person) },
      { ALT: () => this.CONSUME(PersonExt) },

      // Boundary keywords.
      { ALT: () => this.CONSUME(Boundary) },
      { ALT: () => this.CONSUME(SystemBoundary) },
      { ALT: () => this.CONSUME(ContainerBoundary) },
      { ALT: () => this.CONSUME(EnterpriseBoundary) },

      // Relation keywords.
      { ALT: () => this.CONSUME(Rel) },
      { ALT: () => this.CONSUME(RelDown) },
      { ALT: () => this.CONSUME(RelUp) },
      { ALT: () => this.CONSUME(RelLeft) },
      { ALT: () => this.CONSUME(RelRight) },
      { ALT: () => this.CONSUME(RelDownLong) },
      { ALT: () => this.CONSUME(RelUpLong) },
      { ALT: () => this.CONSUME(RelLeftLong) },
      { ALT: () => this.CONSUME(RelRightLong) },
      { ALT: () => this.CONSUME(RelBack) },
      { ALT: () => this.CONSUME(RelBackDown) },
      { ALT: () => this.CONSUME(RelBackUp) },
      { ALT: () => this.CONSUME(RelBackLeft) },
      { ALT: () => this.CONSUME(RelBackRight) },
      { ALT: () => this.CONSUME(RelNeighbor) },
      { ALT: () => this.CONSUME(RelBackNeighbor) },
      { ALT: () => this.CONSUME(BiRel) },
      { ALT: () => this.CONSUME(BiRelDown) },
      { ALT: () => this.CONSUME(BiRelUp) },
      { ALT: () => this.CONSUME(BiRelLeft) },
      { ALT: () => this.CONSUME(BiRelRight) },
      { ALT: () => this.CONSUME(BiRelNeighbor) },
      { ALT: () => this.CONSUME(BiRelDownLong) },
      { ALT: () => this.CONSUME(BiRelUpLong) },
      { ALT: () => this.CONSUME(BiRelLeftLong) },
      { ALT: () => this.CONSUME(BiRelRightLong) },
      { ALT: () => this.CONSUME(RelIndex) },
      { ALT: () => this.CONSUME(RelIndexBack) },
      { ALT: () => this.CONSUME(RelIndexNeighbor) },
      { ALT: () => this.CONSUME(RelIndexBackNeighbor) },
      { ALT: () => this.CONSUME(RelIndexDown) },
      { ALT: () => this.CONSUME(RelIndexUp) },
      { ALT: () => this.CONSUME(RelIndexLeft) },
      { ALT: () => this.CONSUME(RelIndexRight) },
      { ALT: () => this.CONSUME(RelIndexDownLong) },
      { ALT: () => this.CONSUME(RelIndexUpLong) },
      { ALT: () => this.CONSUME(RelIndexLeftLong) },
      { ALT: () => this.CONSUME(RelIndexRightLong) },

      // Layout keywords.
      { ALT: () => this.CONSUME(LayDown) },
      { ALT: () => this.CONSUME(LayUp) },
      { ALT: () => this.CONSUME(LayLeft) },
      { ALT: () => this.CONSUME(LayRight) },
      { ALT: () => this.CONSUME(LayDownLong) },
      { ALT: () => this.CONSUME(LayUpLong) },
      { ALT: () => this.CONSUME(LayLeftLong) },
      { ALT: () => this.CONSUME(LayRightLong) },
      { ALT: () => this.CONSUME(LayDistance) },
    ]);
  });
}

export const c4PumlParser = new C4PumlParser();
export type { C4PumlParser };
