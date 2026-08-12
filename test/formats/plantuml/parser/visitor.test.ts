import { c4PumlParser } from "../../../../src/formats/plantuml/parser/parser";
import { preParse } from "../../../../src/formats/plantuml/parser/preParse";
import { C4PumlLexer } from "../../../../src/formats/plantuml/parser/tokens";
import { buildAst } from "../../../../src/formats/plantuml/parser/visitor";

const FILE = "test.puml";

const parse = (src: string) => {
  const { text } = preParse(src, FILE);
  const lex = C4PumlLexer.tokenize(text);
  c4PumlParser.input = lex.tokens;
  const cst = c4PumlParser.pumlFile();
  return {
    ast: buildAst(cst, FILE),
    lexErrors: lex.errors,
    parseErrors: c4PumlParser.errors,
  };
};

describe("PUML visitor — CST → AST", () => {
  it("builds FileNode with one diagram from a minimal sample", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    expect(ast.kind).toBe("file");
    expect(ast.diagrams).toHaveLength(1);
    const diagram = ast.diagrams[0];
    expect(diagram.statements).toHaveLength(1);
    expect(diagram.statements[0].kind).toBe("elementMacro");
  });

  it("captures @startuml quoted name", () => {
    const src = `@startuml "techtribesjs"\nContainer(api, "API")\n@enduml\n`;
    const { ast } = parse(src);
    expect(ast.diagrams[0].name?.value).toBe("techtribesjs");
    expect(ast.diagrams[0].name?.form).toBe("string");
  });

  it("captures @startuml names with spaces and dashes without lex noise", () => {
    const src = `@startuml custom-rules demo\nContainer(api, "API")\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    expect(ast.diagrams[0].name?.value).toBe("custom-rules demo");
  });

  it("element macro positionals retain order — alias, label, techn, descr", () => {
    const src = `@startuml\nContainer(api, "API", "Node.js", "REST gateway")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.macroName).toBe("Container");
    expect(stmt.positionals).toHaveLength(4);
    expect(stmt.positionals[0]).toMatchObject({
      kind: "bareToken",
      value: "api",
    });
    expect(stmt.positionals[1]).toMatchObject({ kind: "string", value: "API" });
    expect(stmt.positionals[2]).toMatchObject({
      kind: "string",
      value: "Node.js",
    });
    expect(stmt.positionals[3]).toMatchObject({
      kind: "string",
      value: "REST gateway",
    });
  });

  it("named args ($tags, $link, $sprite) land in namedArgs bucket", () => {
    const src = `@startuml\nContainer(api, "API", $tags="async,api", $link="https://x", $sprite="logo")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.positionals).toHaveLength(2); // alias + label only
    expect(stmt.namedArgs).toHaveLength(3);
    const byName = Object.fromEntries(stmt.namedArgs.map((a) => [a.name, a]));
    expect(byName.tags.value).toMatchObject({
      kind: "string",
      value: "async,api",
    });
    expect(byName.link.value).toMatchObject({
      kind: "string",
      value: "https://x",
    });
    expect(byName.sprite.value).toMatchObject({
      kind: "string",
      value: "logo",
    });
  });

  it("accepts PUML variable references as named argument values", () => {
    const src = `@startuml\nPerson(p, "", $sprite=$img)\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.namedArgs[0]).toMatchObject({
      name: "sprite",
      value: { kind: "bareToken", value: "$img" },
    });
  });

  it("accepts single-quoted strings used by PlantUML examples", () => {
    const src = `@startuml\nSystem_Boundary(c1, 'Sample') {\n  Container(api, 'API')\n}\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    const boundary = ast.diagrams[0].statements[0];
    if (boundary.kind !== "boundaryMacro")
      throw new Error("expected boundaryMacro");
    expect(boundary.positionals[1]).toMatchObject({
      kind: "string",
      value: "Sample",
    });
  });

  it("accepts exact C4 macro keywords as bare aliases", () => {
    const src = `@startuml\nComponent(Component, "Component")\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.positionals[0]).toMatchObject({
      kind: "bareToken",
      value: "Component",
    });
  });

  it("unknown named args land in unknownNamedArgs bucket (round-trip preservation)", () => {
    const src = `@startuml\nContainer(api, "API", $futureFlag="x")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    expect(stmt.namedArgs).toEqual([]);
    expect(stmt.unknownNamedArgs).toHaveLength(1);
    expect(stmt.unknownNamedArgs[0].name).toBe("futureFlag");
  });

  it("inline function-call value (`$index=Index()`) becomes FunctionCallValue node", () => {
    const src = `@startuml\nRel(a, b, "calls", $index=Index())\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.namedArgs).toHaveLength(1);
    const indexArg = stmt.namedArgs[0];
    expect(indexArg.name).toBe("index");
    expect(indexArg.value.kind).toBe("functionCallValue");
    if (indexArg.value.kind === "functionCallValue") {
      expect(indexArg.value.functionName).toBe("Index");
    }
  });

  it("RelIndex first positional becomes indexPositional, rest shift down", () => {
    const src = `@startuml\nRelIndex("1", a, b, "calls")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.macroName).toBe("RelIndex");
    expect(stmt.indexPositional).toMatchObject({ kind: "string", value: "1" });
    expect(stmt.positionals).toHaveLength(3); // a, b, label
    expect(stmt.positionals[0]).toMatchObject({
      kind: "bareToken",
      value: "a",
    });
  });

  it("BiRel macro carries bidirectional=true flag", () => {
    const src = `@startuml\nBiRel(a, b, "syncs")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.bidirectional).toBe(true);
    expect(stmt.macroName).toBe("BiRel");
  });

  it("Rel_Back_Neighbor decodes back=true + neighbor=true", () => {
    const src = `@startuml\nRel_Back_Neighbor(a, b, "calls")\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "relationMacro")
      throw new Error("expected relationMacro");
    expect(stmt.back).toBe(true);
    expect(stmt.neighbor).toBe(true);
    expect(stmt.macroName).toBe("Rel_Back_Neighbor");
  });

  it("System_Boundary with nested Container produces boundaryMacro with one child", () => {
    const src = `@startuml\nSystem_Boundary(b, "Bank") {\n  Container(api, "API")\n}\n@enduml\n`;
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "boundaryMacro")
      throw new Error("expected boundaryMacro");
    expect(stmt.macroName).toBe("System_Boundary");
    expect(stmt.children).toHaveLength(1);
    expect(stmt.children[0].kind).toBe("elementMacro");
  });

  it("preserves SourceLocation — start offset of Container matches source", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const expectedOffset = src.indexOf("Container");
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    expect(stmt.range.file).toBe(FILE);
    expect(stmt.range.start.offset).toBe(expectedOffset);
    // Line 2, col 1 (1-based)
    expect(stmt.range.start.line).toBe(2);
    expect(stmt.range.start.col).toBe(1);
  });

  it("preserves offsets through preParse strip — Container after stripped !include", () => {
    const src = `@startuml\n!include https://example/C4_Container.puml\nLAYOUT_WITH_LEGEND()\nContainer(api, "API")\n@enduml\n`;
    const expectedOffset = src.indexOf("Container(");
    const { ast } = parse(src);
    const stmt = ast.diagrams[0].statements[0];
    expect(stmt.range.start.offset).toBe(expectedOffset);
  });

  it("resolves all backslash escapes inside a string literal", () => {
    // One label exercises every branch of `unwrapStringLiteral`:
    // \t → tab, \r → CR, \" → quote, \\ → backslash, \z → default (z).
    const src = String.raw`@startuml
Container(api, "a\tb\rc\"d\\e\zf")
@enduml
`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    const label = stmt.positionals[1];
    if (label.kind !== "string") throw new Error("expected string literal");
    // \t→tab, \r→CR, \"→quote, \\→backslash, \z→z (default branch).
    expect(label.value).toBe('a\tb\rc"d\\ezf');
  });

  it("diagramName on its own line — quoted string form (separate token)", () => {
    // `@startuml` line is bare; the quoted name lands as a standalone
    // StringLiteral consumed by the `diagramName` rule (not the
    // `@startuml <name>` same-line form handled by the lexer token).
    const src = `@startuml\n"My Diagram"\nContainer(api, "API")\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    expect(ast.diagrams[0].name).toMatchObject({
      kind: "diagramName",
      value: "My Diagram",
      form: "string",
    });
  });

  it("diagramName on its own line — bare identifier form (separate token)", () => {
    const src = `@startuml\nMyDiagram\nContainer(api, "API")\n@enduml\n`;
    const { ast, lexErrors, parseErrors } = parse(src);
    expect(lexErrors).toEqual([]);
    expect(parseErrors).toEqual([]);
    expect(ast.diagrams[0].name).toMatchObject({
      kind: "diagramName",
      value: "MyDiagram",
      form: "identifier",
    });
  });

  it("empty named-arg value recovers to an empty bareToken", () => {
    // `$tags=` with nothing after `=` makes chevrotain recover with an
    // empty `argValue` CST node. The visitor must still produce a
    // bareToken (value "") rather than throw — and `cstRange` on the
    // childless node falls back to its 1:1 placeholder location.
    const src = `@startuml\nContainer(api, $tags=)\n@enduml\n`;
    const { ast, parseErrors } = parse(src);
    // Error recovery means a parse error is expected here.
    expect(parseErrors.length).toBeGreaterThan(0);
    const stmt = ast.diagrams[0].statements[0];
    if (stmt.kind !== "elementMacro") throw new Error("expected elementMacro");
    const tags = stmt.namedArgs.find((a) => a.name === "tags");
    expect(tags).toBeDefined();
    expect(tags!.value).toMatchObject({ kind: "bareToken", value: "" });
    // Placeholder range from the empty-token `cstRange` fallback.
    expect(tags!.value.range.start).toMatchObject({
      line: 1,
      col: 1,
      offset: 0,
    });
  });
});

// ── Defensive branches ────────────────────────────────────────────
//
// These code paths are unreachable through the chevrotain grammar
// (the keyword→macro maps are exhaustive over the grammar's keyword
// alternatives, and a real CST keyword node always holds one token).
// They guard against a future grammar/visitor drift. We exercise them
// by feeding `buildAst` a hand-crafted CST that the parser itself
// would never emit, asserting the documented throw / fallback.

type FakeToken = {
  image: string;
  tokenType: { name: string };
  startLine: number;
  startColumn: number;
  startOffset: number;
  endLine: number;
  endColumn: number;
  endOffset: number;
};

const fakeToken = (name: string, image: string): FakeToken => ({
  image,
  tokenType: { name },
  startLine: 1,
  startColumn: 1,
  startOffset: 0,
  endLine: 1,
  endColumn: Math.max(1, image.length),
  endOffset: Math.max(0, image.length - 1),
});

const fakeRule = (name: string, children: Record<string, unknown[]>) => ({
  name,
  children,
});

const diagramWith = (statement: unknown) =>
  fakeRule("pumlFile", {
    diagram: [
      fakeRule("diagram", {
        StartUml: [fakeToken("StartUml", "@startuml")],
        EndUml: [fakeToken("EndUml", "@enduml")],
        statement: [statement],
      }),
    ],
  });

describe("PUML visitor — defensive branches via hand-crafted CST", () => {
  it("firstChildToken throws when a keyword node has no token children", () => {
    const elementCall = fakeRule("elementCall", {
      elementKeyword: [fakeRule("elementKeyword", {})],
      argList: [fakeRule("argList", {})],
    });
    const cst = diagramWith(
      fakeRule("statement", { elementCall: [elementCall] }),
    );
    expect(() => buildAst(cst as never, FILE)).toThrow(
      /No child token found in CST node "elementKeyword"/,
    );
  });

  it("elementCall throws on an unmapped element keyword token", () => {
    const elementCall = fakeRule("elementCall", {
      elementKeyword: [
        fakeRule("elementKeyword", { Bogus: [fakeToken("Bogus", "Bogus")] }),
      ],
      argList: [fakeRule("argList", {})],
    });
    const cst = diagramWith(
      fakeRule("statement", { elementCall: [elementCall] }),
    );
    expect(() => buildAst(cst as never, FILE)).toThrow(
      /Unknown element keyword token "Bogus"/,
    );
  });

  it("boundaryCall throws on an unmapped boundary keyword token", () => {
    const boundaryCall = fakeRule("boundaryCall", {
      boundaryKeyword: [
        fakeRule("boundaryKeyword", { Bogus: [fakeToken("Bogus", "Bogus")] }),
      ],
      argList: [fakeRule("argList", {})],
    });
    const cst = diagramWith(
      fakeRule("statement", { boundaryCall: [boundaryCall] }),
    );
    expect(() => buildAst(cst as never, FILE)).toThrow(
      /Unknown boundary keyword token "Bogus"/,
    );
  });

  it("relationCall throws on an unmapped relation keyword token", () => {
    const relationCall = fakeRule("relationCall", {
      relationKeyword: [
        fakeRule("relationKeyword", { Bogus: [fakeToken("Bogus", "Bogus")] }),
      ],
      argList: [fakeRule("argList", {})],
    });
    const cst = diagramWith(
      fakeRule("statement", { relationCall: [relationCall] }),
    );
    expect(() => buildAst(cst as never, FILE)).toThrow(
      /Unknown relation keyword token "Bogus"/,
    );
  });

  it("statement with no recognized child is silently dropped (undefined)", () => {
    const cst = diagramWith(fakeRule("statement", {}));
    const ast = buildAst(cst as never, FILE);
    expect(ast.diagrams[0].statements).toEqual([]);
  });
});
