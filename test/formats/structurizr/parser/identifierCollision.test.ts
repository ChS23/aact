import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — identifier re-registration", () => {
  it("emits a duplicate-identifier issue when the same id maps to two elements", () => {
    const src = `workspace {
      model {
        a = container "First"
        a = container "Second"
      }
    }`;
    const { issues } = parse(src);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate-identifier",
          identifier: "a",
        }),
      ]),
    );
  });

  it("does not flag the same identifier reused for the same element (idempotent)", () => {
    // Reopen with the same id is NOT a collision — the parser treats
    // `bank { ... }` as adding to the prior `bank` registration, and
    // identifierMap.get(lookupKey) returns the same value, so no issue.
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        bank {
          description "Reopened"
        }
      }
    }`;
    const { issues } = parse(src);
    expect(issues.filter((i) => i.kind === "duplicate-identifier")).toEqual([]);
  });

  it("case-insensitive collision is detected (BANK vs bank)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "First"
        BANK = softwareSystem "Second"
      }
    }`;
    const { issues } = parse(src);
    expect(issues.some((i) => i.kind === "duplicate-identifier")).toBe(true);
  });

  it("flat identifier scope rejects duplicate nested ids", () => {
    const src = `workspace {
      model {
        s1 = softwareSystem "S1" {
          api = container "API"
        }
        s2 = softwareSystem "S2" {
          api = container "API"
        }
      }
    }`;
    const { issues } = parse(src);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate-identifier",
          identifier: "api",
        }),
      ]),
    );
  });

  it("hierarchical identifier scope permits duplicate local ids under different parents", () => {
    const src = `workspace {
      model {
        !identifiers hierarchical
        s1 = softwareSystem "S1" {
          api = container "API"
        }
        s2 = softwareSystem "S2" {
          api = container "API"
        }
        s1.api -> s2.api "Calls"
      }
    }`;
    const { issues, model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(issues.filter((i) => i.kind === "duplicate-identifier")).toEqual([]);
    expect(model.elements["s1.api"]?.relations).toEqual([
      expect.objectContaining({ to: "s2.api", description: "Calls" }),
    ]);
  });
});
