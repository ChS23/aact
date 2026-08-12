import { parseSource } from "../../../../src/formats/plantuml/parser";
import { c4PumlParser } from "../../../../src/formats/plantuml/parser/parser";
import { preParse } from "../../../../src/formats/plantuml/parser/preParse";
import { C4PumlLexer } from "../../../../src/formats/plantuml/parser/tokens";
import { toModel } from "../../../../src/formats/plantuml/parser/toModel";
import { buildAst } from "../../../../src/formats/plantuml/parser/visitor";

const FILE = "test.puml";

const lower = (src: string) => {
  const { text } = preParse(src, FILE);
  const lex = C4PumlLexer.tokenize(text);
  c4PumlParser.input = lex.tokens;
  const cst = c4PumlParser.pumlFile();
  const ast = buildAst(cst, FILE);
  return toModel(ast);
};

describe("PUML toModel — element macros → Container", () => {
  it("Container(alias, label, techn, descr) populates Model.elements", () => {
    const src = `@startuml\nContainer(api, "API", "Node.js", "REST gateway")\n@enduml\n`;
    const { model, issues } = lower(src);
    expect(issues).toEqual([]);
    const c = model.elements["api"];
    expect(c).toBeDefined();
    expect(c).toMatchObject({
      name: "api",
      label: "API",
      kind: "Container",
      external: false,
      technology: "Node.js",
      description: "REST gateway",
      tags: [],
    });
    expect(c.sourceLocation?.file).toBe(FILE);
  });

  it("Container_Ext sets external=true on base kind", () => {
    const src = `@startuml\nContainer_Ext(ext, "External")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["ext"]).toMatchObject({
      kind: "Container",
      external: true,
    });
  });

  it("ContainerDb maps to ContainerDb kind", () => {
    const src = `@startuml\nContainerDb(db, "Database")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["db"].kind).toBe("ContainerDb");
  });

  it("SystemDb preserves original C4 shape as metadata", () => {
    const src = `@startuml\nSystemDb(catalog, "Catalog DB")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["catalog"]).toMatchObject({
      kind: "System",
      properties: { "plantuml.macro": "SystemDb" },
    });
  });

  it("Context family uses $type for technology (not $techn)", () => {
    // grammar.md: Person/System/etc. have no $techn slot; $type carries it.
    const src = `@startuml\nPerson(alice, "Alice", "A user", $type="developer")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["alice"]).toMatchObject({
      kind: "Person",
      technology: "developer",
      description: "A user",
    });
  });

  it("Container family uses $techn for technology", () => {
    const src = `@startuml\nContainer(api, "API", $techn="Java 17")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["api"].technology).toBe("Java 17");
  });

  it("$tags parses CSV-style and plus-style", () => {
    const src = `@startuml\nContainer(api, "API", $tags="async,api")\nContainer(svc, "Svc", $tags="alpha+beta")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["api"].tags).toEqual(["async", "api"]);
    expect(model.elements["svc"].tags).toEqual(["alpha", "beta"]);
  });

  it("$link and $sprite populate Container.link / Container.sprite", () => {
    const src = `@startuml\nContainer(api, "API", $link="https://x", $sprite="logo")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["api"].link).toBe("https://x");
    expect(model.elements["api"].sprite).toBe("logo");
  });
});

describe("PUML toModel — relation macros → Container.relations", () => {
  it("Rel(a, b, label, techn) pushes Relation onto source's relations[]", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRel(a, b, "calls", "HTTPS")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["a"].relations).toHaveLength(1);
    expect(model.elements["a"].relations[0]).toMatchObject({
      to: "b",
      description: "calls",
      technology: "HTTPS",
    });
  });

  it("keeps official Rel descr slot separate from tags", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRel(a, b, "calls", "HTTPS", "Opens dashboard")\n@enduml\n`;
    const { model } = lower(src);
    const rel = model.elements["a"].relations[0];
    expect(rel.tags).toEqual([]);
    expect(rel.properties?.["plantuml.descr"]).toBe("Opens dashboard");
  });

  it("Rel_Back(a, b) emits a Relation FROM b TO a (semantic swap)", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRel_Back(a, b, "answers to")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["a"].relations).toHaveLength(0);
    expect(model.elements["b"].relations).toHaveLength(1);
    expect(model.elements["b"].relations[0].to).toBe("a");
  });

  it("BiRel(a, b) emits TWO Relations (one each direction)", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nBiRel(a, b, "syncs")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["a"].relations.map((r) => r.to)).toEqual(["b"]);
    expect(model.elements["b"].relations.map((r) => r.to)).toEqual(["a"]);
  });

  it("RelIndex first positional becomes Relation.order", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRelIndex("3", a, b, "calls")\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["a"].relations[0].order).toBe(3);
  });

  it("$index=N on plain Rel populates Relation.order", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRel(a, b, "calls", $index=2)\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["a"].relations[0].order).toBe(2);
  });

  it("$index=Index() (sentinel call) leaves order undefined", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRel(a, b, "calls", $index=Index())\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["a"].relations[0].order).toBeUndefined();
  });

  it("dangling relation source emits warning without manufacturing a placeholder", () => {
    const src = `@startuml\nContainer(b, "B")\nRel(missing, b, "calls")\n@enduml\n`;
    const { model, issues } = lower(src);
    expect(model.elements["missing"]).toBeUndefined();
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "loader-warning",
        source: "plantuml",
        code: "relationship-source-not-resolved",
        element: "missing",
      }),
    );
  });
});

describe("PUML toModel — boundaries", () => {
  it("System_Boundary with nested Container produces Boundary + elementNames", () => {
    const src = `@startuml\nSystem_Boundary(b, "Bank") {\n  Container(api, "API")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"]).toMatchObject({
      name: "b",
      label: "Bank",
      kind: "System",
      elementNames: ["api"],
      boundaryNames: [],
    });
    expect(model.rootBoundaryNames).toEqual(["b"]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("Container_Boundary maps to BoundaryKind.Container", () => {
    const src = `@startuml\nContainer_Boundary(b, "API") {\n  Component(c, "Sign In")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"].kind).toBe("Container");
  });

  it("Enterprise_Boundary maps to BoundaryKind.Enterprise", () => {
    const src = `@startuml\nEnterprise_Boundary(e, "Co") {\n  System(s, "S")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["e"].kind).toBe("Enterprise");
  });

  it("generic Boundary($type=...) sets kind from $type", () => {
    const src = `@startuml\nBoundary(b, "B", $type="Container") {\n  Component(c, "C")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"].kind).toBe("Container");
  });

  it("nested boundaries populate boundaryNames and rootBoundaryNames", () => {
    const src = `@startuml\nSystem_Boundary(outer, "Outer") {\n  Container_Boundary(inner, "Inner") {\n    Container(api, "API")\n  }\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.rootBoundaryNames).toEqual(["outer"]);
    expect(model.boundaries["outer"].boundaryNames).toEqual(["inner"]);
    expect(model.boundaries["inner"].elementNames).toEqual(["api"]);
  });
});

describe("PUML toModel — SourceLocation fidelity", () => {
  it("Container.sourceLocation start.offset matches original .puml position", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const expected = src.indexOf("Container");
    const { model } = lower(src);
    expect(model.elements["api"].sourceLocation?.start.offset).toBe(expected);
  });

  it("Boundary.sourceLocation spans `{` ... `}` block", () => {
    const src = `@startuml\nSystem_Boundary(b, "B") {\n  Container(api, "API")\n}\n@enduml\n`;
    const startExpected = src.indexOf("System_Boundary");
    const endExpected = src.indexOf("}", startExpected) + 1;
    const loc = lower(src).model.boundaries["b"].sourceLocation;
    expect(loc?.start.offset).toBe(startExpected);
    expect(loc?.end.offset).toBe(endExpected);
  });

  it("Relation.sourceLocation points at the Rel(...) call", () => {
    const src = `@startuml\nContainer(a, "A")\nContainer(b, "B")\nRel(a, b, "calls")\n@enduml\n`;
    const expected = src.indexOf("Rel(");
    const { model } = lower(src);
    expect(model.elements["a"].relations[0].sourceLocation?.start.offset).toBe(
      expected,
    );
  });
});

describe("PUML toModel — real-world fixture flavour", () => {
  it("loads bigbankplc-context shape (Person + System + System_Ext + Rel/Rel_Back)", () => {
    const src = `@startuml
LAYOUT_WITH_LEGEND()

title System Context diagram

Person(customer, "Personal Banking Customer", "A customer of the bank.")
System(banking_system, "Internet Banking System", "Allows customers to view information.")

System_Ext(mail_system, "E-mail system", "Internal MS Exchange.")
System_Ext(mainframe, "Mainframe Banking System", "Stores core info.")

Rel(customer, banking_system, "Uses")
Rel_Back(customer, mail_system, "Sends e-mails to")
Rel_Neighbor(banking_system, mail_system, "Sends e-mails", "SMTP")
Rel(banking_system, mainframe, "Uses")
@enduml
`;
    const { model, issues } = lower(src);
    expect(issues).toEqual([]);
    expect(Object.keys(model.elements).sort()).toEqual([
      "banking_system",
      "customer",
      "mail_system",
      "mainframe",
    ]);
    // Rel_Back(customer, mail_system) → mail_system → customer
    expect(model.elements["mail_system"].relations[0].to).toBe("customer");
    expect(model.elements["mail_system"].external).toBe(true);
  });
});

describe("PUML toModel — argString edge cases", () => {
  it("element with no label leaves Element.label empty (missing positional)", () => {
    // `Container(api)` — only the alias positional is present, so
    // argString(positionals[1]) receives `undefined` and returns
    // undefined; buildElement coalesces label to "".
    const src = `@startuml\nContainer(api)\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["api"]).toMatchObject({
      name: "api",
      label: "",
    });
  });

  it("function-call sprite value does not survive to Element.sprite", () => {
    // `$sprite=RoundedBoxShape()` is a FunctionCallValue; argString
    // returns undefined for it, so the sprite never lands on Model.
    const src = `@startuml\nContainer(api, "API", $sprite=RoundedBoxShape())\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["api"].sprite).toBeUndefined();
  });

  it("function-call positional tags value does not survive to Element.tags", () => {
    // Positional sprite slot carrying a function call (e.g. a sprite
    // factory) — argString returns undefined, so tags stay empty.
    const src = `@startuml\nPerson(alice, "Alice", "user", Robot())\n@enduml\n`;
    const { model } = lower(src);
    expect(model.elements["alice"].sprite).toBeUndefined();
  });
});

describe("PUML toModel — generic Boundary $type decoding", () => {
  it("generic Boundary($type=Enterprise) decodes kind Enterprise", () => {
    const src = `@startuml\nBoundary(b, "B", $type="Enterprise") {\n  System(s, "S")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"].kind).toBe("Enterprise");
  });

  it("generic Boundary($type=Component) decodes kind Component", () => {
    const src = `@startuml\nBoundary(b, "B", $type="Component") {\n  Component(c, "C")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"].kind).toBe("Component");
  });

  it("generic Boundary with positional $type (no named arg) decodes kind", () => {
    // Positional `$type` slot at index 2 for the generic Boundary
    // macro — exercises the typeIdx>=0 positional fallback.
    const src = `@startuml\nBoundary(b, "B", "Enterprise") {\n  System(s, "S")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"].kind).toBe("Enterprise");
  });

  it("generic Boundary with unknown $type falls back to System kind", () => {
    const src = `@startuml\nBoundary(b, "B", $type="Whatever") {\n  System(s, "S")\n}\n@enduml\n`;
    const { model } = lower(src);
    expect(model.boundaries["b"].kind).toBe("System");
  });
});

describe("PUML toModel — attachPropertiesToModel boundary branch", () => {
  it("attaches AddProperty rows preceding a boundary to Boundary.properties", () => {
    // AddProperty rows attach to the next in-scope macro; here the
    // next macro is a System_Boundary, so the boundary loop in
    // attachPropertiesToModel picks them up.
    const src = [
      "@startuml",
      'AddProperty("owner", "platform-team")',
      'AddProperty("zone", "trusted")',
      'System_Boundary(bank, "Bank") {',
      '  Container(api, "API")',
      "}",
      "@enduml",
      "",
    ].join("\n");
    const { model } = parseSource(src, FILE);
    expect(model.boundaries["bank"].properties).toMatchObject({
      owner: "platform-team",
      zone: "trusted",
    });
  });

  it("leaves boundaries without attached rows untouched while another picks props up", () => {
    // Two boundaries: only the first carries AddProperty rows. The
    // second exercises the `else` branch (boundary with no attached
    // properties) inside attachPropertiesToModel.
    const src = [
      "@startuml",
      'AddProperty("owner", "team-a")',
      'System_Boundary(b1, "First") {',
      '  Container(api, "API")',
      "}",
      'System_Boundary(b2, "Second") {',
      '  Container(web, "Web")',
      "}",
      "@enduml",
      "",
    ].join("\n");
    const { model } = parseSource(src, FILE);
    expect(model.boundaries["b1"].properties).toMatchObject({
      owner: "team-a",
    });
    // Second boundary untouched — no synthetic properties attached.
    expect(model.boundaries["b2"].properties?.["owner"]).toBeUndefined();
  });
});

describe("PUML toModel — simple constants substitution in argString", () => {
  it("resolves a !define constant used as a bare arg value", () => {
    // bareToken value resolves through the constants map (argString
    // constants?.get branch); end-to-end via parseSource which wires
    // simpleConstants into toModel.
    const src = [
      "@startuml",
      '!define TAG_CRIT "critical"',
      'Container(api, "API", $tags=TAG_CRIT)',
      "@enduml",
      "",
    ].join("\n");
    const { model } = parseSource(src, FILE);
    expect(model.elements["api"].tags).toEqual(["critical"]);
  });
});
