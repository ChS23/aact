import type { ArchitectureModel, Boundary, Container } from "../../src/model";
import { checkCommonReuse } from "../../src/rules/commonReuse";

const makeContainer = (
  name: string,
  relations: Container["relations"] = [],
): Container => ({
  name,
  label: name,
  type: "Container",
  description: "",
  relations,
});

const makeBoundary = (name: string, containers: Container[]): Boundary => ({
  name,
  label: name,
  containers,
  boundaries: [],
});

const makeModel = (boundaries: Boundary[]): ArchitectureModel => ({
  boundaries,
  allContainers: boundaries.flatMap((b) => b.containers),
});

describe("checkCommonReuse", () => {
  it("returns no violations when consumer uses all public services", () => {
    // Image 1: A→C, B→C, B→D — Context 1 uses both C and D
    const c = makeContainer("C");
    const d = makeContainer("D", [{ to: c }]);
    const a = makeContainer("A", [{ to: c }]);
    const b = makeContainer("B", [{ to: c }, { to: d }]);

    const model = makeModel([
      makeBoundary("ctx1", [a, b]),
      makeBoundary("ctx2", [c, d]),
    ]);

    expect(checkCommonReuse(model)).toHaveLength(0);
  });

  it("returns no violations when only one public service exists (D is private)", () => {
    // Image 2: A→C, C→D — D only used internally
    const d = makeContainer("D");
    const c = makeContainer("C", [{ to: d }]);
    const a = makeContainer("A", [{ to: c }]);
    const b = makeContainer("B");

    const model = makeModel([
      makeBoundary("ctx1", [a, b]),
      makeBoundary("ctx2", [c, d]),
    ]);

    expect(checkCommonReuse(model)).toHaveLength(0);
  });

  it("returns no violations with three contexts when D is private", () => {
    // Image 3: A→C, B→C, B→D internal, Z→C — D private
    const d = makeContainer("D");
    const c = makeContainer("C", [{ to: d }]);
    const a = makeContainer("A", [{ to: c }]);
    const b = makeContainer("B", [{ to: c }]);
    const z = makeContainer("Z", [{ to: c }]);

    const model = makeModel([
      makeBoundary("ctx1", [a, b]),
      makeBoundary("ctx2", [c, d]),
      makeBoundary("ctx3", [z]),
    ]);

    expect(checkCommonReuse(model)).toHaveLength(0);
  });

  it("reports violation when consumer uses D but not C", () => {
    // Violation 1: A→C, B→C, B→D, Z→D — Z uses D but not C
    const c = makeContainer("C");
    const d = makeContainer("D", [{ to: c }]);
    const a = makeContainer("A", [{ to: c }]);
    const b = makeContainer("B", [{ to: c }, { to: d }]);
    const z = makeContainer("Z", [{ to: d }]);

    const model = makeModel([
      makeBoundary("ctx1", [a, b]),
      makeBoundary("ctx2", [c, d]),
      makeBoundary("ctx3", [z]),
    ]);

    const violations = checkCommonReuse(model);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("ctx3");
    expect(violations[0].message).toContain("C");
    expect(violations[0].message).toContain("ctx2");
  });

  it("reports violation when consumer uses C but not D", () => {
    // Violation 2: A→C, B→D, Z→C, Z→D — ctx1 uses only C (via A), not D
    // Actually: A→C only, B→C and B→D. But ctx1 uses C and D via B → ok
    // Correct: A→C, Z→C, Z→D — D is public (Z uses it), ctx1 uses only C
    const c = makeContainer("C");
    const d = makeContainer("D");
    const a = makeContainer("A", [{ to: c }]);
    const b = makeContainer("B", [{ to: c }]);
    const z = makeContainer("Z", [{ to: c }, { to: d }]);

    const model = makeModel([
      makeBoundary("ctx1", [a, b]),
      makeBoundary("ctx2", [c, d]),
      makeBoundary("ctx3", [z]),
    ]);

    const violations = checkCommonReuse(model);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("ctx1");
    expect(violations[0].message).toContain("D");
    expect(violations[0].message).toContain("ctx2");
  });

  it("no violation when consumer uses zero services of a provider", () => {
    // C and D are public (used by ctx3), but ctx1 uses neither — that's fine
    const c = makeContainer("C");
    const d = makeContainer("D");
    const a = makeContainer("A");
    const z = makeContainer("Z", [{ to: c }, { to: d }]);

    const model = makeModel([
      makeBoundary("ctx1", [a]),
      makeBoundary("ctx2", [c, d]),
      makeBoundary("ctx3", [z]),
    ]);

    expect(checkCommonReuse(model)).toHaveLength(0);
  });

  it("reports violation when consumer uses 2 of 3 public services", () => {
    const c = makeContainer("C");
    const d = makeContainer("D");
    const e = makeContainer("E");
    const a = makeContainer("A", [{ to: c }, { to: d }]);
    const z = makeContainer("Z", [{ to: c }, { to: d }, { to: e }]);

    const model = makeModel([
      makeBoundary("ctx1", [a]),
      makeBoundary("ctx2", [c, d, e]),
      makeBoundary("ctx3", [z]),
    ]);

    const violations = checkCommonReuse(model);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("ctx1");
    expect(violations[0].message).toContain("E");
  });

  it("returns no violations when no cross-boundary relations", () => {
    const a = makeContainer("A");
    const c = makeContainer("C");

    const model = makeModel([
      makeBoundary("ctx1", [a]),
      makeBoundary("ctx2", [c]),
    ]);

    expect(checkCommonReuse(model)).toHaveLength(0);
  });

  it("returns no violations for single boundary", () => {
    const a = makeContainer("A");
    const b = makeContainer("B", [{ to: a }]);

    const model = makeModel([makeBoundary("ctx1", [a, b])]);

    expect(checkCommonReuse(model)).toHaveLength(0);
  });

  it("reports multiple violations when several consumers miss services", () => {
    // C and D both public. ctx1 uses only C, ctx3 uses only D
    const c = makeContainer("C");
    const d = makeContainer("D");
    const a = makeContainer("A", [{ to: c }]);
    const z = makeContainer("Z", [{ to: d }]);
    // Need both to be public: someone must use C from outside and D from outside
    // ctx1 uses C, ctx3 uses D — both are public
    // ctx1 doesn't use D → violation
    // ctx3 doesn't use C → violation

    const model = makeModel([
      makeBoundary("ctx1", [a]),
      makeBoundary("ctx2", [c, d]),
      makeBoundary("ctx3", [z]),
    ]);

    const violations = checkCommonReuse(model);
    expect(violations).toHaveLength(2);
    const names = violations
      .map((v) => v.container)
      .sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(["ctx1", "ctx3"]);
  });
});
