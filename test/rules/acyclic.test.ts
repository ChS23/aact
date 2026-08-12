import { acyclicRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("acyclicRule.check", () => {
  it("returns no violations for acyclic graph", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
    });
    expect(acyclicRule.check(model)).toHaveLength(0);
  });

  it("detects self-loop", () => {
    const model = makeModel({
      elements: [{ name: "a", relations: [{ to: "a" }] }],
    });
    const v = acyclicRule.check(model);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].target).toBe("a");
  });

  it("detects 2-cycle", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }] },
        { name: "b", relations: [{ to: "a" }] },
      ],
    });
    expect(acyclicRule.check(model).length).toBeGreaterThan(0);
  });

  it("detects 3-cycle", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c", relations: [{ to: "a" }] },
      ],
    });
    expect(acyclicRule.check(model)).toHaveLength(3);
  });

  it("dangling relation does not crash", () => {
    const model = makeModel({
      elements: [{ name: "a", relations: [{ to: "nonexistent" }] }],
    });
    expect(acyclicRule.check(model)).toHaveLength(0);
  });
});
