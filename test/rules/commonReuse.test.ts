import { commonReuseRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("commonReuseRule.check", () => {
  it("violation when consumer uses subset of provider's public surface", () => {
    const model = makeModel({
      elements: [
        { name: "consumer", relations: [{ to: "p_a" }] },
        { name: "p_a" },
        { name: "p_b" },
        { name: "other", relations: [{ to: "p_b" }] },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a", "p_b"] },
        { name: "cons_ctx", elementNames: ["consumer"] },
        { name: "other_ctx", elementNames: ["other"] },
      ],
    });
    const v = commonReuseRule.check(model);
    expect(v.length).toBeGreaterThan(0);
  });

  it("no violation when single-element public surface", () => {
    const model = makeModel({
      elements: [
        { name: "consumer", relations: [{ to: "p_a" }] },
        { name: "p_a" },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a"] },
        { name: "cons_ctx", elementNames: ["consumer"] },
      ],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });

  it("no violation when consumer uses ALL public surface", () => {
    // Single consumer who uses every element that ANY external consumer
    // pulls in. publicOf collects all cross-boundary targets → p_a + p_b.
    // Consumer uses both → no violation.
    const model = makeModel({
      elements: [
        {
          name: "consumer",
          relations: [{ to: "p_a" }, { to: "p_b" }],
        },
        { name: "p_a" },
        { name: "p_b" },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a", "p_b"] },
        { name: "cons_ctx", elementNames: ["consumer"] },
      ],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });

  it("ignores intra-boundary relations (covers tgtBoundary === srcBoundary)", () => {
    // p_a → p_b is intra-provider. Should NOT count as "consumer uses
    // provider" since it isn't crossing boundaries.
    const model = makeModel({
      elements: [{ name: "p_a", relations: [{ to: "p_b" }] }, { name: "p_b" }],
      boundaries: [{ name: "provider", elementNames: ["p_a", "p_b"] }],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });

  it("ignores relations from container outside any boundary (covers !srcBoundary)", () => {
    // "stray" has no boundary. Its relation should NOT contribute to usage.
    const model = makeModel({
      elements: [
        { name: "stray", relations: [{ to: "p_a" }] },
        { name: "p_a" },
        { name: "p_b" },
      ],
      boundaries: [{ name: "provider", elementNames: ["p_a", "p_b"] }],
    });
    // No consumer boundary → no violation possible.
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });

  it("ignores relations to container outside any boundary (covers !tgtBoundary)", () => {
    const model = makeModel({
      elements: [
        { name: "consumer", relations: [{ to: "loose_target" }] },
        { name: "loose_target" },
      ],
      boundaries: [{ name: "cons_ctx", elementNames: ["consumer"] }],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });

  it("violation message lists used and missing public surface names", () => {
    const model = makeModel({
      elements: [
        { name: "consumer", relations: [{ to: "p_a" }] },
        { name: "p_a" },
        { name: "p_b" },
        { name: "other", relations: [{ to: "p_b" }] },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a", "p_b"] },
        { name: "cons_ctx", elementNames: ["consumer"] },
        { name: "other_ctx", elementNames: ["other"] },
      ],
    });
    const v = commonReuseRule.check(model);
    const violation = v.find((it) => it.target === "cons_ctx");
    expect(violation).toBeDefined();
    expect(violation!.message).toContain("p_a"); // used
    expect(violation!.message).toContain("p_b"); // missing
    expect(violation!.message).toContain('"provider"');
    expect(violation!.message).toContain(
      "all public services of a context should be used together",
    );
  });

  it("multiple consumers: only those with partial usage violate", () => {
    const model = makeModel({
      elements: [
        // full consumer — no violation
        {
          name: "full_c",
          relations: [{ to: "p_a" }, { to: "p_b" }],
        },
        // partial consumer — violation
        { name: "partial_c", relations: [{ to: "p_a" }] },
        { name: "p_a" },
        { name: "p_b" },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a", "p_b"] },
        { name: "full_ctx", elementNames: ["full_c"] },
        { name: "partial_ctx", elementNames: ["partial_c"] },
      ],
    });
    const v = commonReuseRule.check(model);
    expect(v.find((it) => it.target === "partial_ctx")).toBeDefined();
    expect(v.find((it) => it.target === "full_ctx")).toBeUndefined();
  });

  it("anchors violation on the first cross-boundary edge's sourceLocation", () => {
    // `provider`'s public surface needs ≥2 names actually targeted from
    // outside, so a sibling consumer (`full_c`) exercises p_b. The
    // partial consumer in `cons_ctx` hits only p_a — that's the
    // violation we anchor.
    const firstLoc = {
      file: "arch.dsl",
      start: { line: 10, col: 1, offset: 100 },
      end: { line: 10, col: 30, offset: 130 },
    };
    const model = makeModel({
      elements: [
        {
          name: "consumer",
          relations: [{ to: "p_a", sourceLocation: firstLoc }],
        },
        { name: "full_c", relations: [{ to: "p_a" }, { to: "p_b" }] },
        { name: "p_a" },
        { name: "p_b" },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a", "p_b"] },
        { name: "cons_ctx", elementNames: ["consumer"] },
        { name: "full_ctx", elementNames: ["full_c"] },
      ],
    });
    const v = commonReuseRule.check(model);
    const violation = v.find((it) => it.target === "cons_ctx");
    expect(violation?.sourceLocation).toEqual(firstLoc);
  });

  it("rule description mentions public surface usage", () => {
    expect(commonReuseRule.description.length).toBeGreaterThan(20);
    expect(commonReuseRule.description).toMatch(/public|surface|consumer/i);
  });

  it("provider with no cross-boundary consumers: no violation, even with size>=2", () => {
    // Multi-element provider but nobody uses it → not in publicOf at all.
    const model = makeModel({
      elements: [{ name: "p_a" }, { name: "p_b" }],
      boundaries: [{ name: "provider", elementNames: ["p_a", "p_b"] }],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });

  it("usedNames.size === pubNames.size DOES NOT violate (covers >= boundary)", () => {
    // Consumer uses ALL public elements: usedNames.size === pubNames.size.
    // Predicate `usedNames.size >= pubNames.size` should make us skip.
    const model = makeModel({
      elements: [
        {
          name: "consumer",
          relations: [{ to: "p_a" }, { to: "p_b" }],
        },
        { name: "p_a" },
        { name: "p_b" },
      ],
      boundaries: [
        { name: "provider", elementNames: ["p_a", "p_b"] },
        { name: "cons_ctx", elementNames: ["consumer"] },
      ],
    });
    expect(commonReuseRule.check(model)).toHaveLength(0);
  });
});
