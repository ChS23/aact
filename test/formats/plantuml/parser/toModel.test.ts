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
