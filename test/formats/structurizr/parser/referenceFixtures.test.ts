/**
 * Empirical compatibility check: run our chevrotain parser against
 * the actual Java reference DSL fixtures and assert that parseErrors
 * is empty and the resulting Model matches what the reference parser
 * would emit (number of elements, presence of key relationships).
 *
 * Fixtures live in `.parser-refs/java/structurizr-dsl/src/test/resources/dsl/`.
 * If `.parser-refs/` is not present (i.e. fetch-parser-refs.sh was
 * never run), the tests skip silently — we don't ship the upstream
 * Apache-2.0 sources.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseSource } from "../../../../src/formats/structurizr/parser";

const REF_DIR = path.resolve(
  __dirname,
  "../../../../.parser-refs/java/structurizr-dsl/src/test/resources/dsl",
);

const hasFixtures = (() => {
  try {
    return statSync(REF_DIR).isDirectory();
  } catch {
    return false;
  }
})();

const loadFixture = (name: string): string =>
  readFileSync(path.join(REF_DIR, name), "utf8");

const maybe = hasFixtures ? describe : describe.skip;

maybe("Structurizr parser — reference DSL fixtures", () => {
  it("parses getting-started.dsl cleanly and produces the expected Model", () => {
    const src = loadFixture("getting-started.dsl");
    const { model, parseErrors, opaqueBlocks } = parseSource(
      src,
      "getting-started.dsl",
    );
    expect(parseErrors).toEqual([]);
    // user + softwareSystem
    expect(model.elements["user"]?.kind).toBe("Person");
    expect(model.elements["softwareSystem"]?.kind).toBe("System");
    // single explicit relationship
    expect(model.elements["user"]?.relations).toEqual([
      expect.objectContaining({ to: "softwareSystem", description: "Uses" }),
    ]);
    // views block dropped via opaque strip
    expect(opaqueBlocks.some((b) => b.name === "views")).toBe(true);
  });

  it("parses multi-line.dsl with `\\` continuations", () => {
    const src = loadFixture("multi-line.dsl");
    const { parseErrors } = parseSource(src, "multi-line.dsl");
    expect(parseErrors).toEqual([]);
  });

  it("parses this.dsl with `this` keyword on source and destination", () => {
    const src = loadFixture("this.dsl");
    const { parseErrors } = parseSource(src, "this.dsl");
    expect(parseErrors).toEqual([]);
  });

  it("parses big-bank-plc.dsl with no parse errors", () => {
    const src = loadFixture("big-bank-plc.dsl");
    const { model, parseErrors, opaqueBlocks, infoBlocks } = parseSource(
      src,
      "big-bank-plc.dsl",
    );

    // The fixture mixes camelCase and lowercase keywords
    // (`softwareSystem` and `softwaresystem`), `group` blocks, deeply
    // nested elements (container > components), `#`-comments, plus a
    // deploymentEnvironment block and views/configuration. All should
    // strip or parse cleanly.
    if (parseErrors.length > 0) {
      console.log("big-bank-plc.dsl parseErrors:", parseErrors);
    }
    expect(parseErrors).toEqual([]);

    // Key people
    expect(model.elements["customer"]?.kind).toBe("Person");
    expect(model.elements["supportStaff"]?.kind).toBe("Person");
    expect(model.elements["backoffice"]?.kind).toBe("Person");

    // Leaf software systems (no nested children)
    expect(model.elements["mainframe"]?.kind).toBe("System");
    expect(model.elements["email"]?.kind).toBe("System");
    expect(model.elements["atm"]?.kind).toBe("System");

    // Internet Banking System has nested children → promoted to a
    // System Boundary
    expect(model.boundaries["internetBankingSystem"]).toBeDefined();
    expect(model.boundaries["internetBankingSystem"]?.kind).toBe("System");

    // API Application is a Container with nested Components → promoted
    // to a Container Boundary
    expect(model.boundaries["apiApplication"]).toBeDefined();
    expect(model.boundaries["apiApplication"]?.kind).toBe("Container");

    // Components inside API Application
    expect(model.elements["signinController"]?.kind).toBe("Component");
    expect(model.elements["securityComponent"]?.kind).toBe("Component");

    // Explicit relationship: customer → internet banking system
    const customer = model.elements["customer"];
    expect(customer?.relations.length).toBeGreaterThan(0);
    expect(customer?.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: "internetBankingSystem",
          description: "Views account balances, and makes payments using",
        }),
      ]),
    );

    // Only the user-authored tag survives — no implicit styling tags
    expect(customer?.tags).toEqual(["Customer"]);

    // group "Big Bank plc" stamps properties.group on its children
    expect(model.elements["supportStaff"]?.properties?.group).toBe(
      "Big Bank plc",
    );

    // Views, configuration, styles stripped as opaque
    expect(opaqueBlocks.map((b) => b.name)).toEqual(
      expect.arrayContaining(["views"]),
    );
    // deploymentEnvironment block surfaced as info-issue
    expect(
      infoBlocks.some((b) => b.construct === "deploymentEnvironment"),
    ).toBe(true);
  });
});
