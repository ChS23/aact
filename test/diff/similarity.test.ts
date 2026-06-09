import {
  boundarySimilarity,
  elementSimilarity,
  stringSimilarity,
} from "../../src/diff/similarity";
import type { Boundary, Element } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

// These helpers pull real Element / Boundary objects out of a built
// Model so the similarity functions run against the exact shapes the
// production loaders produce (synthetic SourceLocations included).
const buildElements = (
  specs: NonNullable<Parameters<typeof makeModel>[0]["elements"]>,
): Record<string, Element> => makeModel({ elements: specs }).elements;

const buildBoundaries = (
  specs: NonNullable<Parameters<typeof makeModel>[0]["boundaries"]>,
  elements: NonNullable<Parameters<typeof makeModel>[0]["elements"]> = [],
): Record<string, Boundary> =>
  makeModel({ elements, boundaries: specs }).boundaries;

describe("stringSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(stringSimilarity("api", "api")).toBe(1);
  });

  it("returns 1 for two empty strings (maxLen === 0)", () => {
    expect(stringSimilarity("", "")).toBe(1);
  });

  it("falls between 0 and 1 for partial overlap", () => {
    const s = stringSimilarity("apiV1", "apiV2");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("elementSimilarity — kind gate (default, no relax)", () => {
  it("returns 0 for different kinds when relaxKindFamilies is unset", () => {
    const els = buildElements([
      { name: "a", kind: "Container", label: "Same" },
      { name: "b", kind: "Component", label: "Same" },
    ]);
    expect(elementSimilarity(els.a, els.b)).toBe(0);
  });

  it("scores same-kind elements above 0", () => {
    const els = buildElements([
      { name: "a", kind: "Container", label: "Same" },
      { name: "b", kind: "Container", label: "Same" },
    ]);
    expect(elementSimilarity(els.a, els.b)).toBeGreaterThan(0);
  });
});

describe("elementSimilarity — relaxKindFamilies (same-family soft penalty)", () => {
  it("applies the 0.85 family penalty for Container ↔ ContainerDb", () => {
    const sameKind = buildElements([
      { name: "a", kind: "Container", label: "Store", technology: "Postgres" },
      { name: "b", kind: "Container", label: "Store", technology: "Postgres" },
    ]);
    const crossFamily = buildElements([
      { name: "a", kind: "Container", label: "Store", technology: "Postgres" },
      {
        name: "b",
        kind: "ContainerDb",
        label: "Store",
        technology: "Postgres",
      },
    ]);
    const baseScore = elementSimilarity(sameKind.a, sameKind.b, {
      relaxKindFamilies: true,
    });
    const relaxed = elementSimilarity(crossFamily.a, crossFamily.b, {
      relaxKindFamilies: true,
    });
    expect(relaxed).toBeGreaterThan(0);
    // 0.85 multiplier vs. the same features at full strength.
    expect(relaxed).toBeCloseTo(baseScore * 0.85, 10);
  });

  it("applies the family penalty for Component ↔ ComponentDb", () => {
    const els = buildElements([
      { name: "a", kind: "Component", label: "Repo" },
      { name: "b", kind: "ComponentDb", label: "Repo" },
    ]);
    const score = elementSimilarity(els.a, els.b, {
      relaxKindFamilies: true,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for cross-family kinds even with relax (Container ↔ Component)", () => {
    const els = buildElements([
      { name: "a", kind: "Container", label: "Same" },
      { name: "b", kind: "Component", label: "Same" },
    ]);
    expect(elementSimilarity(els.a, els.b, { relaxKindFamilies: true })).toBe(
      0,
    );
  });

  it("returns 0 for unrelated kinds with relax (Container ↔ Person)", () => {
    const els = buildElements([
      { name: "a", kind: "Container", label: "Same" },
      { name: "b", kind: "Person", label: "Same" },
    ]);
    expect(elementSimilarity(els.a, els.b, { relaxKindFamilies: true })).toBe(
      0,
    );
  });
});

describe("elementSimilarity — properties Jaccard (non-empty token sets)", () => {
  it("gives full credit when property bags are identical", () => {
    const identical = buildElements([
      { name: "a", label: "x", properties: { group: "ops", tier: "1" } },
      { name: "b", label: "x", properties: { group: "ops", tier: "1" } },
    ]);
    const disjoint = buildElements([
      { name: "a", label: "x", properties: { group: "ops" } },
      { name: "b", label: "x", properties: { group: "platform" } },
    ]);
    // Identical key=value tokens → Jaccard 1 for the properties slot;
    // disjoint values share zero tokens → 0 for that slot. So the
    // identical pair scores strictly higher.
    expect(elementSimilarity(identical.a, identical.b)).toBeGreaterThan(
      elementSimilarity(disjoint.a, disjoint.b),
    );
  });

  it("gives partial credit for overlapping key=value tokens", () => {
    const partial = buildElements([
      { name: "a", label: "x", properties: { group: "ops", tier: "1" } },
      { name: "b", label: "x", properties: { group: "ops", tier: "2" } },
    ]);
    const none = buildElements([
      { name: "a", label: "x", properties: { group: "ops", tier: "1" } },
      { name: "b", label: "x", properties: { group: "x", tier: "y" } },
    ]);
    // 1 of 3 tokens shared vs 0 of 4 — partial overlap must beat none.
    expect(elementSimilarity(partial.a, partial.b)).toBeGreaterThan(
      elementSimilarity(none.a, none.b),
    );
  });
});

describe("elementSimilarity — relation targets (renameMap branch)", () => {
  it("uses raw relation targets when no renameMap is supplied", () => {
    const shared = buildElements([
      { name: "a", label: "x", relations: [{ to: "db" }] },
      { name: "b", label: "x", relations: [{ to: "db" }] },
      { name: "db" },
    ]);
    const disjoint = buildElements([
      { name: "a", label: "x", relations: [{ to: "db1" }] },
      { name: "b", label: "x", relations: [{ to: "db2" }] },
      { name: "db1" },
      { name: "db2" },
    ]);
    // No renameMap → raw `.to` targets feed the relations Jaccard. The
    // shared-target pair must out-score the disjoint-target pair.
    expect(elementSimilarity(shared.a, shared.b)).toBeGreaterThan(
      elementSimilarity(disjoint.a, disjoint.b),
    );
  });

  it("remaps baseline relation targets through renameMap", () => {
    const els = buildElements([
      { name: "a", label: "x", relations: [{ to: "old_db" }] },
      { name: "b", label: "x", relations: [{ to: "new_db" }] },
      { name: "old_db" },
      { name: "new_db" },
    ]);
    const withoutMap = elementSimilarity(els.a, els.b);
    const withMap = elementSimilarity(els.a, els.b, {
      renameMap: new Map([["old_db", "new_db"]]),
    });
    // Without the map the relation targets differ (old_db ≠ new_db)
    // so the relations slot scores 0; with the map they coincide.
    expect(withMap).toBeGreaterThan(withoutMap);
  });
});

describe("boundarySimilarity", () => {
  it("returns 0 for different boundary kinds (hard gate)", () => {
    const bnds = buildBoundaries([
      { name: "a", kind: "System", label: "Same" },
      { name: "b", kind: "Container", label: "Same" },
    ]);
    expect(boundarySimilarity(bnds.a, bnds.b)).toBe(0);
  });

  it("scores same-kind boundaries with shared containment above 0", () => {
    const bnds = buildBoundaries(
      [
        { name: "a", kind: "System", label: "Ctx", elementNames: ["x"] },
        { name: "b", kind: "System", label: "Ctx", elementNames: ["x"] },
      ],
      [{ name: "x" }],
    );
    expect(boundarySimilarity(bnds.a, bnds.b)).toBeGreaterThan(0);
  });

  it("remaps baseline elementNames through renameMap", () => {
    const bnds = buildBoundaries(
      [
        { name: "a", kind: "System", label: "Ctx", elementNames: ["old_svc"] },
        { name: "b", kind: "System", label: "Ctx", elementNames: ["new_svc"] },
      ],
      [{ name: "old_svc" }, { name: "new_svc" }],
    );
    const withoutMap = boundarySimilarity(bnds.a, bnds.b);
    const withMap = boundarySimilarity(bnds.a, bnds.b, {
      renameMap: new Map([["old_svc", "new_svc"]]),
    });
    // The renamed member element makes containment Jaccard line up.
    expect(withMap).toBeGreaterThan(withoutMap);
  });
});
