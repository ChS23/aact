import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

// The reference (Java) parser stamps implicit styling tags — "Element"
// plus a kind tag on every element, "Relationship" on every relation.
// aact deliberately drops them: they duplicate the typed `kind` field,
// no rule reads them, and keeping `Model.tags` to user-authored tags
// makes the contract uniform with the PlantUML / kubernetes / compose
// loaders. These tests pin that "no implicit tags" behaviour.
describe("Structurizr parser — no implicit styling tags", () => {
  it("person carries no implicit tags", () => {
    const { model } = parse(`workspace { model { user = person "User" } }`);
    expect(model.elements["user"]?.tags).toEqual([]);
  });

  it("softwareSystem (leaf) carries no implicit tags", () => {
    const { model } = parse(`workspace { model { s = softwareSystem "S" } }`);
    expect(model.elements["s"]?.tags).toEqual([]);
  });

  it("container carries no implicit tags", () => {
    const { model } = parse(`workspace { model { c = container "C" } }`);
    expect(model.elements["c"]?.tags).toEqual([]);
  });

  it("component carries no implicit tags", () => {
    const { model } = parse(`workspace { model { c = component "C" } }`);
    expect(model.elements["c"]?.tags).toEqual([]);
  });

  it("keeps only explicit tags", () => {
    const src = `workspace {
      model {
        u = person "U" "" "vip,internal"
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["u"]?.tags).toEqual(["vip", "internal"]);
  });

  it("Boundary (softwareSystem with children) carries no implicit tags", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.boundaries["bank"]?.tags).toEqual([]);
  });

  it("Boundary (container with components) carries no implicit tags", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API" {
            controller = component "Controller"
          }
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.boundaries["api"]?.tags).toEqual([]);
  });

  it("Relation carries no implicit tags by default", () => {
    const src = `workspace {
      model {
        a = person "A"
        b = softwareSystem "B"
        a -> b
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["a"]?.relations[0]?.tags).toEqual([]);
  });

  it("Relation keeps only explicit header tags", () => {
    const src = `workspace {
      model {
        a = person "A"
        b = softwareSystem "B"
        a -> b "uses" "HTTP" "internal,critical"
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["a"]?.relations[0]?.tags).toEqual([
      "internal",
      "critical",
    ]);
  });
});
