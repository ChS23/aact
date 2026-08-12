import type { Model, Violation } from "../../src";
import {
  allElements,
  analyzeArchitecture,
  computeDiff,
  crudRule,
  defineRule,
  kubernetesFormat,
  structurizrFormat,
} from "../../src";

const ARCH = "examples/library-api/architecture.dsl";
const FIXED = "examples/library-api/architecture-fixed.dsl";

const loadModel = async (path: string): Promise<Model> =>
  (await structurizrFormat.load!(path)).model;

// A project-specific rule, defined the same way built-ins are — a
// RuleDefinition with a `check(model)` that returns Violation[].
const requireDescription = defineRule({
  name: "requireDescription",
  description: "Every container must carry a description",
  check: (model): readonly Violation[] =>
    allElements(model)
      .filter((e) => e.kind.startsWith("Container") && e.description === "")
      .map((e) => ({
        target: e.name,
        targetKind: "element",
        message: `${e.name} has no description`,
      })),
});

describe("library API — drive aact from code", () => {
  it("loads a file into a normalized Model", async () => {
    const model = await loadModel(ARCH);
    expect(
      allElements(model)
        .map((e) => e.name)
        .toSorted(),
    ).toEqual(["orders", "orders-db"]);
    expect(model.elements["orders-db"].kind).toBe("ContainerDb");
  });

  it("runs a built-in rule (crud) over the Model", async () => {
    const model = await loadModel(ARCH);
    const violations = crudRule.check(model);
    expect(violations.map((v) => v.target)).toContain("orders");
  });

  it("runs a custom rule defined with defineRule", async () => {
    const model = await loadModel(ARCH);
    // Every container here has a description, so the rule is clean.
    expect(requireDescription.check(model)).toHaveLength(0);
    // Strip a description and the same rule fires.
    const stripped = {
      ...model,
      elements: {
        ...model.elements,
        orders: { ...model.elements["orders"], description: "" },
      },
    };
    expect(requireDescription.check(stripped).map((v) => v.target)).toEqual([
      "orders",
    ]);
  });

  it("computes metrics with analyzeArchitecture", async () => {
    const { report } = analyzeArchitecture(await loadModel(ARCH));
    expect(report.elementsCount).toBe(2);
    expect(report.databases.count).toBe(1);
  });

  it("diffs two Models with computeDiff", async () => {
    const before = await loadModel(ARCH);
    const after = await loadModel(FIXED);
    const { changes, summary } = computeDiff(
      before,
      after,
      { source: ARCH, format: "structurizr" },
      { source: FIXED, format: "structurizr" },
    );
    expect(summary.bySeverity.structural).toBeGreaterThan(0);
    expect(
      changes.some(
        (c) =>
          c.entity === "element" &&
          c.action === "added" &&
          c.name === "orders-repo",
      ),
    ).toBe(true);
  });

  it("generates artifacts with a format object", async () => {
    const out = kubernetesFormat.generate!(await loadModel(ARCH));
    expect(out.files.length).toBeGreaterThan(0);
    expect(out.files.some((f) => f.content.includes("apiVersion:"))).toBe(true);
  });
});
