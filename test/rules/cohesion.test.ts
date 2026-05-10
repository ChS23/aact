import { ArchitectureModel, Container } from "../../src/model";
import { checkCohesion } from "../../src/rules";

describe("checkCohesion", () => {
  it("returns no violations when cohesion > coupling", () => {
    const ext: Container = {
      name: "ext",
      label: "External",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const b: Container = {
      name: "b",
      label: "B",
      type: "Container",
      description: "",
      relations: [],
    };
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: b }, { to: b }],
    };

    const model: ArchitectureModel = {
      allContainers: [a, b, ext],
      boundaries: [
        {
          name: "ctx",
          label: "Context",
          boundaries: [],
          containers: [a, b],
        },
      ],
    };

    expect(checkCohesion(model)).toHaveLength(0);
  });

  it("returns violation when coupling >= cohesion", () => {
    const ext: Container = {
      name: "ext",
      label: "External",
      type: "Container",
      description: "",
      relations: [],
    };
    const a: Container = {
      name: "a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: ext }],
    };

    const model: ArchitectureModel = {
      allContainers: [a, ext],
      boundaries: [
        {
          name: "ctx",
          label: "Context",
          boundaries: [],
          containers: [a],
        },
      ],
    };

    const violations = checkCohesion(model);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain("cohesion");
  });

  it("checks that parent cohesion < sum of inner cohesions", () => {
    const c1: Container = {
      name: "c1",
      label: "C1",
      type: "Container",
      description: "",
      relations: [],
    };
    const c2: Container = {
      name: "c2",
      label: "C2",
      type: "Container",
      description: "",
      relations: [{ to: c1 }],
    };
    const c3: Container = {
      name: "c3",
      label: "C3",
      type: "Container",
      description: "",
      relations: [],
    };
    const c4: Container = {
      name: "c4",
      label: "C4",
      type: "Container",
      description: "",
      relations: [{ to: c3 }, { to: c3 }],
    };

    // inner1 cohesion=1 (c2→c1), coupling=0
    // inner2 cohesion=2 (c4→c3 x2), coupling=0
    // parent.containers=[] (loaders put containers only in leaf boundaries)
    // parent cohesion = inner boundary coupling sum = 0+0 = 0
    // parent coupling = 0 (no external system relations)
    // cohesion(0) <= coupling(0) → violation on first check

    const inner1 = {
      name: "inner1",
      label: "Inner 1",
      boundaries: [],
      containers: [c1, c2],
    };
    const inner2 = {
      name: "inner2",
      label: "Inner 2",
      boundaries: [],
      containers: [c3, c4],
    };

    const model: ArchitectureModel = {
      allContainers: [c1, c2, c3, c4],
      boundaries: [
        {
          name: "parent",
          label: "Parent",
          boundaries: [inner1, inner2],
          containers: [],
        },
        inner1,
        inner2,
      ],
    };

    const violations = checkCohesion(model);
    expect(violations.some((v) => v.container === "parent")).toBe(true);
  });

  it("propagates internalType through nested boundary cohesion calculation", () => {
    // Two microservices using a custom type. m1 in inner boundary calls m2,
    // which lives in outer's own containers (cross-boundary same-parent).
    // Outer cohesion should include m1→m2 via inner-boundary coupling. With
    // the bug (recursive call ignored options), inner-boundary coupling is
    // computed against default internalType "Container" and counts 0,
    // collapsing outer cohesion to 0 and triggering an extra spurious
    // `coupling ≥ cohesion` violation.
    const m2: Container = {
      name: "m2",
      label: "M2",
      type: "Microservice",
      description: "",
      relations: [],
    };
    const m1: Container = {
      name: "m1",
      label: "M1",
      type: "Microservice",
      description: "",
      relations: [{ to: m2 }],
    };
    const model: ArchitectureModel = {
      allContainers: [m1, m2],
      boundaries: [
        {
          name: "outer",
          label: "Outer",
          containers: [m2],
          boundaries: [
            {
              name: "inner",
              label: "Inner",
              containers: [m1],
              boundaries: [],
            },
          ],
        },
      ],
    };

    const violations = checkCohesion(model, { internalType: "Microservice" });
    // With fix: only the parent-vs-inner-cohesion check fires (1 violation).
    // Without fix: also fires `coupling ≥ cohesion` because outer cohesion = 0.
    expect(violations).toHaveLength(1);
    expect(violations[0].message).not.toContain("coupling (");
  });
});
