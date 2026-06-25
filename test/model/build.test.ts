import type { Boundary, Element } from "../../src/model";
import { buildModel } from "../../src/model";

const element = (over: Partial<Element>): Element => ({
  name: "x",
  label: "X",
  kind: "Container",
  external: false,
  description: "",
  tags: [],
  relations: [],
  ...over,
});

const boundary = (over: Partial<Boundary>): Boundary => ({
  name: "b",
  label: "B",
  kind: "System",
  tags: [],
  elementNames: [],
  boundaryNames: [],
  ...over,
});

describe("buildModel — implicit-tag normalization (the cross-format guarantee)", () => {
  it("strips implicit styling tags from elements, keeps domain tags", () => {
    const { model } = buildModel({
      elements: [
        element({
          name: "repo",
          tags: ["Element", "Container", "repo"],
        }),
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(model.elements.repo.tags).toEqual(["repo"]);
  });

  it("strips External but preserves the typed external flag", () => {
    const { model } = buildModel({
      elements: [
        element({
          name: "ext",
          kind: "System",
          external: true,
          tags: ["External"],
        }),
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(model.elements.ext.tags).toEqual([]);
    expect(model.elements.ext.external).toBe(true);
  });

  it("strips Relationship from relations but keeps async / domain tags", () => {
    const { model } = buildModel({
      elements: [
        element({
          name: "a",
          relations: [{ to: "b", tags: ["Relationship", "async"] }],
        }),
        element({ name: "b" }),
      ],
      boundaries: [],
      rootBoundaryNames: [],
    });
    expect(model.elements.a.relations[0].tags).toEqual(["async"]);
  });

  it("strips implicit tags from boundaries", () => {
    const { model } = buildModel({
      elements: [],
      boundaries: [
        boundary({
          name: "shop",
          tags: ["Element", "Software System", "core"],
        }),
      ],
      rootBoundaryNames: ["shop"],
    });
    expect(model.boundaries.shop.tags).toEqual(["core"]);
  });
});
