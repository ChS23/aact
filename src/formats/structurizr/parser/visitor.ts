/**
 * Structurizr DSL CST → AST visitor.
 *
 * Walks the chevrotain CST produced by `parser.ts` and converts each
 * recognised node into a typed AST node from `ast.ts`. Source positions
 * captured by chevrotain's `positionTracking: "full"` lexer are
 * promoted to `SourceLocation` on every AST node.
 *
 * Scope (matches parser.ts):
 *
 *   - Workspace + Model
 *   - Person / SoftwareSystem / Container / Component / Group elements
 *   - Element body statements + directives
 *   - Explicit relationships
 */

import type { CstNode, IToken } from "chevrotain";

import type { SourceLocation, SourcePosition } from "../../../model";
import type {
  DescriptionOverride,
  ElementBodyNode,
  ElementNode,
  GroupNode,
  Identifier as AstIdentifier,
  IdentifierRef,
  ModelChildNode,
  ModelNode,
  NameOverride,
  PerspectiveEntry,
  PerspectivesBlock,
  PropertiesBlock,
  PropertyEntry,
  RelationshipNode,
  StringLiteral as AstStringLiteral,
  TagsStatement,
  WorkspaceBodyNode,
  WorkspaceNode,
} from "./ast";
import { parserInstance } from "./parser";
import type { ArchetypeDefaults } from "./preParse";

const sourcePosFromTokenStart = (token: IToken): SourcePosition => ({
  line: token.startLine!,
  col: token.startColumn!,
  offset: token.startOffset,
});

const sourcePosFromTokenEnd = (token: IToken): SourcePosition => ({
  line: token.endLine!,
  col: token.endColumn! + 1,
  offset: token.endOffset! + 1,
});

const rangeFromToken = (token: IToken, file: string): SourceLocation => ({
  file,
  start: sourcePosFromTokenStart(token),
  end: sourcePosFromTokenEnd(token),
});

const rangeFromTokens = (
  first: IToken,
  last: IToken,
  file: string,
): SourceLocation => ({
  file,
  start: sourcePosFromTokenStart(first),
  end: sourcePosFromTokenEnd(last),
});

const unwrapStringLiteral = (image: string): string => {
  const inner = image.slice(1, -1);
  return inner.replaceAll(/\\(.)/g, (_match, char: string) => {
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
  });
};

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

interface ElementHeaderAst {
  readonly kind:
    | "person"
    | "softwareSystem"
    | "container"
    | "component"
    | "group"
    | "element";
  readonly kindToken: IToken;
  readonly lastToken: IToken;
  readonly name: AstStringLiteral;
  readonly description?: AstStringLiteral;
  readonly technology?: AstStringLiteral;
  readonly tags?: AstStringLiteral;
  /** When the kind token was substituted from an archetype alias by
   *  the pre-parse pass, this carries the alias name + defaults so
   *  `elementDeclaration` can merge them onto the AST node. */
  readonly aliasUsage?: { name: string; defaults: ArchetypeDefaults };
}

const findClosingBrace = (cst: CstNode): IToken | undefined => {
  const rbrace = (cst.children as { RBrace?: IToken[] }).RBrace;
  return rbrace?.[0];
};

const zeroPos = (): SourcePosition => ({ line: 1, col: 1, offset: 0 });

const zeroRange = (file: string): SourceLocation => ({
  file,
  start: zeroPos(),
  end: zeroPos(),
});

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

const firstTokenIn = (cst: CstNode): IToken | undefined =>
  collectTokens(cst).at(0);

/**
 * Strip `"""..."""` wrapping from a triple-quoted text block token.
 * The reference DSL preserves the inner contents verbatim — no escape
 * processing — so we mirror that.
 */
const unwrapTextBlock = (image: string): string => image.slice(3, -3);

/**
 * Build a string AST node from any token that could carry a textual
 * value: a `StringLiteral`, a `TextBlock`, or a bare `Identifier`
 * (used as a path in some directive slots). The wrapper / escape
 * rules differ per token type, so dispatch on `tokenType.name`.
 */
const stringFromAnyToken = (token: IToken, file: string): AstStringLiteral => {
  switch (token.tokenType.name) {
    case "StringLiteral": {
      return {
        kind: "string",
        value: unwrapStringLiteral(token.image),
        range: rangeFromToken(token, file),
      };
    }
    case "TextBlock": {
      return {
        kind: "string",
        value: unwrapTextBlock(token.image),
        range: rangeFromToken(token, file),
      };
    }
    default: {
      return {
        kind: "string",
        value: token.image,
        range: rangeFromToken(token, file),
      };
    }
  }
};

/**
 * `identifierName` subrule yields a CST node whose single child is
 * the token that matched (Identifier | Person | SoftwareSystem | ...).
 * Pull the token out regardless of which alternative fired.
 */
const tokenFromIdentifierName = (cst: CstNode): IToken => {
  const children = cst.children as Readonly<Record<string, IToken[]>>;
  for (const key of [
    "Identifier",
    "Person",
    "SoftwareSystem",
    "Container",
    "Component",
    "Group",
    "Element",
  ]) {
    const tok = children[key]?.[0];
    if (tok) return tok;
  }
  throw new Error("identifierName CST had no recognised token alternative");
};

class StructurizrCstToAst extends BaseVisitor {
  private file = "";

  constructor() {
    super();
    this.validateVisitor();
  }

  public buildAst(cst: CstNode, file: string): WorkspaceNode {
    this.file = file;
    return this.visit(cst) as WorkspaceNode;
  }

  workspaceFile(ctx: WorkspaceFileCtx): WorkspaceNode {
    return this.visit(ctx.workspaceBlock[0]) as WorkspaceNode;
  }

  workspaceBlock(ctx: WorkspaceBlockCtx): WorkspaceNode {
    const fallbackToken = ctx.modelBlock?.[0]
      ? firstTokenIn(ctx.modelBlock[0])
      : undefined;
    const workspaceToken =
      ctx.Workspace?.[0] ??
      ctx.name?.[0] ??
      ctx.description?.[0] ??
      ctx.extendsTarget?.[0] ??
      ctx.extendsTargetUrl?.[0] ??
      ctx.LBrace?.[0] ??
      ctx.RBrace?.[0] ??
      fallbackToken;
    // After a parse error, chevrotain may produce a partial CST where
    // the closing brace is missing. Fall back to the workspace token's
    // own range — `recovered: true` signals the partial parse.
    const closeToken = ctx.RBrace?.[0] ?? workspaceToken;
    const recovered = !ctx.Workspace?.[0] || !ctx.RBrace?.[0];
    const name = ctx.name ? this.stringFromToken(ctx.name[0]) : undefined;
    const description = ctx.description
      ? this.stringFromToken(ctx.description[0])
      : undefined;
    const extendsTargetToken =
      ctx.extendsTarget?.[0] ??
      ctx.extendsTargetUrl?.[0] ??
      ctx.extendsTargetPath?.[0];
    const extendsTarget = extendsTargetToken
      ? stringFromAnyToken(extendsTargetToken, this.file)
      : undefined;
    const body: WorkspaceBodyNode[] = [];
    for (const m of ctx.modelBlock ?? []) {
      body.push(this.visit(m) as ModelNode);
    }
    for (const n of ctx.workspaceNameStmt ?? []) {
      body.push(this.visit(n) as NameOverride);
    }
    for (const d of ctx.workspaceDescriptionStmt ?? []) {
      body.push(this.visit(d) as DescriptionOverride);
    }
    for (const d of ctx.directive ?? []) {
      const node = this.visit(d) as WorkspaceBodyNode | undefined;
      if (node) body.push(node);
    }
    return {
      kind: "workspace",
      name,
      description,
      extendsTarget,
      body,
      range:
        workspaceToken && closeToken
          ? rangeFromTokens(workspaceToken, closeToken, this.file)
          : zeroRange(this.file),
      ...(recovered ? { recovered: true as const } : {}),
    };
  }

  workspaceNameStmt(ctx: {
    Name: [IToken];
    StringLiteral: [IToken];
  }): NameOverride {
    const keyword = ctx.Name[0];
    const value = ctx.StringLiteral[0];
    return {
      kind: "nameOverride",
      value: this.stringFromToken(value),
      range: rangeFromTokens(keyword, value, this.file),
    };
  }

  workspaceDescriptionStmt(ctx: {
    Description: [IToken];
    StringLiteral: [IToken];
  }): DescriptionOverride {
    const keyword = ctx.Description[0];
    const value = ctx.StringLiteral[0];
    return {
      kind: "descriptionOverride",
      value: this.stringFromToken(value),
      range: rangeFromTokens(keyword, value, this.file),
    };
  }

  modelBlock(ctx: ModelBlockCtx): ModelNode {
    const modelToken =
      ctx.Model?.[0] ??
      ctx.LBrace?.[0] ??
      ctx.RBrace?.[0] ??
      (ctx.modelBodyItem?.[0] ? firstTokenIn(ctx.modelBodyItem[0]) : undefined);
    const closeToken = ctx.RBrace?.[0] ?? modelToken;
    const recovered = !ctx.Model?.[0] || !ctx.RBrace?.[0];
    const items = (ctx.modelBodyItem ?? [])
      .map((i) => this.visit(i) as ModelChildNode | undefined)
      .filter((i): i is ModelChildNode => i !== undefined);
    return {
      kind: "model",
      children: items,
      range:
        modelToken && closeToken
          ? rangeFromTokens(modelToken, closeToken, this.file)
          : zeroRange(this.file),
      ...(recovered ? { recovered: true as const } : {}),
    };
  }

  modelBodyItem(ctx: ModelBodyItemCtx): ModelChildNode | undefined {
    if (ctx.elementDeclaration?.[0]) {
      return this.visit(ctx.elementDeclaration[0]) as ElementNode;
    }
    if (ctx.reopenDeclaration?.[0]) {
      return this.visit(ctx.reopenDeclaration[0]) as ModelChildNode;
    }
    if (ctx.relationship?.[0]) {
      return this.visit(ctx.relationship[0]) as RelationshipNode;
    }
    if (ctx.directive?.[0]) {
      return this.visit(ctx.directive[0]) as ModelChildNode;
    }
    if (ctx.propertiesBlock?.[0]) {
      return this.visit(ctx.propertiesBlock[0]) as ModelChildNode;
    }
    return undefined; // recovered / incomplete — caller filters
  }

  /**
   * `identifierName` subrule — no real AST output, the parent rule
   * pulls the matched token out directly via `tokenFromIdentifierName`.
   * The visitor method exists only to satisfy chevrotain's
   * `validateVisitor` check that every rule has a corresponding
   * method.
   */
  identifierName(): undefined {
    return undefined;
  }

  reopenDeclaration(ctx: ReopenDeclarationCtx): ModelChildNode {
    const targetToken = tokenFromIdentifierName(ctx.target[0]);
    const body = this.visit(ctx.elementBody[0]) as ElementBodyNode[];
    const closeToken = findClosingBrace(ctx.elementBody[0]);
    return {
      kind: "reopen",
      target: {
        kind: "identifierRef",
        name: targetToken.image,
        range: rangeFromToken(targetToken, this.file),
      },
      body,
      range: rangeFromTokens(targetToken, closeToken ?? targetToken, this.file),
    };
  }

  elementDeclaration(ctx: ElementDeclarationCtx): ElementNode {
    const header = this.visit(ctx.elementHeader[0]) as ElementHeaderAst;
    let body: ElementBodyNode[] = ctx.elementBody
      ? (this.visit(ctx.elementBody[0]) as ElementBodyNode[])
      : [];
    const assignedCst = ctx.assignedIdentifier?.[0];
    const assignedToken = assignedCst
      ? tokenFromIdentifierName(assignedCst)
      : undefined;
    const assignedAst: AstIdentifier | undefined = assignedToken
      ? {
          kind: "identifier",
          name: assignedToken.image,
          range: rangeFromToken(assignedToken, this.file),
        }
      : undefined;

    const startToken = assignedToken ?? header.kindToken;
    const closingToken = ctx.elementBody?.[0]
      ? findClosingBrace(ctx.elementBody[0])
      : header.lastToken;
    const baseRange = rangeFromTokens(
      startToken,
      closingToken ?? header.lastToken,
      this.file,
    );

    // Apply archetype-alias defaults. Source positionals win — only
    // fill description / technology when the user didn't set them.
    // Tags from the alias body merge additively (`archetype.tags +
    // header.tags`) per `ContainerParser.parse` in the reference; the
    // alias *name* itself is NOT added as a tag (verified against
    // `DslTests.test_archetypes` — Customer API only carries
    // "Application" / "Spring Boot", not "application" /
    // "springBootApplication"). We inject synthetic TagsStatement /
    // PropertiesBlock / PerspectivesBlock at the start of the body so
    // the normal toModel aggregation merges them with any explicit
    // body statements (later body lines override earlier ones for
    // singular keys; tags accumulate).
    //
    // Out of scope (deliberate, documented in grammar.md):
    //   - relationship archetypes (`a --https-> b`)
    let headerDescription = header.description;
    let headerTechnology = header.technology;
    if (header.aliasUsage) {
      const { defaults } = header.aliasUsage;
      if (!headerDescription && defaults.description) {
        headerDescription = this.syntheticString(
          defaults.description,
          header.kindToken,
        );
      }
      if (!headerTechnology && defaults.technology) {
        headerTechnology = this.syntheticString(
          defaults.technology,
          header.kindToken,
        );
      }
      body = [
        ...this.syntheticArchetypeBody(defaults, header.kindToken),
        ...body,
      ];
    }

    switch (header.kind) {
      case "person": {
        return {
          kind: "person",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription,
          body,
          range: baseRange,
        };
      }
      case "softwareSystem": {
        return {
          kind: "softwareSystem",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription,
          body,
          range: baseRange,
        };
      }
      case "container": {
        return {
          kind: "container",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription,
          headerTechnology,
          body,
          range: baseRange,
        };
      }
      case "component": {
        return {
          kind: "component",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerTags: header.tags,
          headerDescription,
          headerTechnology,
          body,
          range: baseRange,
        };
      }
      case "element": {
        // `element <name> [metadata] [description] [tags]`. The
        // visitor's elementHeader has already split positionals to
        // description / tags for the element case (metadata drops on
        // the floor — we have no Model field for it). Read straight
        // from header.description / header.tags.
        return {
          kind: "element",
          assignedIdentifier: assignedAst,
          name: header.name,
          headerDescription,
          headerTags: header.tags,
          body,
          range: baseRange,
        };
      }
      case "group": {
        const groupNode: GroupNode = {
          kind: "group",
          assignedIdentifier: assignedAst,
          name: header.name,
          members: body.filter(
            (b): b is ElementNode | RelationshipNode =>
              b.kind === "person" ||
              b.kind === "softwareSystem" ||
              b.kind === "container" ||
              b.kind === "component" ||
              b.kind === "group" ||
              b.kind === "relationship",
          ),
          range: baseRange,
        };
        return groupNode;
      }
    }
  }

  elementHeader(ctx: ElementHeaderCtx): ElementHeaderAst {
    const kindToken =
      ctx.kind?.[0] ??
      ctx.Person?.[0] ??
      ctx.SoftwareSystem?.[0] ??
      ctx.Container?.[0] ??
      ctx.Component?.[0] ??
      ctx.Group?.[0] ??
      ctx.Element?.[0];
    if (!kindToken) {
      throw new Error("elementHeader: missing kind token in CST");
    }
    const kindName = (kindToken.tokenType.name.charAt(0).toLowerCase() +
      kindToken.tokenType.name.slice(1)) as ElementHeaderAst["kind"];
    const nameToken = ctx.name[0];
    const positional1 = ctx.positional1?.[0];
    const positional2 = ctx.positional2?.[0];
    const positional3 = ctx.positional3?.[0];

    const hasTechnology = kindName === "container" || kindName === "component";
    const isCustomElement = kindName === "element";

    let description: AstStringLiteral | undefined;
    let technology: AstStringLiteral | undefined;
    let tags: AstStringLiteral | undefined;

    if (isCustomElement) {
      // `element <name> [metadata] [description] [tags]`. Metadata
      // currently drops on the floor — we have no Model field for it.
      if (positional2) description = this.stringFromToken(positional2);
      if (positional3) tags = this.stringFromToken(positional3);
    } else {
      if (positional1) description = this.stringFromToken(positional1);
      if (positional2) {
        if (hasTechnology) technology = this.stringFromToken(positional2);
        else tags = this.stringFromToken(positional2);
      }
    }
    if (positional3 && !isCustomElement) {
      tags = this.stringFromToken(positional3);
    }

    const lastToken = positional3 ?? positional2 ?? positional1 ?? nameToken;
    const aliasUsage = (
      kindToken as IToken & {
        aliasUsage?: { name: string; defaults: ArchetypeDefaults };
      }
    ).aliasUsage;
    return {
      kind: kindName,
      kindToken,
      lastToken,
      name: this.stringFromToken(nameToken),
      description,
      technology,
      tags,
      aliasUsage,
    };
  }

  elementBody(ctx: ElementBodyCtx): ElementBodyNode[] {
    const items: ElementBodyNode[] = [];
    // Body statements come first in the alternative list so the visitor
    // walks them too. The CST may have any combination.
    if (ctx.bodyStatement) {
      for (const stmt of ctx.bodyStatement) {
        const node = this.visit(stmt) as ElementBodyNode | undefined;
        if (node) items.push(node);
      }
    }
    if (ctx.elementDeclaration) {
      for (const decl of ctx.elementDeclaration) {
        items.push(this.visit(decl) as ElementNode);
      }
    }
    if (ctx.relationship) {
      for (const rel of ctx.relationship) {
        items.push(this.visit(rel) as RelationshipNode);
      }
    }
    return items;
  }

  // ── Body statements ────────────────────────────────────────────────

  bodyStatement(ctx: BodyStatementCtx): ElementBodyNode | undefined {
    if (ctx.descriptionStmt?.[0]) {
      return this.visit(ctx.descriptionStmt[0]) as ElementBodyNode;
    }
    if (ctx.technologyStmt?.[0]) {
      return this.visit(ctx.technologyStmt[0]) as ElementBodyNode;
    }
    if (ctx.tagsStmt?.[0]) {
      return this.visit(ctx.tagsStmt[0]) as ElementBodyNode;
    }
    if (ctx.tagStmt?.[0]) {
      return this.visit(ctx.tagStmt[0]) as ElementBodyNode;
    }
    if (ctx.urlStmt?.[0]) {
      return this.visit(ctx.urlStmt[0]) as ElementBodyNode;
    }
    if (ctx.propertiesBlock?.[0]) {
      return this.visit(ctx.propertiesBlock[0]) as ElementBodyNode;
    }
    if (ctx.perspectivesBlock?.[0]) {
      return this.visit(ctx.perspectivesBlock[0]) as ElementBodyNode;
    }
    // Element-body directives (`!const X "Y"` / `!var ...` etc.) are
    // accepted by the parser (reference allows them at any scope) but
    // dropped here intentionally — `${NAME}` substitutions are
    // resolved by the pre-lex pass in `index.ts:expandSubstitutions`,
    // so by the time the visitor runs the directive has no Model
    // impact. Reintroduce a return here only if a directive starts
    // affecting the Model from inside an element body.
    return undefined;
  }

  descriptionStmt(ctx: { Description: [IToken]; StringLiteral: [IToken] }) {
    const keyword = ctx.Description[0];
    const value = ctx.StringLiteral[0];
    return {
      kind: "description" as const,
      value: this.stringFromToken(value),
      range: rangeFromTokens(keyword, value, this.file),
    };
  }

  technologyStmt(ctx: { Technology: [IToken]; StringLiteral: [IToken] }) {
    const keyword = ctx.Technology[0];
    const value = ctx.StringLiteral[0];
    return {
      kind: "technology" as const,
      value: this.stringFromToken(value),
      range: rangeFromTokens(keyword, value, this.file),
    };
  }

  tagsStmt(ctx: { Tags: [IToken]; StringLiteral: IToken[] }) {
    const keyword = ctx.Tags[0];
    const tokens = ctx.StringLiteral;
    // Multi-string form (`tags "a" "b" "c"`) joins the unwrapped values
    // with `,` so the downstream splitTags pass produces three tags.
    // Single-string form (`tags "a,b,c"`) is the comma case; both
    // funnel through the same value string.
    const joined = tokens.map((t) => unwrapStringLiteral(t.image)).join(",");
    return {
      kind: "tags" as const,
      value: {
        kind: "string" as const,
        value: joined,
        range: rangeFromTokens(tokens[0], tokens.at(-1)!, this.file),
      },
      range: rangeFromTokens(keyword, tokens.at(-1)!, this.file),
    };
  }

  tagStmt(ctx: { Tag: [IToken]; StringLiteral: IToken[] }) {
    // `tag` is a syntactic alias for `tags` in the reference parser
    // (`StructurizrDslParser.java:612` dispatches both to
    // `ModelItemParser.parseTags`). Same shape: accept multiple
    // string args, join with `,` so downstream splitTags handles the
    // comma form uniformly.
    const keyword = ctx.Tag[0];
    const tokens = ctx.StringLiteral;
    const joined = tokens.map((t) => unwrapStringLiteral(t.image)).join(",");
    return {
      kind: "tag" as const,
      value: {
        kind: "string" as const,
        value: joined,
        range: rangeFromTokens(tokens[0], tokens.at(-1)!, this.file),
      },
      range: rangeFromTokens(keyword, tokens.at(-1)!, this.file),
    };
  }

  urlStmt(ctx: {
    Url: [IToken];
    StringLiteral?: [IToken];
    UrlLiteral?: [IToken];
    Identifier?: [IToken];
  }) {
    const keyword = ctx.Url[0];
    const value = (ctx.StringLiteral ?? ctx.UrlLiteral ?? ctx.Identifier)![0];
    return {
      kind: "url" as const,
      value: stringFromAnyToken(value, this.file),
      range: rangeFromTokens(keyword, value, this.file),
    };
  }

  propertiesBlock(ctx: {
    Properties: [IToken];
    LBrace: [IToken];
    RBrace?: [IToken];
    propertyEntry?: CstNode[];
  }) {
    const keyword = ctx.Properties[0];
    const close = ctx.RBrace?.[0] ?? keyword;
    const entries = (ctx.propertyEntry ?? []).map(
      (e) => this.visit(e) as ReturnType<StructurizrCstToAst["propertyEntry"]>,
    );
    return {
      kind: "properties" as const,
      entries,
      range: rangeFromTokens(keyword, close, this.file),
    };
  }

  propertyEntry(ctx: {
    key: [IToken];
    value?: [IToken];
    valueUrl?: [IToken];
    valueSlash?: [IToken];
  }) {
    const keyToken = ctx.key[0];
    const valueToken = (ctx.value ?? ctx.valueUrl ?? ctx.valueSlash)![0];
    const isStringValue = valueToken.tokenType.name === "StringLiteral";
    const isStringKey = keyToken.tokenType.name === "StringLiteral";
    return {
      kind: "propertyEntry" as const,
      key: {
        kind: "string" as const,
        value: isStringKey
          ? unwrapStringLiteral(keyToken.image)
          : keyToken.image,
        range: rangeFromToken(keyToken, this.file),
      },
      value: {
        kind: "string" as const,
        value: isStringValue
          ? unwrapStringLiteral(valueToken.image)
          : valueToken.image,
        range: rangeFromToken(valueToken, this.file),
      },
      range: rangeFromTokens(keyToken, valueToken, this.file),
    };
  }

  perspectivesBlock(ctx: {
    Perspectives: [IToken];
    LBrace: [IToken];
    RBrace?: [IToken];
    perspectiveEntry?: CstNode[];
  }) {
    const keyword = ctx.Perspectives[0];
    const close = ctx.RBrace?.[0] ?? keyword;
    const entries = (ctx.perspectiveEntry ?? []).map(
      (e) =>
        this.visit(e) as ReturnType<StructurizrCstToAst["perspectiveEntry"]>,
    );
    return {
      kind: "perspectives" as const,
      entries,
      range: rangeFromTokens(keyword, close, this.file),
    };
  }

  perspectiveEntry(ctx: {
    name: [IToken];
    description: [IToken];
    value?: [IToken];
  }) {
    const nameToken = ctx.name[0];
    const descToken = ctx.description[0];
    const valueToken = ctx.value?.[0];
    return {
      kind: "perspectiveEntry" as const,
      name: {
        kind: "identifier" as const,
        name: nameToken.image,
        range: rangeFromToken(nameToken, this.file),
      },
      description: this.stringFromToken(descToken),
      value: valueToken ? this.stringFromToken(valueToken) : undefined,
      range: rangeFromTokens(nameToken, valueToken ?? descToken, this.file),
    };
  }

  // ── Directives ─────────────────────────────────────────────────────

  directive(ctx: {
    includeDirective?: [CstNode];
    constDirective?: [CstNode];
    varDirective?: [CstNode];
    identifiersDirective?: [CstNode];
    impliedRelationshipsDirective?: [CstNode];
  }) {
    const node =
      ctx.includeDirective?.[0] ??
      ctx.constDirective?.[0] ??
      ctx.varDirective?.[0] ??
      ctx.identifiersDirective?.[0] ??
      ctx.impliedRelationshipsDirective?.[0];
    return node ? this.visit(node) : undefined;
  }

  includeDirective(ctx: {
    BangInclude?: [IToken];
    BangIncludeUrl?: [IToken];
    StringLiteral?: [IToken];
    UrlLiteral?: [IToken];
    Identifier?: [IToken];
  }) {
    const keyword = (ctx.BangInclude?.[0] ?? ctx.BangIncludeUrl?.[0])!;
    const valueToken = (ctx.StringLiteral ??
      ctx.UrlLiteral ??
      ctx.Identifier)![0];
    const targetValue = stringFromAnyToken(valueToken, this.file);
    return {
      kind: "include" as const,
      target: targetValue,
      range: rangeFromTokens(keyword, valueToken, this.file),
    };
  }

  constDirective(ctx: {
    BangConst: [IToken];
    name: [IToken];
    value?: [IToken];
    valueTextBlock?: [IToken];
  }) {
    const keyword = ctx.BangConst[0];
    const nameToken = ctx.name[0];
    const valueToken = (ctx.value ?? ctx.valueTextBlock)![0];
    return {
      kind: "const" as const,
      name: {
        kind: "string" as const,
        value: nameToken.image,
        range: rangeFromToken(nameToken, this.file),
      },
      value: stringFromAnyToken(valueToken, this.file),
      range: rangeFromTokens(keyword, valueToken, this.file),
    };
  }

  varDirective(ctx: {
    BangVar: [IToken];
    name: [IToken];
    value?: [IToken];
    valueTextBlock?: [IToken];
  }) {
    const keyword = ctx.BangVar[0];
    const nameToken = ctx.name[0];
    const valueToken = (ctx.value ?? ctx.valueTextBlock)![0];
    return {
      kind: "var" as const,
      name: {
        kind: "string" as const,
        value: nameToken.image,
        range: rangeFromToken(nameToken, this.file),
      },
      value: stringFromAnyToken(valueToken, this.file),
      range: rangeFromTokens(keyword, valueToken, this.file),
    };
  }

  identifiersDirective(ctx: { BangIdentifiers: [IToken]; scope: [IToken] }) {
    const keyword = ctx.BangIdentifiers[0];
    const scopeToken = ctx.scope[0];
    return {
      kind: "identifiers" as const,
      scope: scopeToken.image === "hierarchical" ? "hierarchical" : "flat",
      range: rangeFromTokens(keyword, scopeToken, this.file),
    };
  }

  impliedRelationshipsDirective(ctx: {
    BangImpliedRelationships?: [IToken];
    ImpliedRelationships?: [IToken];
    value: [IToken];
  }) {
    // Both `!impliedRelationships` and bare `impliedRelationships`
    // land here; the visitor doesn't distinguish — toModel reads the
    // value and applies the same strategy either way.
    const keyword = (ctx.BangImpliedRelationships ??
      ctx.ImpliedRelationships)![0];
    const valueToken = ctx.value[0];
    const valueText =
      valueToken.tokenType.name === "StringLiteral"
        ? unwrapStringLiteral(valueToken.image)
        : valueToken.image;
    return {
      kind: "impliedRelationships" as const,
      value: {
        kind: "string" as const,
        value: valueText,
        range: rangeFromToken(valueToken, this.file),
      },
      range: rangeFromTokens(keyword, valueToken, this.file),
    };
  }

  relationship(ctx: RelationshipCtx): RelationshipNode {
    // Source / destination each have two surface forms in the grammar:
    //   - identifierName subrule (any identifier-like token)
    //   - bare `this` keyword
    // Resolve to a single IToken for downstream consumers.
    const sourceToken =
      (ctx.source && tokenFromIdentifierName(ctx.source[0])) ??
      ctx.sourceThis?.[0];
    const destinationToken =
      (ctx.destination && tokenFromIdentifierName(ctx.destination[0])) ??
      ctx.destinationThis?.[0];
    if (!destinationToken) {
      // Partial CST after parser recovery — leave the AST shape
      // intact so downstream visitors don't crash, but mark the node
      // as recovered. toModel filters relationships with no
      // resolvable destination.
      const arrowToken =
        ctx.arrow?.[0] ?? ctx.Relationship?.[0] ?? ctx.NoRelationship?.[0];
      const fallbackStart = sourceToken ?? arrowToken;
      const fallbackEnd = arrowToken ?? sourceToken;
      return {
        kind: "relationship",
        arrow: "->",
        destination: {
          kind: "identifierRef",
          name: "<recovered>",
          range: fallbackStart
            ? rangeFromToken(fallbackStart, this.file)
            : { file: this.file, start: zeroPos(), end: zeroPos() },
        },
        body: [],
        range:
          fallbackStart && fallbackEnd
            ? rangeFromTokens(fallbackStart, fallbackEnd, this.file)
            : { file: this.file, start: zeroPos(), end: zeroPos() },
        recovered: true as const,
      };
    }

    // Arrow lands in one of three slots depending on which OR alt fired.
    const arrowToken =
      ctx.arrow?.[0] ?? ctx.Relationship?.[0] ?? ctx.NoRelationship?.[0];

    const relationshipBodyClose = ctx.relationshipBody?.[0]
      ? findClosingBrace(ctx.relationshipBody[0])
      : undefined;
    const lastToken =
      relationshipBodyClose ??
      ctx.tags?.[0] ??
      ctx.technology?.[0] ??
      ctx.description?.[0] ??
      destinationToken;
    const body = ctx.relationshipBody
      ? (this.visit(ctx.relationshipBody[0]) as RelationshipNode["body"])
      : [];

    const source: IdentifierRef | undefined = sourceToken
      ? {
          kind: "identifierRef",
          name: sourceToken.image,
          range: rangeFromToken(sourceToken, this.file),
          ...(ctx.sourceThis ? { isThis: true as const } : {}),
        }
      : undefined;
    const destination: IdentifierRef = {
      kind: "identifierRef",
      name: destinationToken.image,
      range: rangeFromToken(destinationToken, this.file),
      ...(ctx.destinationThis ? { isThis: true as const } : {}),
    };
    const assignedCst = ctx.assignedIdentifier?.[0];
    const assignedToken = assignedCst
      ? tokenFromIdentifierName(assignedCst)
      : undefined;
    const assignedAst: AstIdentifier | undefined = assignedToken
      ? {
          kind: "identifier",
          name: assignedToken.image,
          range: rangeFromToken(assignedToken, this.file),
        }
      : undefined;
    const startToken = assignedToken ?? sourceToken ?? arrowToken!;
    return {
      kind: "relationship",
      assignedIdentifier: assignedAst,
      arrow: (arrowToken?.image ?? "->") as "->" | "-/>",
      source,
      destination,
      headerDescription: ctx.description
        ? this.stringFromToken(ctx.description[0])
        : undefined,
      headerTechnology: ctx.technology
        ? this.stringFromToken(ctx.technology[0])
        : undefined,
      headerTags: ctx.tags ? this.stringFromToken(ctx.tags[0]) : undefined,
      body,
      range: rangeFromTokens(startToken, lastToken, this.file),
    };
  }

  relationshipBody(ctx: RelationshipBodyCtx): RelationshipNode["body"] {
    const items: RelationshipNode["body"][number][] = [];
    for (const stmt of ctx.relationshipBodyStatement ?? []) {
      const node = this.visit(stmt) as RelationshipNode["body"][number];
      items.push(node);
    }
    return items;
  }

  relationshipBodyStatement(
    ctx: RelationshipBodyStatementCtx,
  ): RelationshipNode["body"][number] {
    const node =
      ctx.tagsStmt?.[0] ??
      ctx.tagStmt?.[0] ??
      ctx.urlStmt?.[0] ??
      ctx.propertiesBlock?.[0] ??
      ctx.perspectivesBlock?.[0];
    return this.visit(node!) as RelationshipNode["body"][number];
  }

  private stringFromToken(token: IToken): AstStringLiteral {
    return stringFromAnyToken(token, this.file);
  }

  /** Build a `StringLiteral` AST node for a value sourced from a
   *  pre-parse pass (e.g. archetype defaults) where no source token
   *  exists. The range points at the kind keyword so diagnostics still
   *  resolve to a real spot in the file. */
  private syntheticString(value: string, anchor: IToken): AstStringLiteral {
    return {
      kind: "string",
      value,
      range: rangeFromToken(anchor, this.file),
    };
  }

  /** Materialise archetype-body defaults (tags + properties +
   *  perspectives) as synthetic AST body statements anchored on the
   *  element's kind keyword. The toModel aggregation walks body items
   *  in order, so these go first and explicit body lines override
   *  them for singular keys. */
  private syntheticArchetypeBody(
    defaults: ArchetypeDefaults,
    anchor: IToken,
  ): ElementBodyNode[] {
    const range = rangeFromToken(anchor, this.file);
    const out: ElementBodyNode[] = [];
    if (defaults.tags.length > 0) {
      const tagsStmt: TagsStatement = {
        kind: "tags",
        value: this.syntheticString(defaults.tags.join(","), anchor),
        range,
      };
      out.push(tagsStmt);
    }
    const propEntries: PropertyEntry[] = [];
    for (const [k, v] of Object.entries(defaults.properties)) {
      propEntries.push({
        kind: "propertyEntry",
        key: this.syntheticString(k, anchor),
        value: this.syntheticString(v, anchor),
        range,
      });
    }
    if (propEntries.length > 0) {
      const propBlock: PropertiesBlock = {
        kind: "properties",
        entries: propEntries,
        range,
      };
      out.push(propBlock);
    }
    // Perspectives: defaults.perspectives map is keyed
    // `perspective.<name>` (description) plus
    // `perspective.<name>.value` (optional value). Reconstruct the
    // PerspectiveEntry list so toModel routes through its standard
    // perspectives handler.
    const perspectiveNames = new Set<string>();
    for (const k of Object.keys(defaults.perspectives)) {
      if (!k.startsWith("perspective.")) continue;
      const rest = k.slice("perspective.".length);
      if (rest.endsWith(".value")) continue;
      perspectiveNames.add(rest);
    }
    const perspectiveEntries: PerspectiveEntry[] = [];
    for (const name of perspectiveNames) {
      const description = defaults.perspectives[`perspective.${name}`];
      const valueKey = `perspective.${name}.value`;
      const hasValue = valueKey in defaults.perspectives;
      perspectiveEntries.push({
        kind: "perspectiveEntry",
        name: { kind: "identifier", name, range },
        description: this.syntheticString(description, anchor),
        value: hasValue
          ? this.syntheticString(defaults.perspectives[valueKey], anchor)
          : undefined,
        range,
      });
    }
    if (perspectiveEntries.length > 0) {
      const perspectivesBlock: PerspectivesBlock = {
        kind: "perspectives",
        entries: perspectiveEntries,
        range,
      };
      out.push(perspectivesBlock);
    }
    return out;
  }
}

interface WorkspaceFileCtx {
  readonly workspaceBlock: readonly [CstNode];
}

interface WorkspaceBlockCtx {
  readonly Workspace?: readonly [IToken];
  readonly name?: readonly [IToken];
  readonly description?: readonly [IToken];
  readonly extendsTarget?: readonly [IToken];
  readonly extendsTargetUrl?: readonly [IToken];
  readonly extendsTargetPath?: readonly [IToken];
  readonly modelBlock?: readonly CstNode[];
  readonly workspaceNameStmt?: readonly CstNode[];
  readonly workspaceDescriptionStmt?: readonly CstNode[];
  readonly directive?: readonly CstNode[];
  readonly LBrace?: readonly [IToken];
  readonly RBrace?: readonly [IToken];
}

interface ModelBlockCtx {
  readonly Model?: readonly [IToken];
  readonly LBrace?: readonly [IToken];
  readonly RBrace?: readonly [IToken];
  readonly modelBodyItem?: readonly CstNode[];
}

interface ModelBodyItemCtx {
  readonly elementDeclaration?: readonly [CstNode];
  readonly reopenDeclaration?: readonly [CstNode];
  readonly relationship?: readonly [CstNode];
  readonly directive?: readonly [CstNode];
  readonly propertiesBlock?: readonly [CstNode];
}

interface ReopenDeclarationCtx {
  readonly target: readonly [CstNode];
  readonly elementBody: readonly [CstNode];
}

interface ElementDeclarationCtx {
  readonly assignedIdentifier?: readonly [CstNode];
  readonly Equals?: readonly [IToken];
  readonly elementHeader: readonly [CstNode];
  readonly elementBody?: readonly [CstNode];
}

interface ElementHeaderCtx {
  readonly kind?: readonly [IToken];
  readonly Person?: readonly [IToken];
  readonly SoftwareSystem?: readonly [IToken];
  readonly Container?: readonly [IToken];
  readonly Component?: readonly [IToken];
  readonly Group?: readonly [IToken];
  readonly Element?: readonly [IToken];
  readonly name: readonly [IToken];
  readonly positional1?: readonly [IToken];
  readonly positional2?: readonly [IToken];
  readonly positional3?: readonly [IToken];
}

interface ElementBodyCtx {
  readonly LBrace: readonly [IToken];
  readonly RBrace: readonly [IToken];
  readonly bodyStatement?: readonly CstNode[];
  readonly elementDeclaration?: readonly CstNode[];
  readonly relationship?: readonly CstNode[];
}

interface BodyStatementCtx {
  readonly descriptionStmt?: readonly [CstNode];
  readonly technologyStmt?: readonly [CstNode];
  readonly tagsStmt?: readonly [CstNode];
  readonly tagStmt?: readonly [CstNode];
  readonly urlStmt?: readonly [CstNode];
  readonly propertiesBlock?: readonly [CstNode];
  readonly perspectivesBlock?: readonly [CstNode];
}

interface RelationshipCtx {
  readonly assignedIdentifier?: readonly [CstNode];
  readonly source?: readonly [CstNode];
  readonly sourceThis?: readonly [IToken];
  readonly destination?: readonly [CstNode];
  readonly destinationThis?: readonly [IToken];
  readonly arrow?: readonly IToken[];
  readonly Relationship?: readonly IToken[];
  readonly NoRelationship?: readonly IToken[];
  readonly description?: readonly [IToken];
  readonly technology?: readonly [IToken];
  readonly tags?: readonly [IToken];
  readonly relationshipBody?: readonly [CstNode];
}

interface RelationshipBodyCtx {
  readonly relationshipBodyStatement?: readonly CstNode[];
}

interface RelationshipBodyStatementCtx {
  readonly tagsStmt?: readonly [CstNode];
  readonly tagStmt?: readonly [CstNode];
  readonly urlStmt?: readonly [CstNode];
  readonly propertiesBlock?: readonly [CstNode];
  readonly perspectivesBlock?: readonly [CstNode];
}

export const buildAst = (cst: CstNode, file: string): WorkspaceNode => {
  const visitor = new StructurizrCstToAst();
  return visitor.buildAst(cst, file);
};
