/**
 * C4-PlantUML CST → AST visitor.
 *
 * Walks the chevrotain CST produced by `parser.ts` and converts each
 * recognised node into a typed AST node from `ast.ts`. Source
 * positions captured by chevrotain's `positionTracking: "full"` lexer
 * are promoted to `SourceLocation` on every AST node — without this,
 * downstream `Model.sourceLocation` chains would lose their anchor to
 * the user's `.puml` file.
 *
 * The visitor is a thin layout transformer — no semantic validation.
 * Disambiguation of macro families (Context vs Container, BiRel,
 * RelIndex, etc.) happens in `toModel.ts`. The visitor's job is to
 * land each CST node in the right AST shape and pass it on.
 */

import type { CstNode, IToken } from "chevrotain";

import type { SourceLocation, SourcePosition } from "../../../model";
import { unescapePlantumlText } from "../strings";
import type {
  ArgumentValue,
  BareToken,
  BoundaryMacro,
  BoundaryMacroName,
  DiagramName,
  DiagramNode,
  DiagramStatement,
  ElementMacro,
  ElementMacroName,
  FileNode,
  FunctionCallValue,
  LayoutMacro,
  NamedArg,
  RelationMacro,
  StringLiteral as AstStringLiteral,
} from "./ast";
import { c4PumlParser } from "./parser";

// ── Position / range helpers ────────────────────────────────────────

/**
 * Fallback end token for a partially-recovered macro call. chevrotain
 * error recovery may leave `RParen` / `RBrace` arrays empty if the
 * parser bailed before consuming the closing token; we fall back to
 * the last token seen inside the CST subtree (always present because
 * the rule consumed at least the keyword). Without this, every
 * recovery case throws on `children.RParen[0]`.
 */
const lastTokenIn = (cst: CstNode, fallback: IToken): IToken => {
  const tokens = collectTokens(cst);
  return tokens.at(-1) ?? fallback;
};

const startOf = (token: IToken): SourcePosition => ({
  line: token.startLine!,
  col: token.startColumn!,
  offset: token.startOffset,
});

const endOf = (token: IToken): SourcePosition => ({
  line: token.endLine!,
  col: token.endColumn! + 1,
  offset: token.endOffset! + 1,
});

const rangeOf = (
  first: IToken,
  last: IToken,
  file: string,
): SourceLocation => ({
  file,
  start: startOf(first),
  end: endOf(last),
});

const tokenRange = (token: IToken, file: string): SourceLocation => ({
  file,
  start: startOf(token),
  end: endOf(token),
});

/**
 * Pull every leaf `IToken` out of a `CstNode` subtree. chevrotain
 * stores children either as `IToken[]` (terminals) or `CstNode[]`
 * (non-terminals), so we recurse on both. Used to compute the
 * enclosing range of a CST node.
 */
const collectTokens = (cst: CstNode): IToken[] => {
  const out: IToken[] = [];
  const visit = (node: CstNode): void => {
    for (const key of Object.keys(node.children)) {
      const arr = (node.children as Record<string, unknown[]>)[key];
      for (const child of arr) {
        if (child && typeof child === "object" && "image" in child) {
          out.push(child as IToken);
        } else if (child && typeof child === "object" && "children" in child) {
          visit(child as CstNode);
        }
      }
    }
  };
  visit(cst);
  return out;
};

const cstRange = (cst: CstNode, file: string): SourceLocation => {
  const tokens = collectTokens(cst);
  if (tokens.length === 0) {
    // Should never happen for a successfully-parsed rule; defensive
    // placeholder so SourceLocation contract holds.
    return {
      file,
      start: { line: 1, col: 1, offset: 0 },
      end: { line: 1, col: 1, offset: 0 },
    };
  }
  let first = tokens[0];
  let last = tokens[0];
  for (const t of tokens) {
    if (t.startOffset < first.startOffset) first = t;
    if ((t.endOffset ?? t.startOffset) > (last.endOffset ?? last.startOffset))
      last = t;
  }
  return rangeOf(first, last, file);
};

// ── String literal unescape ────────────────────────────────────────

/**
 * `"..."` → inner string with backslash-escapes resolved. PUML stdlib
 * uses simple escapes (`\"`, `\\`, `\n`) plus PlantUML Creole `~`
 * escapes for rendered text (`https:~//...` displays as `https://...`).
 */
const unwrapStringLiteral = (image: string): string => {
  const inner = image.slice(1, -1);
  const backslashUnescaped = inner.replaceAll(
    /\\(.)/g,
    (_match, char: string) => {
      switch (char) {
        case "n": {
          return "\n";
        }
        case "t": {
          return "\t";
        }
        case "r": {
          return "\r";
        }
        case '"': {
          return '"';
        }
        case "\\": {
          return "\\";
        }
        default: {
          return char;
        }
      }
    },
  );
  return unescapePlantumlText(backslashUnescaped);
};

const diagramNameFromStartUml = (
  token: IToken,
  file: string,
): DiagramName | undefined => {
  const m = /^@startuml\b(?<rest>[^\r\n]*)/.exec(token.image);
  const raw = m?.groups?.rest.trim();
  if (!raw) return undefined;
  const quoted =
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"));
  return {
    kind: "diagramName",
    range: tokenRange(token, file),
    value: quoted ? unwrapStringLiteral(raw) : raw,
    form: quoted ? "string" : "identifier",
  };
};

// ── Known named-arg names ──────────────────────────────────────────

/**
 * Named-arg keys the C4-PUML stdlib documents. Anything else goes to
 * `unknownNamedArgs` on the parent macro AST node so future stdlib
 * extensions don't crash existing files.
 *
 * Reference signatures: `C4_Container.puml` / `C4.puml` /
 * `C4_Dynamic.puml` / `C4_Sequence.puml`. Names quoted verbatim
 * (sans `$` prefix — visitor strips that when reading the key).
 */
const KNOWN_NAMED_ARGS: ReadonlySet<string> = new Set([
  "alias",
  "label",
  "techn",
  "descr",
  "sprite",
  "tags",
  "link",
  "type",
  "baseShape",
  "index",
  "e_index",
  "rel",
  "from",
  "to",
]);

// ── Element / boundary keyword extraction ──────────────────────────

/**
 * `elementKeyword` and `boundaryKeyword` CST nodes are `OR(…)` rules
 * — exactly one alt token fires. Grab whichever non-empty array of
 * `IToken` we find and return its single token. The token's
 * `tokenType.name` is the macro name (e.g. `Container`, `Person_Ext`).
 */
const firstChildToken = (cst: CstNode): IToken => {
  for (const key of Object.keys(cst.children)) {
    const arr = (cst.children as Record<string, IToken[]>)[key];
    if (arr.length > 0 && "image" in arr[0]) return arr[0];
  }
  throw new Error(`No child token found in CST node "${cst.name}"`);
};

/**
 * Map keyword token name → AST `ElementMacroName`. Token type names
 * follow our own conventions (`PersonExt`, `SystemDbExt`) but the AST
 * uses the stdlib-canonical spelling (`Person_Ext`, `SystemDb_Ext`).
 */
const ELEMENT_TOKEN_TO_MACRO_NAME: ReadonlyMap<string, ElementMacroName> =
  new Map([
    ["Person", "Person"],
    ["PersonExt", "Person_Ext"],
    ["System", "System"],
    ["SystemDb", "SystemDb"],
    ["SystemQueue", "SystemQueue"],
    ["SystemExt", "System_Ext"],
    ["SystemDbExt", "SystemDb_Ext"],
    ["SystemQueueExt", "SystemQueue_Ext"],
    ["Container", "Container"],
    ["ContainerDb", "ContainerDb"],
    ["ContainerQueue", "ContainerQueue"],
    ["ContainerExt", "Container_Ext"],
    ["ContainerDbExt", "ContainerDb_Ext"],
    ["ContainerQueueExt", "ContainerQueue_Ext"],
    ["Component", "Component"],
    ["ComponentDb", "ComponentDb"],
    ["ComponentQueue", "ComponentQueue"],
    ["ComponentExt", "Component_Ext"],
    ["ComponentDbExt", "ComponentDb_Ext"],
    ["ComponentQueueExt", "ComponentQueue_Ext"],
  ]);

const BOUNDARY_TOKEN_TO_MACRO_NAME: ReadonlyMap<string, BoundaryMacroName> =
  new Map([
    ["EnterpriseBoundary", "Enterprise_Boundary"],
    ["SystemBoundary", "System_Boundary"],
    ["ContainerBoundary", "Container_Boundary"],
    ["Boundary", "Boundary"],
  ]);

/**
 * Decode a relation keyword token name into the AST flags it
 * represents: macroName, bidirectional, back, neighbor, direction.
 * The macroName is the stdlib spelling (so toModel can recognise
 * `RelIndex_Back_Neighbor` etc. without re-decoding the token).
 */
interface RelationFlags {
  readonly macroName: string;
  readonly bidirectional: boolean;
  readonly back: boolean;
  readonly neighbor: boolean;
  readonly direction?: "D" | "U" | "L" | "R";
  /** True if this is a `RelIndex*` variant (mandatory `$e_index`). */
  readonly indexed: boolean;
}

const RELATION_FLAGS: ReadonlyMap<string, RelationFlags> = new Map([
  [
    "Rel",
    {
      macroName: "Rel",
      bidirectional: false,
      back: false,
      neighbor: false,
      indexed: false,
    },
  ],
  [
    "RelDown",
    {
      macroName: "Rel_D",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "D",
      indexed: false,
    },
  ],
  [
    "RelUp",
    {
      macroName: "Rel_U",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "U",
      indexed: false,
    },
  ],
  [
    "RelLeft",
    {
      macroName: "Rel_L",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "L",
      indexed: false,
    },
  ],
  [
    "RelRight",
    {
      macroName: "Rel_R",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "R",
      indexed: false,
    },
  ],
  [
    "RelDownLong",
    {
      macroName: "Rel_Down",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "D",
      indexed: false,
    },
  ],
  [
    "RelUpLong",
    {
      macroName: "Rel_Up",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "U",
      indexed: false,
    },
  ],
  [
    "RelLeftLong",
    {
      macroName: "Rel_Left",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "L",
      indexed: false,
    },
  ],
  [
    "RelRightLong",
    {
      macroName: "Rel_Right",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "R",
      indexed: false,
    },
  ],
  [
    "RelBack",
    {
      macroName: "Rel_Back",
      bidirectional: false,
      back: true,
      neighbor: false,
      indexed: false,
    },
  ],
  [
    "RelBackDown",
    {
      macroName: "Rel_Back_D",
      bidirectional: false,
      back: true,
      neighbor: false,
      direction: "D",
      indexed: false,
    },
  ],
  [
    "RelBackUp",
    {
      macroName: "Rel_Back_U",
      bidirectional: false,
      back: true,
      neighbor: false,
      direction: "U",
      indexed: false,
    },
  ],
  [
    "RelBackLeft",
    {
      macroName: "Rel_Back_L",
      bidirectional: false,
      back: true,
      neighbor: false,
      direction: "L",
      indexed: false,
    },
  ],
  [
    "RelBackRight",
    {
      macroName: "Rel_Back_R",
      bidirectional: false,
      back: true,
      neighbor: false,
      direction: "R",
      indexed: false,
    },
  ],
  [
    "RelNeighbor",
    {
      macroName: "Rel_Neighbor",
      bidirectional: false,
      back: false,
      neighbor: true,
      indexed: false,
    },
  ],
  [
    "RelBackNeighbor",
    {
      macroName: "Rel_Back_Neighbor",
      bidirectional: false,
      back: true,
      neighbor: true,
      indexed: false,
    },
  ],
  [
    "BiRel",
    {
      macroName: "BiRel",
      bidirectional: true,
      back: false,
      neighbor: false,
      indexed: false,
    },
  ],
  [
    "BiRelDown",
    {
      macroName: "BiRel_D",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "D",
      indexed: false,
    },
  ],
  [
    "BiRelUp",
    {
      macroName: "BiRel_U",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "U",
      indexed: false,
    },
  ],
  [
    "BiRelLeft",
    {
      macroName: "BiRel_L",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "L",
      indexed: false,
    },
  ],
  [
    "BiRelRight",
    {
      macroName: "BiRel_R",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "R",
      indexed: false,
    },
  ],
  [
    "BiRelDownLong",
    {
      macroName: "BiRel_Down",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "D",
      indexed: false,
    },
  ],
  [
    "BiRelUpLong",
    {
      macroName: "BiRel_Up",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "U",
      indexed: false,
    },
  ],
  [
    "BiRelLeftLong",
    {
      macroName: "BiRel_Left",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "L",
      indexed: false,
    },
  ],
  [
    "BiRelRightLong",
    {
      macroName: "BiRel_Right",
      bidirectional: true,
      back: false,
      neighbor: false,
      direction: "R",
      indexed: false,
    },
  ],
  [
    "BiRelNeighbor",
    {
      macroName: "BiRel_Neighbor",
      bidirectional: true,
      back: false,
      neighbor: true,
      indexed: false,
    },
  ],
  [
    "RelIndex",
    {
      macroName: "RelIndex",
      bidirectional: false,
      back: false,
      neighbor: false,
      indexed: true,
    },
  ],
  [
    "RelIndexBack",
    {
      macroName: "RelIndex_Back",
      bidirectional: false,
      back: true,
      neighbor: false,
      indexed: true,
    },
  ],
  [
    "RelIndexNeighbor",
    {
      macroName: "RelIndex_Neighbor",
      bidirectional: false,
      back: false,
      neighbor: true,
      indexed: true,
    },
  ],
  [
    "RelIndexBackNeighbor",
    {
      macroName: "RelIndex_Back_Neighbor",
      bidirectional: false,
      back: true,
      neighbor: true,
      indexed: true,
    },
  ],
  [
    "RelIndexDown",
    {
      macroName: "RelIndex_D",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "D",
      indexed: true,
    },
  ],
  [
    "RelIndexUp",
    {
      macroName: "RelIndex_U",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "U",
      indexed: true,
    },
  ],
  [
    "RelIndexLeft",
    {
      macroName: "RelIndex_L",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "L",
      indexed: true,
    },
  ],
  [
    "RelIndexRight",
    {
      macroName: "RelIndex_R",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "R",
      indexed: true,
    },
  ],
  [
    "RelIndexDownLong",
    {
      macroName: "RelIndex_Down",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "D",
      indexed: true,
    },
  ],
  [
    "RelIndexUpLong",
    {
      macroName: "RelIndex_Up",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "U",
      indexed: true,
    },
  ],
  [
    "RelIndexLeftLong",
    {
      macroName: "RelIndex_Left",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "L",
      indexed: true,
    },
  ],
  [
    "RelIndexRightLong",
    {
      macroName: "RelIndex_Right",
      bidirectional: false,
      back: false,
      neighbor: false,
      direction: "R",
      indexed: true,
    },
  ],
]);

// ── Visitor ─────────────────────────────────────────────────────────

const BaseVisitor = c4PumlParser.getBaseCstVisitorConstructor();

class C4PumlAstBuilder extends BaseVisitor {
  // Closed over via `buildAst(cst, filePath)`.
  private filePath = "";

  constructor() {
    super();
    // We do NOT call `validateVisitor()` — chevrotain's check enforces
    // a 1-to-1 method-per-rule contract, but we walk CST nodes
    // manually (delegating from `statement` to `elementCall`/etc.
    // without going through the `OR` indirection). The walker covers
    // every reachable production from `pumlFile`; missing-method bugs
    // surface immediately in the visitor smoke tests.
  }

  /** Top-level entry — `parser.pumlFile()` CST → `FileNode`. */
  build(cst: CstNode, filePath: string): FileNode {
    this.filePath = filePath;
    const diagrams: DiagramNode[] = [];
    const diagramCsts = (cst.children as { diagram?: CstNode[] }).diagram ?? [];
    for (const d of diagramCsts) {
      diagrams.push(this.diagram(d));
    }
    return {
      kind: "file",
      range: cstRange(cst, filePath),
      diagrams,
    };
  }

  // ── Top-level rules ──────────────────────────────────────────────

  diagram(cst: CstNode): DiagramNode {
    const file = this.filePath;
    const children = cst.children as {
      StartUml: IToken[];
      EndUml?: IToken[];
      diagramName?: CstNode[];
      statement?: CstNode[];
    };
    const start = children.StartUml[0];
    const end = children.EndUml?.[0] ?? start;
    const name = children.diagramName
      ? this.diagramName(children.diagramName[0])
      : diagramNameFromStartUml(start, file);
    const statements: DiagramStatement[] = [];
    for (const s of children.statement ?? []) {
      const st = this.statement(s);
      if (st) statements.push(st);
    }
    return {
      kind: "diagram",
      range: rangeOf(start, end, file),
      name,
      statements,
    };
  }

  diagramName(cst: CstNode): DiagramName {
    const children = cst.children as {
      Identifier?: IToken[];
      StringLiteral?: IToken[];
    };
    if (children.StringLiteral) {
      const t = children.StringLiteral[0];
      return {
        kind: "diagramName",
        range: tokenRange(t, this.filePath),
        value: unwrapStringLiteral(t.image),
        form: "string",
      };
    }
    const t = children.Identifier![0];
    return {
      kind: "diagramName",
      range: tokenRange(t, this.filePath),
      value: t.image,
      form: "identifier",
    };
  }

  statement(cst: CstNode): DiagramStatement | undefined {
    const children = cst.children as {
      boundaryCall?: CstNode[];
      elementCall?: CstNode[];
      relationCall?: CstNode[];
      layoutCall?: CstNode[];
    };
    if (children.boundaryCall)
      return this.boundaryCall(children.boundaryCall[0]);
    if (children.elementCall) return this.elementCall(children.elementCall[0]);
    if (children.relationCall)
      return this.relationCall(children.relationCall[0]);
    if (children.layoutCall) return this.layoutCall(children.layoutCall[0]);
    return undefined;
  }

  // ── Element / boundary / relation / layout calls ────────────────

  elementCall(cst: CstNode): ElementMacro {
    const file = this.filePath;
    const children = cst.children as {
      elementKeyword: CstNode[];
      LParen?: IToken[];
      RParen?: IToken[];
      argList: CstNode[];
    };
    const keywordToken = firstChildToken(children.elementKeyword[0]);
    const macroName = ELEMENT_TOKEN_TO_MACRO_NAME.get(
      keywordToken.tokenType.name,
    );
    if (!macroName) {
      throw new Error(
        `Unknown element keyword token "${keywordToken.tokenType.name}"`,
      );
    }
    const args = this.argList(children.argList[0]);
    const endToken = children.RParen?.[0] ?? lastTokenIn(cst, keywordToken);
    return {
      kind: "elementMacro",
      range: rangeOf(keywordToken, endToken, file),
      macroName,
      positionals: args.positionals,
      namedArgs: args.knownNamed,
      unknownNamedArgs: args.unknownNamed,
    };
  }

  boundaryCall(cst: CstNode): BoundaryMacro {
    const file = this.filePath;
    const children = cst.children as {
      boundaryKeyword: CstNode[];
      LParen?: IToken[];
      RParen?: IToken[];
      LBrace?: IToken[];
      RBrace?: IToken[];
      argList: CstNode[];
      statement?: CstNode[];
    };
    const keywordToken = firstChildToken(children.boundaryKeyword[0]);
    const macroName = BOUNDARY_TOKEN_TO_MACRO_NAME.get(
      keywordToken.tokenType.name,
    );
    if (!macroName) {
      throw new Error(
        `Unknown boundary keyword token "${keywordToken.tokenType.name}"`,
      );
    }
    const args = this.argList(children.argList[0]);
    const childrenStmts: DiagramStatement[] = [];
    for (const s of children.statement ?? []) {
      const st = this.statement(s);
      if (st) childrenStmts.push(st);
    }
    const endToken = children.RBrace?.[0] ?? lastTokenIn(cst, keywordToken);
    return {
      kind: "boundaryMacro",
      range: rangeOf(keywordToken, endToken, file),
      macroName,
      positionals: args.positionals,
      namedArgs: args.knownNamed,
      unknownNamedArgs: args.unknownNamed,
      children: childrenStmts,
    };
  }

  relationCall(cst: CstNode): RelationMacro {
    const file = this.filePath;
    const children = cst.children as {
      relationKeyword: CstNode[];
      LParen?: IToken[];
      RParen?: IToken[];
      argList: CstNode[];
    };
    const keywordToken = firstChildToken(children.relationKeyword[0]);
    const flags = RELATION_FLAGS.get(keywordToken.tokenType.name);
    if (!flags) {
      throw new Error(
        `Unknown relation keyword token "${keywordToken.tokenType.name}"`,
      );
    }
    const args = this.argList(children.argList[0]);
    // `RelIndex*` first positional is `$e_index` — split it out so
    // toModel doesn't have to re-derive variant flavour.
    const indexPositional = flags.indexed ? args.positionals[0] : undefined;
    const restPositionals = flags.indexed
      ? args.positionals.slice(1)
      : args.positionals;
    const endToken = children.RParen?.[0] ?? lastTokenIn(cst, keywordToken);
    return {
      kind: "relationMacro",
      range: rangeOf(keywordToken, endToken, file),
      macroName: flags.macroName,
      bidirectional: flags.bidirectional,
      back: flags.back,
      neighbor: flags.neighbor,
      direction: flags.direction,
      indexPositional,
      positionals: restPositionals,
      namedArgs: args.knownNamed,
      unknownNamedArgs: args.unknownNamed,
    };
  }

  layoutCall(cst: CstNode): LayoutMacro {
    const file = this.filePath;
    const children = cst.children as {
      layoutKeyword: CstNode[];
      RParen?: IToken[];
      argList: CstNode[];
    };
    const keywordToken = firstChildToken(children.layoutKeyword[0]);
    const args = this.argList(children.argList[0]);
    const endToken = children.RParen?.[0] ?? lastTokenIn(cst, keywordToken);
    return {
      kind: "layoutMacro",
      range: rangeOf(keywordToken, endToken, file),
      macroName: keywordToken.image,
      positionals: args.positionals,
    };
  }

  // ── Argument list / values ──────────────────────────────────────

  /**
   * Walk an `argList` CST node and split arguments into three buckets:
   * positionals (no `$name=`), known named args (`$name=` where name
   * is in `KNOWN_NAMED_ARGS`), and unknown named args (`$name=`
   * preserved for round-trip but ignored by toModel).
   *
   * The argList rule keeps positionals and named args interleaved in
   * the order written by the user. We preserve order WITHIN each
   * bucket but not across buckets — toModel needs positional indices
   * (positional 0 = alias, etc.) to be correct, and the stdlib
   * conventions never interleave named with positional in a way that
   * matters semantically (named args slot into the positional
   * defaults). This matches the reference Java parser's behaviour.
   */
  argList(cst: CstNode): {
    positionals: ArgumentValue[];
    knownNamed: NamedArg[];
    unknownNamed: NamedArg[];
  } {
    const positionals: ArgumentValue[] = [];
    const knownNamed: NamedArg[] = [];
    const unknownNamed: NamedArg[] = [];
    const args = (cst.children as { argument?: CstNode[] }).argument ?? [];
    for (const arg of args) {
      const argChildren = arg.children as {
        namedArg?: CstNode[];
        argValue?: CstNode[];
      };
      if (argChildren.namedArg) {
        const na = this.namedArg(argChildren.namedArg[0]);
        if (KNOWN_NAMED_ARGS.has(na.name)) knownNamed.push(na);
        else unknownNamed.push(na);
      } else if (argChildren.argValue) {
        positionals.push(this.argValue(argChildren.argValue[0]));
      }
    }
    return { positionals, knownNamed, unknownNamed };
  }

  namedArg(cst: CstNode): NamedArg {
    const file = this.filePath;
    const children = cst.children as {
      NamedArgKey: IToken[];
      argValue: CstNode[];
    };
    const keyToken = children.NamedArgKey[0];
    const value = this.argValue(children.argValue[0]);
    // Strip leading `$` from the key.
    const name = keyToken.image.startsWith("$")
      ? keyToken.image.slice(1)
      : keyToken.image;
    return {
      kind: "namedArg",
      range: { file, start: startOf(keyToken), end: value.range.end },
      name,
      value,
    };
  }

  argValue(cst: CstNode): ArgumentValue {
    const file = this.filePath;
    const children = cst.children as {
      StringLiteral?: IToken[];
      SingleStringLiteral?: IToken[];
      IntegerLiteral?: IToken[];
      Identifier?: IToken[];
      NamedArgKey?: IToken[];
      functionCallValue?: CstNode[];
      keywordArgValue?: CstNode[];
    };
    const stringToken =
      children.StringLiteral?.[0] ?? children.SingleStringLiteral?.[0];
    if (stringToken) {
      const lit: AstStringLiteral = {
        kind: "string",
        range: tokenRange(stringToken, file),
        value: unwrapStringLiteral(stringToken.image),
      };
      return lit;
    }
    if (children.functionCallValue) {
      return this.functionCallValue(children.functionCallValue[0]);
    }
    if (children.IntegerLiteral) {
      const t = children.IntegerLiteral[0];
      // Integers land as bareToken — `argString` returns `.value`,
      // and `coerceOrder`/etc. apply `Number()` consistently with the
      // quoted-numeric form `$index="3"`.
      const bare: BareToken = {
        kind: "bareToken",
        range: tokenRange(t, file),
        value: t.image,
      };
      return bare;
    }
    const t =
      children.Identifier?.[0] ??
      children.NamedArgKey?.[0] ??
      (children.keywordArgValue
        ? firstChildToken(children.keywordArgValue[0])
        : undefined);
    if (!t) {
      return {
        kind: "bareToken",
        range: cstRange(cst, file),
        value: "",
      };
    }
    const bare: BareToken = {
      kind: "bareToken",
      range: tokenRange(t, file),
      value: t.image,
    };
    return bare;
  }

  functionCallValue(cst: CstNode): FunctionCallValue {
    const file = this.filePath;
    const children = cst.children as {
      Identifier: IToken[];
      LParen: IToken[];
      RParen: IToken[];
      argList: CstNode[];
    };
    const nameToken = children.Identifier[0];
    const args = this.argList(children.argList[0]);
    // Inline function-call values rarely use named args, but the
    // grammar permits them — flatten knownNamed+unknownNamed back
    // into `args` order-preserved is more work than it's worth.
    // toModel only inspects positionals on FunctionCallValue (e.g.
    // for `Index()` we don't even read positionals).
    return {
      kind: "functionCallValue",
      range: rangeOf(nameToken, children.RParen[0], file),
      functionName: nameToken.image,
      args: args.positionals,
    };
  }
}

const visitor = new C4PumlAstBuilder();

/**
 * Entry point — chevrotain CST + file path → typed `FileNode` AST.
 * `filePath` is propagated into every `SourceLocation` so downstream
 * diagnostics carry the original file reference.
 */
export const buildAst = (cst: CstNode, filePath: string): FileNode =>
  visitor.build(cst, filePath);
