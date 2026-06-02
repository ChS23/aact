import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — keyword-as-identifier compatibility", () => {
  it("element kind keyword can be used as the LHS of an assignment", () => {
    // Reference fixtures (big-bank-plc.dsl, identifiers.dsl, …) write
    // `softwareSystem = softwareSystem "Name"`. The Java parser's
    // whitespace-only tokeniser treats the LHS as a bare identifier;
    // we mirror by allowing element-kind keywords in identifier slots.
    const src = `workspace {
      model {
        softwareSystem = softwareSystem "Bank"
        container = container "API"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["softwareSystem"]).toBeDefined();
    expect(model.elements["container"]).toBeDefined();
  });

  it("`element` keyword can be used as the LHS of an assignment", () => {
    const src = `workspace {
      model {
        element = element "Custom"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["element"]).toBeDefined();
  });

  it("element-kind keyword identifier resolves on the source side", () => {
    const src = `workspace {
      model {
        softwareSystem = softwareSystem "Bank"
        api = container "API"
        softwareSystem -> api "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["softwareSystem"]?.relations).toEqual([
      expect.objectContaining({ to: "api", description: "uses" }),
    ]);
  });

  it("element-kind keyword identifier resolves on the destination side", () => {
    const src = `workspace {
      model {
        user = person "User"
        softwareSystem = softwareSystem "Bank"
        user -> softwareSystem "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["user"]?.relations).toEqual([
      expect.objectContaining({ to: "softwareSystem", description: "uses" }),
    ]);
  });

  it("reopen form works with a keyword identifier target", () => {
    const src = `workspace {
      model {
        softwareSystem = softwareSystem "Bank"
        softwareSystem {
          description "Updated"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["softwareSystem"]?.description).toBe("Updated");
  });
});

describe("Structurizr parser — case-insensitive identifier lookup", () => {
  it("references resolve regardless of identifier case", () => {
    // The Java parser uses equalsIgnoreCase on identifier lookups; a
    // declared `bank` can be referenced as `BANK` or `Bank`.
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        user = person "User"
        user -> BANK "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["user"]?.relations).toEqual([
      expect.objectContaining({ to: "bank", description: "uses" }),
    ]);
  });

  it("hierarchical reference is also case-insensitive", () => {
    const src = `workspace {
      model {
        !identifiers hierarchical
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        user = person "User"
        user -> BANK.API "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["user"]?.relations).toEqual([
      expect.objectContaining({ to: "bank.api", description: "uses" }),
    ]);
  });
});
