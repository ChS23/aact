import { computeDiff } from "../../src/diff";
import type { Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

const SIDE = { source: "x", format: "plantuml" } as const;
const diff = (a: Model, b: Model, opts = {}) =>
  computeDiff(a, b, SIDE, SIDE, opts);

describe("computeDiff — additional field-level coverage", () => {
  it("detects label change as cosmetic field on element", () => {
    const a = makeModel({ elements: [{ name: "x", label: "Old Label" }] });
    const b = makeModel({ elements: [{ name: "x", label: "New Label" }] });
    const result = diff(a, b);
    expect(result.changes[0].fields).toContainEqual(
      expect.objectContaining({ field: "label" }),
    );
  });

  it("detects external flag flip as semantic", () => {
    const a = makeModel({
      elements: [{ name: "ext", kind: "System", external: false }],
    });
    const b = makeModel({
      elements: [{ name: "ext", kind: "System", external: true }],
    });
    const result = diff(a, b);
    const change = result.changes.find((c) => c.entity === "element");
    expect(change?.fields).toContainEqual(
      expect.objectContaining({
        field: "external",
        before: false,
        after: true,
      }),
    );
    expect(change?.severity).toBe("semantic");
  });

  it("detects description / sprite / link / properties changes", () => {
    const a = makeModel({
      elements: [
        {
          name: "x",
          description: "old",
          sprite: "old_sprite",
          link: "old_link",
          properties: { k: "v1" },
        },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "x",
          description: "new",
          sprite: "new_sprite",
          link: "new_link",
          properties: { k: "v2" },
        },
      ],
    });
    const result = diff(a, b);
    const fields = result.changes[0].fields.map((f) => f.field);
    expect(fields).toEqual(
      expect.arrayContaining(["description", "sprite", "link", "properties"]),
    );
  });

  it("detects tag set delta with added/removed lists", () => {
    const a = makeModel({ elements: [{ name: "x", tags: ["a", "b"] }] });
    const b = makeModel({ elements: [{ name: "x", tags: ["b", "c"] }] });
    const result = diff(a, b);
    const tagField = result.changes[0].fields.find((f) => f.field === "tags");
    expect(tagField?.added).toEqual(["c"]);
    expect(tagField?.removed).toEqual(["a"]);
  });

  it("treats properties with same keys but different values as changed", () => {
    const a = makeModel({
      elements: [{ name: "x", properties: { a: "1", b: "2" } }],
    });
    const b = makeModel({
      elements: [{ name: "x", properties: { a: "1", b: "9" } }],
    });
    const result = diff(a, b);
    const propField = result.changes[0].fields.find(
      (f) => f.field === "properties",
    );
    expect(propField).toBeDefined();
  });

  it("ignores properties when both undefined", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b);
    expect(result.changes).toHaveLength(0);
  });
});

describe("computeDiff — boundary edge cases", () => {
  it("detects boundary added/removed", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "b", elementNames: ["x"] }],
    });
    const result = diff(a, b);
    const added = result.changes.find(
      (c) => c.entity === "boundary" && c.action === "added",
    );
    expect(added).toBeDefined();
  });

  it("detects boundary rename when label and children match", () => {
    const a = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx_old", label: "Context", elementNames: ["x"] }],
    });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", label: "Context", elementNames: ["x"] }],
    });
    const result = diff(a, b);
    const renamed = result.changes.find(
      (c) => c.entity === "boundary" && c.action === "renamed",
    );
    expect(renamed).toBeDefined();
  });

  it("detects boundary fields changes: kind, description, link, tags", () => {
    const a = makeModel({
      elements: [{ name: "x" }],
      boundaries: [
        {
          name: "b",
          kind: "System",
          description: "old",
          link: "old_link",
          tags: ["a"],
          elementNames: ["x"],
        },
      ],
    });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [
        {
          name: "b",
          kind: "Container",
          description: "new",
          link: "new_link",
          tags: ["b"],
          elementNames: ["x"],
        },
      ],
    });
    const result = diff(a, b);
    const change = result.changes.find((c) => c.entity === "boundary");
    const fieldNames = change?.fields.map((f) => f.field) ?? [];
    expect(fieldNames).toEqual(
      expect.arrayContaining(["kind", "description", "link", "tags"]),
    );
  });

  it("detects nested boundary additions via boundaryNames delta", () => {
    const a = makeModel({
      boundaries: [{ name: "parent" }, { name: "leaf" }],
    });
    const b = makeModel({
      boundaries: [
        { name: "parent", boundaryNames: ["leaf"] },
        { name: "leaf" },
      ],
    });
    const result = diff(a, b);
    const change = result.changes.find(
      (c) => c.entity === "boundary" && c.name === "parent",
    );
    const boundaryNamesField = change?.fields.find(
      (f) => f.field === "boundaryNames",
    );
    expect(boundaryNamesField?.added).toEqual(["leaf"]);
  });
});

describe("computeDiff — relation edge cases", () => {
  it("detects relation description/tags/order changes (same identity)", () => {
    const a = makeModel({
      elements: [
        {
          name: "a",
          relations: [
            {
              to: "b",
              technology: "HTTP",
              description: "old",
              tags: ["x"],
              order: 1,
            },
          ],
        },
        { name: "b" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "a",
          relations: [
            {
              to: "b",
              technology: "HTTP",
              description: "new",
              tags: ["y"],
              order: 2,
            },
          ],
        },
        { name: "b" },
      ],
    });
    const result = diff(a, b);
    const relChange = result.changes.find((c) => c.entity === "relation");
    const fieldNames = relChange?.fields.map((f) => f.field) ?? [];
    expect(fieldNames).toEqual(
      expect.arrayContaining(["description", "tags", "order"]),
    );
  });

  it("treats absent technology consistently (empty string and undefined match)", () => {
    const a = makeModel({
      elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
    });
    const b = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b", technology: "  " }] },
        { name: "b" },
      ],
    });
    const result = diff(a, b);
    // Pure whitespace technology matches absent technology — no diff.
    expect(result.changes).toHaveLength(0);
  });

  it("renames boundary respects threshold", () => {
    const a = makeModel({
      boundaries: [{ name: "very_different_name", label: "Foo" }],
    });
    const b = makeModel({
      boundaries: [{ name: "totally_other", label: "Bar" }],
    });
    const result = diff(a, b);
    // No rename — too different.
    expect(result.changes.some((c) => c.action === "renamed")).toBe(false);
  });
});

describe("computeDiff — workspace edge cases", () => {
  it("detects workspace extendsTarget change", () => {
    const a: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "ws", extendsTarget: "old.dsl" },
    };
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "ws", extendsTarget: "new.dsl" },
    };
    const result = diff(a, b);
    const wsChange = result.changes.find((c) => c.entity === "workspace");
    expect(wsChange?.fields).toContainEqual(
      expect.objectContaining({ field: "workspace.extendsTarget" }),
    );
  });

  it("emits no workspace change when both undefined", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b);
    expect(result.changes.some((c) => c.entity === "workspace")).toBe(false);
  });

  it("detects workspace added (undefined → present)", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "new" },
    };
    const result = diff(a, b);
    expect(result.changes.some((c) => c.entity === "workspace")).toBe(true);
  });
});

describe("computeDiff — RFC 6902 patch shape", () => {
  it("emits replace ops for value changes", () => {
    const a = makeModel({ elements: [{ name: "x", label: "Old" }] });
    const b = makeModel({ elements: [{ name: "x", label: "New" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch?.some((op) => op.op === "replace")).toBe(true);
  });

  it("emits add ops for new elements", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch?.some((op) => op.op === "add")).toBe(true);
  });

  it("emits remove ops for deleted elements", () => {
    const a = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch?.some((op) => op.op === "remove")).toBe(true);
  });
});

describe("computeDiff — summary edge cases", () => {
  it("falls back to `N change(s)` headline when no recognised category fires", () => {
    // Only cosmetic-modify changes that don't fit any of the
    // headline part patterns we count specifically.
    const a = makeModel({ elements: [{ name: "x", label: "Old" }] });
    const b = makeModel({ elements: [{ name: "x", label: "New" }] });
    const result = diff(a, b);
    expect(result.summary.headline).toContain("[cosmetic]");
  });

  // The headline builder uses `parts.push(\`+\${n} element\${n === 1 ? "" : "s"}\`)`.
  // Mutation testing flagged the singular/plural ternary, the `> 0`
  // guards, and the per-bucket fragments as survived — each branch
  // needs an example with that exact count so the assertion pins it.

  it("uses singular form for exactly one added element", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    const result = diff(a, b);
    expect(result.summary.headline).toMatch(/\+1 element\b/);
    expect(result.summary.headline).not.toMatch(/\+1 elements\b/);
  });

  it("uses plural form for two added elements", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({
      elements: [{ name: "x" }, { name: "y" }, { name: "z" }],
    });
    const result = diff(a, b);
    expect(result.summary.headline).toMatch(/\+2 elements\b/);
  });

  it("uses singular -1 element wording for one removal", () => {
    const a = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    const b = makeModel({ elements: [{ name: "x" }] });
    const result = diff(a, b);
    expect(result.summary.headline).toMatch(/-1 element\b/);
    expect(result.summary.headline).not.toMatch(/-1 elements\b/);
  });

  it("uses 'boundary' (singular) vs 'boundaries' (plural) when boundaries are added", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const oneAdded = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "b1", elementNames: ["x"] }],
    });
    const twoAdded = makeModel({
      elements: [{ name: "x" }, { name: "y" }],
      boundaries: [
        { name: "b1", elementNames: ["x"] },
        { name: "b2", elementNames: ["y"] },
      ],
    });
    expect(diff(a, oneAdded).summary.headline).toMatch(/\+1 boundary\b/);
    expect(diff(a, twoAdded).summary.headline).toMatch(/\+2 boundaries\b/);
  });

  it("uses 'boundary' / 'boundaries' for removed boundaries", () => {
    const oneRemoved = makeModel({ elements: [{ name: "x" }] });
    const withOne = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "b1", elementNames: ["x"] }],
    });
    expect(diff(withOne, oneRemoved).summary.headline).toMatch(/-1 boundary\b/);
  });

  it("uses 'relation' (singular) vs 'relations' (plural) on add count", () => {
    const a = makeModel({
      elements: [{ name: "x" }, { name: "y" }, { name: "z" }],
    });
    const oneAdded = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y" }] },
        { name: "y" },
        { name: "z" },
      ],
    });
    const twoAdded = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y" }, { to: "z" }] },
        { name: "y" },
        { name: "z" },
      ],
    });
    expect(diff(a, oneAdded).summary.headline).toMatch(/\+1 relation\b/);
    expect(diff(a, twoAdded).summary.headline).toMatch(/\+2 relations\b/);
  });

  it("uses 'relation' / 'relations' on remove count", () => {
    const a = makeModel({
      elements: [{ name: "x", relations: [{ to: "y" }] }, { name: "y" }],
    });
    const b = makeModel({ elements: [{ name: "x" }, { name: "y" }] });
    expect(diff(a, b).summary.headline).toMatch(/-1 relation\b/);
  });

  it("uses '~N renamed' fragment when a rename is detected", () => {
    const a = makeModel({
      elements: [{ name: "svc_a", label: "Service A" }],
    });
    const b = makeModel({
      elements: [{ name: "svcA", label: "Service A" }],
    });
    expect(diff(a, b).summary.headline).toMatch(/~1 renamed/);
  });

  it("uses 'technology change' vs 'technology changes' wording", () => {
    const a = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y", technology: "rest" }] },
        { name: "y" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y", technology: "grpc" }] },
        { name: "y" },
      ],
    });
    expect(diff(a, b).summary.headline).toMatch(/1 technology change\b/);
  });
});

describe("computeDiff — field-shape invariants under set delta", () => {
  // Each diffXFields helper spreads `added: delta.added` only when the
  // array is non-empty (and same for `removed`). Mutation testing
  // flagged `delta.added.length > 0` survivors — these tests pin the
  // shape so a flip to `>= 0` (always true) blows up at least one
  // assertion.

  it("omits 'added' on tag FieldChange when only tags were removed", () => {
    const a = makeModel({ elements: [{ name: "x", tags: ["legacy", "v1"] }] });
    const b = makeModel({ elements: [{ name: "x", tags: ["v1"] }] });
    const change = diff(a, b).changes.find(
      (c) => c.action === "modified" && c.entity === "element",
    );
    const tagField = change?.fields.find((f) => f.field === "tags");
    expect(tagField).toBeDefined();
    expect(tagField?.removed).toEqual(["legacy"]);
    // The whole point: when nothing was added the key must be absent,
    // not present-but-empty. Pin both `added in field` and the
    // structural shape.
    expect(tagField && "added" in tagField).toBe(false);
  });

  it("omits 'removed' on tag FieldChange when only tags were added", () => {
    const a = makeModel({ elements: [{ name: "x", tags: ["v1"] }] });
    const b = makeModel({ elements: [{ name: "x", tags: ["v1", "v2"] }] });
    const change = diff(a, b).changes.find(
      (c) => c.action === "modified" && c.entity === "element",
    );
    const tagField = change?.fields.find((f) => f.field === "tags");
    expect(tagField?.added).toEqual(["v2"]);
    expect(tagField && "removed" in tagField).toBe(false);
  });

  it("omits 'added' on boundary elementNames delta when only removals occurred", () => {
    const a = makeModel({
      elements: [{ name: "x" }, { name: "y" }],
      boundaries: [{ name: "b", elementNames: ["x", "y"] }],
    });
    const b = makeModel({
      elements: [{ name: "x" }, { name: "y" }],
      boundaries: [{ name: "b", elementNames: ["x"] }],
    });
    const change = diff(a, b).changes.find((c) => c.entity === "boundary");
    const field = change?.fields.find((f) => f.field === "elementNames");
    expect(field?.removed).toEqual(["y"]);
    expect(field && "added" in field).toBe(false);
  });
});

describe("computeDiff — pair-collapse guard rails", () => {
  // The collapse fires only when ONE removed and ONE added share the
  // (from, to) bucket. Mutation testing flagged `rems.length !== 1 ||
  // adds.length !== 1` survivors: a flip to `&&` would still pass
  // tests that only exercise the symmetric 1↔1 and N↔N shapes. The
  // asymmetric 1↔2 / 2↔1 cases below pin the OR semantics.

  it("does NOT collapse when one side has multiple matching edges (1 removed, 2 added)", () => {
    const a = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y", technology: "rest" }] },
        { name: "y" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "x",
          relations: [
            { to: "y", technology: "grpc" },
            { to: "y", technology: "kafka" },
          ],
        },
        { name: "y" },
      ],
    });
    const result = diff(a, b);
    const modified = result.changes.filter(
      (c) => c.action === "modified" && c.entity === "relation",
    );
    // Asymmetric pair must not collapse into a single modified.
    expect(modified).toHaveLength(0);
    // We expect the original to be removed and both new edges added —
    // 3 separate changes, not a single technology-change collapse.
    expect(
      result.changes.filter(
        (c) =>
          c.entity === "relation" &&
          (c.action === "added" || c.action === "removed"),
      ),
    ).toHaveLength(3);
  });

  it("does NOT collapse when one side has multiple matching edges (2 removed, 1 added)", () => {
    const a = makeModel({
      elements: [
        {
          name: "x",
          relations: [
            { to: "y", technology: "rest" },
            { to: "y", technology: "grpc" },
          ],
        },
        { name: "y" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "x", relations: [{ to: "y", technology: "kafka" }] },
        { name: "y" },
      ],
    });
    const result = diff(a, b);
    expect(
      result.changes.filter(
        (c) => c.entity === "relation" && c.action === "modified",
      ),
    ).toHaveLength(0);
  });
});

describe("computeDiff — jaccard similarity edge cases", () => {
  // jaccard(setA, setB) returns 1 when BOTH sets are empty (degenerate
  // perfect-match) and computes intersection/union otherwise.
  // Surviving mutants on the `setA.size === 0 && setB.size === 0`
  // guard say that case isn't exercised. We exercise it indirectly
  // via rename detection: two elements with no outgoing relations
  // depend on the empty/empty branch for the relations-similarity
  // component, so a flip to OR-semantics would either over- or
  // under-detect the rename below.

  it("detects rename of two elements that both have no outgoing relations", () => {
    const a = makeModel({
      elements: [{ name: "svc_a", label: "Identical Label" }],
    });
    const b = makeModel({
      elements: [{ name: "svcA", label: "Identical Label" }],
    });
    const result = diff(a, b);
    const renamed = result.changes.filter((c) => c.action === "renamed");
    expect(renamed).toHaveLength(1);
  });

  it("does NOT spuriously rename when one element has relations and the other has none", () => {
    // Asymmetric relations sets push jaccard below the threshold even
    // if labels match. The empty / non-empty case must NOT take the
    // `return 1` short-circuit.
    const a = makeModel({
      elements: [
        { name: "alpha", label: "Same", relations: [{ to: "ext" }] },
        { name: "ext" },
      ],
    });
    const b = makeModel({
      elements: [{ name: "beta", label: "Same" }, { name: "ext" }],
    });
    const result = diff(a, b, { renameThreshold: 0.95 });
    const renamed = result.changes.filter((c) => c.action === "renamed");
    expect(renamed).toHaveLength(0);
  });
});
