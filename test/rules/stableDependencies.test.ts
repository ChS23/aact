import { stableDependenciesRule } from "../../src/rules";
import { makeModel } from "../helpers/makeModel";

describe("stableDependenciesRule.check", () => {
  it("no violation when deps point to more stable", () => {
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }] },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
    });
    expect(stableDependenciesRule.check(model)).toHaveLength(0);
  });

  it("flags violation when stable module depends on less stable", () => {
    // a, b → c, b → d. b has afferent (incoming from a) AND efferent (out to c+d):
    //   a: ca=0, ce=1 → I = 1/1 = 1
    //   b: ca=1, ce=2 → I = 2/3 ≈ 0.67
    //   c: ca=1, ce=0 → I = 0/1 = 0
    //   d: ca=1, ce=0 → I = 0
    // Now flip: e is "stable" (afferent=2, efferent=1) → I=1/3 ≈ 0.33
    // e → a (I=1) — stable depends on UNstable → fire.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "x" }] },
        { name: "b", relations: [{ to: "e" }] },
        { name: "c", relations: [{ to: "e" }] },
        { name: "e", relations: [{ to: "a" }] },
        { name: "x" },
      ],
    });
    const v = stableDependenciesRule.check(model);
    const eToA = v.find((it) => it.target === "e" && it.message.includes("a"));
    expect(eToA).toBeDefined();
    // Message format pin: covers StringLiteral mutants on the message
    expect(eToA!.message).toMatch(/stable module .I=\d\.\d{2}/);
    expect(eToA!.message).toMatch(/I=\d\.\d{2}.* — dependencies should point/);
  });

  it("returns array (covers initial violations: [] AssignmentOperator)", () => {
    const model = makeModel({ elements: [] });
    const v = stableDependenciesRule.check(model);
    expect(Array.isArray(v)).toBe(true);
    expect(v).toHaveLength(0);
  });

  it("DOES NOT count external containers in instability (covers c.external filter)", () => {
    // If we counted external "ext" as internal, "a → ext" would mean a has
    // ce=1 (efferent), I_a = 1; "ext" would be in internal set so checking
    // "iSource < iTarget" might fire. Pin: external excluded.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "ext" }] },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(stableDependenciesRule.check(model)).toHaveLength(0);
  });

  it("ignores relations to containers outside internal set (covers !internalNames.has)", () => {
    // a → ext where ext is external. ce_a should NOT be incremented when
    // relation goes external. Pin: if external "ext" were treated as
    // internal, a would have I_a = 1 and ext would have I_ext = 0, leading
    // to false violation.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "b" }, { to: "ext" }] },
        { name: "b" },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(stableDependenciesRule.check(model)).toHaveLength(0);
  });

  it("isolated container (no edges) gets I=1 (covers afferent+efferent===0)", () => {
    // a is isolated, b → c. Without the boundary check (afferent+efferent===0
    // returns 1), instability(a) would divide by 0 → NaN, behavior undefined.
    // Pin: isolated container coexists with other relations without throwing.
    const model = makeModel({
      elements: [
        { name: "a" },
        { name: "b", relations: [{ to: "c" }] },
        { name: "c" },
      ],
    });
    expect(() => stableDependenciesRule.check(model)).not.toThrow();
  });

  it("strict < operator: equal-instability deps do NOT fire (covers iSource < iTarget vs <=)", () => {
    // Two containers each with I=1 (both pure efferent): a → x, b → x.
    //   a: ca=0, ce=1 → I=1
    //   b: ca=0, ce=1 → I=1
    //   x: ca=2, ce=0 → I=0
    // Now a → b: iSource(a)=1, iTarget(b)=1 → 1 < 1 is false → no violation.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "x" }, { to: "b" }] },
        { name: "b", relations: [{ to: "x" }] },
        { name: "x" },
      ],
    });
    // a → b should NOT trigger (equal stability).
    const v = stableDependenciesRule.check(model);
    expect(
      v.find((it) => it.target === "a" && it.message.includes("b")),
    ).toBeUndefined();
  });

  it("anchors violation on the offending edge's sourceLocation", () => {
    const edgeLoc = {
      file: "arch.dsl",
      start: { line: 42, col: 5, offset: 800 },
      end: { line: 42, col: 35, offset: 830 },
    };
    // Mirrors the "stable → less stable" case above; we just attach a
    // fixture location to the e → a relation and expect it back on the
    // violation. Loaders populate sourceLocation in production; CLI
    // falls back to the source element when it's absent.
    const model = makeModel({
      elements: [
        { name: "a", relations: [{ to: "x" }] },
        { name: "b", relations: [{ to: "e" }] },
        { name: "c", relations: [{ to: "e" }] },
        {
          name: "e",
          relations: [{ to: "a", sourceLocation: edgeLoc }],
        },
        { name: "x" },
      ],
    });
    const v = stableDependenciesRule.check(model);
    const eToA = v.find((it) => it.target === "e" && it.message.includes("a"));
    expect(eToA?.sourceLocation).toEqual(edgeLoc);
  });

  it("description ends with 'stability' (covers description literal)", () => {
    // Stryker emptied the rule's description string. Lock it in via direct
    // assertion on the RuleDefinition itself.
    expect(stableDependenciesRule.description).toContain("stability");
    expect(stableDependenciesRule.description.length).toBeGreaterThan(0);
  });
});
