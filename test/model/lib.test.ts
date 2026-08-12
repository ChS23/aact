import {
  allBoundaries,
  allElements,
  getBoundary,
  getElement,
  targetOf,
  walkBoundaries,
} from "../../src/model";
import { makeModel } from "../helpers/makeModel";

describe("model/lib", () => {
  const model = makeModel({
    elements: [
      { name: "a", relations: [{ to: "b" }, { to: "ghost" }] },
      { name: "b" },
    ],
    boundaries: [
      {
        name: "root",
        boundaryNames: ["nested"],
      },
      { name: "nested", elementNames: ["a", "b"] },
    ],
    rootBoundaryNames: ["root"],
  });

  it("getElement returns container by name", () => {
    expect(getElement(model, "a")?.name).toBe("a");
  });

  it("getElement returns undefined for missing name", () => {
    expect(getElement(model, "ghost")).toBeUndefined();
  });

  it("getBoundary returns boundary by name", () => {
    expect(getBoundary(model, "root")?.name).toBe("root");
  });

  it("getBoundary returns undefined for missing name", () => {
    expect(getBoundary(model, "nope")).toBeUndefined();
  });

  it("targetOf resolves relation to target container", () => {
    const a = getElement(model, "a")!;
    expect(targetOf(model, a.relations[0])?.name).toBe("b");
  });

  it("targetOf returns undefined for dangling relation", () => {
    const a = getElement(model, "a")!;
    expect(targetOf(model, a.relations[1])).toBeUndefined();
  });

  it("allElements returns array of all containers", () => {
    expect(
      allElements(model)
        .map((c) => c.name)
        .toSorted(),
    ).toEqual(["a", "b"]);
  });

  it("allBoundaries returns array of all boundaries", () => {
    expect(
      allBoundaries(model)
        .map((b) => b.name)
        .toSorted(),
    ).toEqual(["nested", "root"]);
  });

  it("walkBoundaries yields from root depth-first", () => {
    const names = [...walkBoundaries(model)].map((b) => b.name);
    expect(names).toEqual(["root", "nested"]);
  });

  it("walkBoundaries does not loop on cycle (visited guards)", () => {
    // buildModel doesn't allow cycles to be physically loaded into
    // boundaryNames after validation, but walkBoundaries' visited guard
    // protects against accidental mis-construction.
    const cyclic = makeModel({
      elements: [{ name: "x" }],
      boundaries: [
        { name: "a", boundaryNames: ["b"], elementNames: ["x"] },
        { name: "b", boundaryNames: ["a"], elementNames: [] },
      ],
      rootBoundaryNames: ["a"],
    });
    const names = [...walkBoundaries(cyclic)].map((b) => b.name);
    expect(names).toEqual(["a", "b"]);
  });

  it("walkBoundaries skips unknown child boundary names", () => {
    const broken = makeModel({
      boundaries: [{ name: "a", boundaryNames: ["ghost"] }],
      rootBoundaryNames: ["a"],
    });
    const names = [...walkBoundaries(broken)].map((b) => b.name);
    expect(names).toEqual(["a"]);
  });

  it("walkBoundaries yields nothing when rootBoundaryNames is empty", () => {
    const empty = makeModel({});
    expect([...walkBoundaries(empty)]).toEqual([]);
  });
});
