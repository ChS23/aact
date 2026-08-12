import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — re-open form", () => {
  it("merges body description onto an existing container", () => {
    const src = `workspace {
      model {
        api = container "API"
        api {
          description "Updated description"
          tag "core"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toEqual(
      expect.objectContaining({
        description: "Updated description",
        tags: ["core"],
      }),
    );
  });

  it("appends relationships using the reopen target as implicit source", () => {
    const src = `workspace {
      model {
        db = container "DB"
        api = container "API"
        api {
          -> db "writes"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.relations).toEqual([
      expect.objectContaining({ to: "db", description: "writes" }),
    ]);
  });

  it("merges body onto a Boundary (softwareSystem with nested children)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank {
          description "Reopened bank description"
          tag "core"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.boundaries["bank"]).toEqual(
      expect.objectContaining({
        description: "Reopened bank description",
        tags: ["core"],
      }),
    );
  });

  it("merges tags onto existing tags (preserving order, deduping)", () => {
    const src = `workspace {
      model {
        api = container "API" "" "" "external"
        api {
          tag "core"
          tags "external,critical"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.tags).toEqual([
      "external",
      "core",
      "critical",
    ]);
  });

  it("warns when a reopen points at an unknown identifier", () => {
    const src = `workspace {
      model {
        api = container "API"
        ghost {
          description "Should not crash"
        }
      }
    }`;
    const { model, parseErrors, issues } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "loader-warning",
        source: "structurizr",
        code: "reopen-target-not-found",
        element: "ghost",
      }),
    );
  });

  it("reopen on a Boundary attaches new nested elements to its elementNames", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank {
          db = container "Database"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // The new container exists in the Model.
    expect(model.elements["db"]?.label).toBe("Database");
    // The Boundary's elementNames now includes both the original
    // child and the reopen-introduced one.
    expect(model.boundaries["bank"]?.elementNames).toEqual(
      expect.arrayContaining(["api", "db"]),
    );
  });

  it("hierarchical reopen target resolves via dotted identifier map", () => {
    const src = `workspace {
      model {
        !identifiers hierarchical
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank.api {
          description "API inside bank"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["bank.api"]?.description).toBe("API inside bank");
  });
});
