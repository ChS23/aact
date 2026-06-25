import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — CustomElement (`element` keyword)", () => {
  it("parses `element <name>` and produces a Container with kind Container", () => {
    const src = `workspace {
      model {
        box = element "Box 1"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["box"]).toBeDefined();
    expect(model.elements["box"]?.kind).toBe("Container");
  });

  it("carries no implicit tags", () => {
    // CustomElement is C4's escape hatch. Like every other element it
    // surfaces only user-authored tags — no implicit "Element" tag.
    const src = `workspace {
      model {
        box = element "Box 1"
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["box"]?.tags).toEqual([]);
  });

  it("accepts positional metadata, description, and tags", () => {
    const src = `workspace {
      model {
        box = element "Box" "MetaInfo" "A box outside C4" "external,visual"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["box"]).toEqual(
      expect.objectContaining({
        description: "A box outside C4",
        tags: ["external", "visual"],
      }),
    );
  });
});
