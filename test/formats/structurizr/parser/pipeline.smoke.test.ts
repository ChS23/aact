import { parseSource } from "../../../../src/formats/structurizr/parser";

describe("Structurizr parser pipeline (CST → AST → Model)", () => {
  it("produces an empty Model from an empty workspace+model", () => {
    const { model, parseErrors } = parseSource(
      `workspace { model {} }`,
      "in-memory.dsl",
    );
    expect(parseErrors).toEqual([]);
    expect(Object.keys(model.elements)).toEqual([]);
    expect(Object.keys(model.boundaries)).toEqual([]);
  });

  it("emits a Container for `person` and `softwareSystem` (no nested children)", () => {
    const src = `workspace {
      model {
        customer = person "Customer"
        mainframe = softwareSystem "Mainframe Banking"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.elements["customer"]?.kind).toBe("Person");
    expect(model.elements["mainframe"]?.kind).toBe("System");
  });

  it("promotes softwareSystem with nested containers to a System boundary", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Internet Banking" {
          web = container "Web App" "Web UI" "Java"
          api = container "API" "API Application" "Node.js"
        }
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    // Bank promoted to Boundary; its children are Containers.
    expect(model.boundaries["bank"]?.kind).toBe("System");
    expect(model.boundaries["bank"]?.elementNames).toEqual(["web", "api"]);
    expect(model.elements["web"]?.technology).toBe("Java");
    expect(model.elements["api"]?.technology).toBe("Node.js");
  });

  it("does not register nested container boundaries as root boundaries", () => {
    const src = `workspace {
      model {
        platform = softwareSystem "Platform" {
          edge = container "Edge" {
            edgeApi = container "Edge API"
          }
          projects = container "Projects" {
            projectsApi = container "Projects API"
          }
        }
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.rootBoundaryNames).toEqual(["platform"]);
    expect(model.boundaries["platform"]?.boundaryNames).toEqual([
      "edge",
      "projects",
    ]);
    expect(model.boundaries["edge"]?.elementNames).toEqual(["edgeApi"]);
    expect(model.boundaries["projects"]?.elementNames).toEqual(["projectsApi"]);
  });

  it("resolves relationships using `id = element` assignments", () => {
    const src = `workspace {
      model {
        customer = person "Customer"
        bank = softwareSystem "Internet Banking"
        customer -> bank "Uses"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "test.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.elements["customer"]?.relations).toEqual([
      expect.objectContaining({
        to: "bank",
        description: "Uses",
      }),
    ]);
  });

  it("populates Container.sourceLocation with chevrotain positions", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "fixture.dsl");
    expect(parseErrors).toEqual([]);
    const loc = model.elements["bank"]?.sourceLocation;
    expect(loc).toBeDefined();
    expect(loc?.file).toBe("fixture.dsl");
    // The `bank = softwareSystem "Bank"` line starts on line 3 of the
    // multi-line source (positions are 1-based).
    expect(loc?.start.line).toBe(3);
    expect(loc?.start.col).toBeGreaterThan(0);
    expect(loc?.end.line).toBe(3);
    expect(loc?.start.offset).toBeGreaterThanOrEqual(0);
  });

  it("populates Relation.sourceLocation with chevrotain positions", () => {
    const src = `workspace {\n  model {\n    a = person "A"\n    b = person "B"\n    a -> b "uses"\n  }\n}`;
    const { model, parseErrors } = parseSource(src, "rel.dsl");
    expect(parseErrors).toEqual([]);
    const rel = model.elements["a"]?.relations[0];
    expect(rel).toBeDefined();
    expect(rel?.sourceLocation?.file).toBe("rel.dsl");
    expect(rel?.sourceLocation?.start.line).toBe(5);
  });

  it("real-world fixture — Internet Banking model section", () => {
    const src = `workspace "Big Bank plc" "Internet Banking System" {
      model {
        customer = person "Personal Banking Customer"
        bank = softwareSystem "Internet Banking System" {
          webApplication = container "Web Application" "" "Java, Spring MVC"
          singlePageApplication = container "Single-Page Application" "" "JavaScript, Angular"
          mobileApp = container "Mobile App" "" "Xamarin"
          apiApplication = container "API Application" "" "Java, Spring MVC"
          database = container "Database" "" "Oracle Database Schema"
        }
        mainframe = softwareSystem "Mainframe Banking System"
        email = softwareSystem "E-mail System"

        customer -> webApplication "Visits bigbank.com/ib using" "HTTPS"
        customer -> singlePageApplication "Views account balances and makes payments using"
        apiApplication -> database "Reads from and writes to" "JDBC"
        apiApplication -> mainframe "Makes API calls to" "XML/HTTPS"
        apiApplication -> email "Sends e-mail using"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "bank.dsl");
    expect(parseErrors).toEqual([]);
    // 1 Person + 5 nested Containers + 2 leaf Systems = 8 containers
    expect(Object.keys(model.elements).length).toBe(8);
    // 1 Boundary (the bank with nested containers)
    expect(Object.keys(model.boundaries).length).toBe(1);
    // 5 relations attached to source containers
    const totalRelations = Object.values(model.elements).reduce(
      (sum, c) => sum + c.relations.length,
      0,
    );
    expect(totalRelations).toBe(5);
  });

  it("resolves hierarchical refs `boundary.local` to nested elements", () => {
    const src = `workspace {
      model {
        !identifiers hierarchical
        bank = softwareSystem "Bank" {
          api = container "API"
          db = container "Database"
        }
        client = person "Client"
        client -> bank.api "calls"
        bank.api -> bank.db "reads"
      }
    }`;
    const { model, parseErrors } = parseSource(src, "hier.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.elements["client"]?.relations).toEqual([
      expect.objectContaining({ to: "bank.api", description: "calls" }),
    ]);
    expect(model.elements["bank.api"]?.relations).toEqual([
      expect.objectContaining({ to: "bank.db", description: "reads" }),
    ]);
  });

  it("collapses backslash-newline continuations into one logical line", () => {
    // Real-world fixture `multi-line.dsl` wraps an element declaration
    // across several lines using `\` continuations.
    const src = String.raw`workspace {
  model {
    bank = softwareSystem \
      "Bank" \
      "Internet Banking System"
  }
}`;
    const { model, parseErrors } = parseSource(src, "multi.dsl");
    expect(parseErrors).toEqual([]);
    expect(model.elements["bank"]?.description).toBe("Internet Banking System");
  });

  it("returns parseErrors (does not throw) on malformed input", () => {
    const { parseErrors } = parseSource(
      `workspace { model { unclosed`,
      "broken.dsl",
    );
    expect(parseErrors.length).toBeGreaterThan(0);
  });
});
