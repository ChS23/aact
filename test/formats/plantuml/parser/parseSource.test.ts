import fs from "node:fs";
import path from "node:path";

import { parseSource } from "../../../../src/formats/plantuml/parser";

const FILE = "test.puml";

describe("parseSource — full pipeline", () => {
  it("returns clean model + empty errors for a minimal sample", () => {
    const src = `@startuml\nContainer(api, "API")\n@enduml\n`;
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.preParseIssues).toEqual([]);
    expect(result.model.elements["api"]).toBeDefined();
  });

  it("strips !include + LAYOUT macros silently (no parse errors)", () => {
    const src = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
LAYOUT_WITH_LEGEND()
title Container diagram

Container(api, "API")
@enduml
`;
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.elements["api"]).toBeDefined();
  });

  it("resolves simple !$var and !define constants in C4 arguments", () => {
    const src = `@startuml
!$combinedSprite="person2,scale=0.5"
!define TAG_CRITICAL "critical"
Container(api, "API", $sprite=$combinedSprite, $tags=TAG_CRITICAL)
@enduml`;
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.elements["api"]?.sprite).toBe("person2,scale=0.5");
    expect(result.model.elements["api"]?.tags).toEqual(["critical"]);
  });

  it("surfaces preParseIssue when a Deployment_Node is encountered", () => {
    const src = `@startuml\nDeployment_Node(prod, "Prod") {\n  Container(api, "API")\n}\nPerson(c, "C")\n@enduml\n`;
    const result = parseSource(src, FILE);
    expect(result.preParseIssues).toHaveLength(1);
    expect(result.preParseIssues[0].kind).toBe("info");
    expect(result.preParseIssues[0].message).toMatch(/Deployment/);
    // The deployment-wrapped Container is gone; the standalone Person remains.
    expect(result.model.elements["api"]).toBeUndefined();
    expect(result.model.elements["c"]).toBeDefined();
  });

  it("trims subsequent @startuml diagrams with info-issue", () => {
    const src = `@startuml\nContainer(a, "A")\n@enduml\n@startuml\nContainer(b, "B")\n@enduml\n`;
    const result = parseSource(src, FILE);
    expect(result.preParseIssues.map((i) => i.message)).toEqual([
      expect.stringMatching(/Multiple/),
    ]);
    expect(result.model.elements["a"]).toBeDefined();
    expect(result.model.elements["b"]).toBeUndefined();
  });

  it("preserves SourceLocation across the full pipeline", () => {
    const src = `@startuml
!include "C4_Container.puml"
LAYOUT_WITH_LEGEND()
Container(api, "API")
@enduml
`;
    const expected = src.indexOf("Container(api");
    const { model } = parseSource(src, FILE);
    expect(model.elements["api"].sourceLocation?.start.offset).toBe(expected);
    expect(model.elements["api"].sourceLocation?.file).toBe(FILE);
  });
});

describe("parseSource — canonical fixtures from .parser-refs/C4-PlantUML/samples", () => {
  const fixturesDir = path.join(
    __dirname,
    "../../../../.parser-refs/C4-PlantUML/samples",
  );

  const readFixture = (filename: string): string =>
    fs.readFileSync(path.join(fixturesDir, filename), "utf8");

  it("bigbankplc context: 4 containers, 4 relations, 0 parse errors", () => {
    const src = readFixture("C4_Context Diagram Sample - bigbankplc.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(Object.keys(result.model.elements).sort()).toEqual([
      "banking_system",
      "customer",
      "mail_system",
      "mainframe",
    ]);
    // Rel_Back(customer, mail_system) → mail_system → customer
    expect(result.model.elements["mail_system"].relations[0]?.to).toBe(
      "customer",
    );
  });

  it("bigbankplc container: System_Boundary with 5 children + standalone systems", () => {
    const src = readFixture("C4_Container Diagram Sample - bigbankplc.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.rootBoundaryNames).toEqual(["c1"]);
    expect(result.model.boundaries["c1"].elementNames.length).toBe(5);
    // External systems are siblings of the boundary, not inside it.
    expect(result.model.elements["email_system"].external).toBe(true);
    expect(result.model.elements["banking_system"].external).toBe(true);
  });

  it("techtribesjs: Lay_R does NOT produce a relation", () => {
    const src = readFixture("C4_Container Diagram Sample - techtribesjs.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    // Lay_R(rel_db, filesystem) — layout hint, no relation.
    expect(result.model.elements["rel_db"].relations).toEqual([]);
  });

  it("bigbankplc component: Container_Boundary with 4 Components + internal Rels", () => {
    const src = readFixture("C4_Component Diagram Sample - bigbankplc.puml");
    const result = parseSource(src, FILE);
    expect(result.parseErrors).toEqual([]);
    expect(result.model.boundaries["api"].kind).toBe("Container");
    expect([...result.model.boundaries["api"].elementNames].sort()).toEqual([
      "accounts",
      "mbsfacade",
      "security",
      "sign",
    ]);
    // sign → security relation declared inside the boundary block.
    const signRels = result.model.elements["sign"].relations.map((r) => r.to);
    expect(signRels).toEqual(["security"]);
  });

  // Full reference corpus pass — every in-scope static fixture must
  // produce a populated Model with zero parse errors. Out-of-scope
  // fixtures (deployment, sequence, old-format Dynamic) are excluded
  // because aact's Model is C4 static + dynamic relations, not
  // deployment topology.
  const IN_SCOPE_FIXTURES: readonly string[] = [
    "C4_Component Diagram Sample - bigbankplc.puml",
    "C4_Container Diagram Sample - bigbankplc-icons.puml",
    "C4_Container Diagram Sample - bigbankplc-styles.puml",
    "C4_Container Diagram Sample - bigbankplc-themes.puml",
    "C4_Container Diagram Sample - bigbankplc.puml",
    "C4_Container Diagram Sample - message bus.puml",
    "C4_Container Diagram Sample - techtribesjs.puml",
    "C4_Context Diagram Sample - bigbankplc-landscape.puml",
    "C4_Context Diagram Sample - bigbankplc.puml",
    "C4_Context Diagram Sample - enterprise.puml",
    "C4_Dynamic Diagram Sample - bigbankplc.puml",
    "C4_Dynamic Diagram Sample - message bus.puml",
  ];

  it.each(IN_SCOPE_FIXTURES)(
    "loads %s with zero parse errors and a populated Model",
    (filename) => {
      const src = readFixture(filename);
      const result = parseSource(src, FILE);
      expect(result.parseErrors).toEqual([]);
      expect(Object.keys(result.model.elements).length).toBeGreaterThan(0);
    },
  );

  const DEPLOYMENT_FIXTURES: readonly string[] = [
    "C4_Deployment Diagram Sample - bigbankplc-details.puml",
    "C4_Deployment Diagram Sample - bigbankplc.puml",
  ];

  it.each(DEPLOYMENT_FIXTURES)(
    "out-of-scope deployment fixture %s emits preParse warning",
    (filename) => {
      const src = readFixture(filename);
      const result = parseSource(src, FILE);
      expect(result.parseErrors).toEqual([]);
      expect(result.preParseIssues.length).toBeGreaterThan(0);
      expect(result.preParseIssues[0]?.message).toMatch(/Deployment/);
    },
  );

  // The two out-of-scope fixtures are pinned as "expected to fail" so
  // a regression in scope is visible (if a sequence fixture suddenly
  // starts passing, somebody added sequence grammar without a
  // grammar.md update).
  const OUT_OF_SCOPE_FIXTURES: readonly string[] = [
    "C4_Sequence Diagram Sample - bigbankplc.puml",
    "C4_Sequence Diagram Sample - complex.puml",
    "C4_Dynamic Diagram Sample - message bus - old format.puml",
  ];

  it.each(OUT_OF_SCOPE_FIXTURES)(
    "out-of-scope fixture %s produces parse errors but does not throw",
    (filename) => {
      const src = readFixture(filename);
      const result = parseSource(src, FILE);
      expect(result.parseErrors.length).toBeGreaterThan(0);
    },
  );

  // Backslash-continuation preprocessor — pinned as known gap. The
  // `!define LONG_MACRO(x) \\\n body` form leaks the continuation
  // line into the parser, which surfaces parse errors without
  // crashing. Tests both behaviours so a future fix or regression
  // is loud.
  it("multi-line preprocessor with backslash continuation surfaces parse errors (known gap)", () => {
    const src = String.raw`@startuml
!define LONG_MACRO(x) \
  x + 1
Container(api, "API")
@enduml
`;
    const result = parseSource(src, FILE);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    // Despite the parse error, the parser recovers and the in-scope
    // Container survives.
    expect(result.model.elements["api"]).toBeDefined();
  });
});
