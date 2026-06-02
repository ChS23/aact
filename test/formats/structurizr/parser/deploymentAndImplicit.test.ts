import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — deployment family", () => {
  it("strips a `deploymentEnvironment { ... }` block and surfaces info", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
      }
      deploymentEnvironment "Production" {
        deploymentNode "AWS" {
          containerInstance bank
        }
      }
    }`;
    const { model, parseErrors, infoBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["bank"]).toBeDefined();
    expect(infoBlocks).toEqual([
      expect.objectContaining({ construct: "deploymentEnvironment" }),
    ]);
    expect(infoBlocks[0]?.hint).toMatch(/deployment-family/i);
  });

  it("info-block range covers the keyword through the closing brace", () => {
    const src = `workspace {
      model { bank = softwareSystem "Bank" }
      deploymentEnvironment "Live" {
        deploymentNode "node-1" {}
      }
    }`;
    const { infoBlocks } = parse(src);
    expect(infoBlocks[0]?.range.start.line).toBe(3);
    expect(infoBlocks[0]?.range.end.line).toBeGreaterThanOrEqual(3);
  });

  it("strips multiple separate deployment environments", () => {
    const src = `workspace {
      model { bank = softwareSystem "Bank" }
      deploymentEnvironment "Production" { deploymentNode "p" {} }
      deploymentEnvironment "Staging" { deploymentNode "s" {} }
    }`;
    const { parseErrors, infoBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(infoBlocks.length).toBe(2);
    expect(
      infoBlocks.every((b) => b.construct === "deploymentEnvironment"),
    ).toBe(true);
  });
});

describe("Structurizr parser — implicit-source relationships", () => {
  // The implicit-source form `-> destination` appears inside an element's
  // own `{ body }` — the enclosing element supplies the source. The
  // reference grammar also accepts the "reopen" form (`existing { ... }`)
  // but aact does not model reopen yet; tests use the inline-body form.
  it("`-> destination` inside inline body uses enclosing element as source", () => {
    const src = `workspace {
      model {
        b = softwareSystem "B"
        a = person "Alice" {
          -> b "uses"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const rels = model.elements["a"]?.relations ?? [];
    expect(rels).toEqual([
      expect.objectContaining({ to: "b", description: "uses" }),
    ]);
  });

  it("`this -> destination` inside inline body resolves to enclosing element", () => {
    const src = `workspace {
      model {
        b = softwareSystem "B"
        a = softwareSystem "A" {
          this -> b "uses"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["a"]?.relations).toEqual([
      expect.objectContaining({ to: "b", description: "uses" }),
    ]);
  });

  it("implicit-source carries description / technology / tags", () => {
    const src = `workspace {
      model {
        db = container "DB"
        api = container "API" {
          -> db "writes to" "JDBC" "internal,critical"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const rel = model.elements["api"]?.relations[0];
    expect(rel?.to).toBe("db");
    expect(rel?.description).toBe("writes to");
    expect(rel?.technology).toBe("JDBC");
    expect(rel?.tags).toEqual(["Relationship", "internal", "critical"]);
  });

  it("implicit-source at model scope emits warning (no enclosing element)", () => {
    const src = `workspace {
      model {
        a = person "Alice"
        b = softwareSystem "B"
        -> b "orphan"
      }
    }`;
    const { model, parseErrors, issues } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["a"]?.relations).toEqual([]);
    expect(model.elements["b"]?.relations).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "loader-warning",
        source: "structurizr",
        code: "relationship-source-not-resolved",
      }),
    );
  });
});

describe("Structurizr parser — `this` as destination", () => {
  it("resolves `source -> this` to enclosing element on destination side", () => {
    const src = `workspace {
      model {
        other = softwareSystem "Other"
        bank = softwareSystem "Bank" {
          other -> this "called by"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["other"]?.relations).toEqual([
      expect.objectContaining({ to: "bank", description: "called by" }),
    ]);
  });

  it("`this -> this` resolves both endpoints to enclosing element", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          this -> this "self call"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["bank"]?.relations).toEqual([
      expect.objectContaining({ to: "bank", description: "self call" }),
    ]);
  });
});

describe("Structurizr parser — `-/>` no-relationship form", () => {
  it("parses `source -/> destination` without emitting a Model edge", () => {
    const src = `workspace {
      model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -/> b
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["a"]?.relations).toEqual([]);
    expect(model.elements["b"]?.relations).toEqual([]);
  });

  it("`-/>` does not crash even with description / tags arguments", () => {
    const src = `workspace {
      model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -/> b "explicit no-rel"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });
});
