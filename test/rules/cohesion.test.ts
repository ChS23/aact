import { cohesionRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("cohesionRule.check", () => {
  it("violation when coupling >= cohesion (no internal relations)", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "outside" }] },
        { name: "outside" },
      ],
      boundaries: [{ name: "b1", elementNames: ["a"] }],
    });
    const v = cohesionRule.check(model);
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].target).toBe("b1");
  });

  it("no violation when cohesion > coupling", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }, { to: "c" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
      boundaries: [{ name: "ctx", elementNames: ["a", "b", "c"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("ignores relations to external containers in coupling count", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }, { to: "ext_api" }] },
        { name: "b" },
        { name: "ext_api", kind: "System", external: true },
      ],
      boundaries: [{ name: "ctx", elementNames: ["a", "b"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("parent boundary's coupling counts inner-to-external relations", () => {
    const model = makeModel({
      elements: [
        { name: "inner_svc", relations: [{ to: "ext_api" }] },
        { name: "ext_api", kind: "System", external: true },
      ],
      boundaries: [
        { name: "parent", label: "parent", boundaryNames: ["inner"] },
        { name: "inner", label: "inner", elementNames: ["inner_svc"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    expect(violations.find((v) => v.target === "parent")).toBeDefined();
  });

  it("flags parent cohesion ≥ inner cohesion sum", () => {
    const model = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y" }, { to: "z" }] },
        { name: "y", relations: [{ to: "z" }] },
        { name: "z" },
      ],
      boundaries: [
        {
          name: "parent",
          elementNames: ["x", "y", "z"],
          boundaryNames: ["empty_inner"],
        },
        { name: "empty_inner", elementNames: [] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const tooCohesive = cohesionRule
      .check(model)
      .find(
        (v) =>
          v.target === "parent" &&
          v.message.includes("less cohesive than its sub-boundaries"),
      );
    expect(tooCohesive).toBeDefined();
  });

  it("inner boundary's coupling becomes parent's cohesion (covers nested cohesion accumulator)", () => {
    const model = makeModel({
      elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
      boundaries: [
        { name: "parent", boundaryNames: ["bA", "bB"] },
        { name: "bA", elementNames: ["a"] },
        { name: "bB", elementNames: ["b"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    const violations = cohesionRule.check(model);
    expect(violations.find((v) => v.target === "bA")).toBeDefined();
  });

  it("ignores dangling relation when computing cohesion/coupling", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "ghost" }, { to: "b" }] },
        { name: "b" },
      ],
      boundaries: [{ name: "ctx", elementNames: ["a", "b"] }],
    });
    expect(cohesionRule.check(model)).toHaveLength(0);
  });

  it("boundary with dangling container name doesn't throw (covers !container guard)", () => {
    // boundary.elementNames references missing container.
    const model = makeModel({
      elements: [{ name: "real" }],
      boundaries: [{ name: "ctx", elementNames: ["real", "ghost_container"] }],
    });
    expect(() => cohesionRule.check(model)).not.toThrow();
  });

  it("equal cohesion/coupling triggers violation (covers <= boundary)", () => {
    // a → b (internal, cohesion +1), a → outside (coupling +1).
    // cohesion=1, coupling=1, cohesion <= coupling → violation.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }, { to: "outside" }] },
        { name: "b" },
        { name: "outside" },
      ],
      boundaries: [{ name: "ctx", elementNames: ["a", "b"] }],
    });
    const v = cohesionRule.check(model);
    expect(v.find((it) => it.target === "ctx")).toBeDefined();
  });

  it("violation message contains both coupling and cohesion numbers", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "outside" }] },
        { name: "outside" },
      ],
      boundaries: [{ name: "b1", elementNames: ["a"] }],
    });
    const v = cohesionRule.check(model);
    expect(v[0].message).toMatch(/coupling \(\d+\)/);
    expect(v[0].message).toMatch(/cohesion \(\d+\)/);
    expect(v[0].message).toContain(
      "more cross-boundary dependencies than internal connections",
    );
  });

  it("rule description is non-empty", () => {
    // Pin description literal (Stryker mutates to empty).
    expect(cohesionRule.description).toContain("cohesive");
    expect(cohesionRule.description.length).toBeGreaterThan(20);
  });

  it("parent without inner boundaries: only cohesion≤coupling check fires, not the inner-sum check", () => {
    // Stryker mutated `boundary.boundaryNames.length > 0` predicate. A flat
    // boundary with no children should not trigger the inner-sum violation.
    const model = makeModel({
      elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
      boundaries: [{ name: "ctx", elementNames: ["a", "b"] }],
    });
    const v = cohesionRule.check(model);
    // No "less cohesive than its sub-boundaries" message for a flat boundary.
    expect(
      v.find((it) => it.message.includes("less cohesive than")),
    ).toBeUndefined();
  });

  it("parent's coupling counts ONLY inner→external (not inner→inner-sibling)", () => {
    // Stryker can mutate `getElement(model, r.to)?.external === true` to
    // `=== false`. Build a case where inner has both intra-parent siblings
    // AND a true external: parent.coupling should reflect only the external.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }, { to: "ext_x" }] },
        { name: "b" },
        { name: "ext_x", kind: "System", external: true },
      ],
      boundaries: [
        { name: "parent", boundaryNames: ["bA", "bB"] },
        { name: "bA", elementNames: ["a"] },
        { name: "bB", elementNames: ["b"] },
      ],
      rootBoundaryNames: ["parent"],
    });
    // parent.coupling should = 1 (a→ext_x), not include a→b (sibling within parent).
    // bA itself should violate (coupling=2: b sibling + ext_x external; cohesion=0).
    const violations = cohesionRule.check(model);
    const bAViolation = violations.find((v) => v.target === "bA");
    expect(bAViolation).toBeDefined();
  });
});
