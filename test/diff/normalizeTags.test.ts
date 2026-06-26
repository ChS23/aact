import { describe, expect, it } from "vitest";

import { meaningfulTags } from "../../src";
import { computeDiff } from "../../src/diff";
import type { Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

const SIDE_BASE = { source: "baseline", format: "structurizr" } as const;
const SIDE_CURR = { source: "current", format: "kubernetes" } as const;

const diff = (a: Model, b: Model, opts = {}) =>
  computeDiff(a, b, SIDE_BASE, SIDE_CURR, opts);

describe("meaningfulTags", () => {
  it("drops implicit tags that duplicate a typed field", () => {
    expect(meaningfulTags(["Element", "Container", "repo"])).toEqual(["repo"]);
    expect(meaningfulTags(["Element", "Software System"])).toEqual([]);
    expect(meaningfulTags(["External"])).toEqual([]);
    expect(meaningfulTags(["Relationship"])).toEqual([]);
  });

  it("keeps domain tags (incl. async) in order", () => {
    expect(meaningfulTags(["acl", "Element", "owner:platform"])).toEqual([
      "acl",
      "owner:platform",
    ]);
    expect(meaningfulTags(["async", "Relationship"])).toEqual(["async"]);
  });

  it("handles undefined", () => {
    const noTags: readonly string[] | undefined = undefined;
    expect(meaningfulTags(noTags)).toEqual([]);
  });
});

describe("computeDiff — implicit tags don't create cross-format noise", () => {
  it("reports no tags change when the only difference is styling tags", () => {
    // Mirrors `architecture.dsl` (structurizr stamps Element/Container)
    // diffed against a `./k8s/` model (no implicit tags).
    const dsl = makeModel({
      elements: [{ name: "orders-api", tags: ["Element", "Container"] }],
    });
    const k8s = makeModel({ elements: [{ name: "orders-api", tags: [] }] });
    const result = diff(dsl, k8s);
    expect(result.changes).toHaveLength(0);
  });

  it("still reports a real domain-tag change through the styling noise", () => {
    const dsl = makeModel({
      elements: [{ name: "orders-db", tags: ["Element", "Container", "repo"] }],
    });
    const k8s = makeModel({ elements: [{ name: "orders-db", tags: [] }] });
    const result = diff(dsl, k8s);
    const tagChange = result.changes
      .flatMap((c) => ("fields" in c ? (c.fields ?? []) : []))
      .find((f) => f.field === "tags");
    expect(tagChange).toBeDefined();
    expect(tagChange?.removed).toEqual(["repo"]);
  });

  it("does not let styling tags dilute rename similarity", () => {
    // Same element renamed; baseline carries styling tags, current
    // (k8s-style) doesn't. Tag-Jaccard must not drag the score below
    // the rename threshold.
    const before = makeModel({
      elements: [
        {
          name: "orders-repository",
          label: "Orders Repository",
          tags: ["Element", "Container", "repo"],
          relations: [{ to: "orders-db" }],
        },
        { name: "orders-db", tags: ["Element", "Container"] },
      ],
    });
    const after = makeModel({
      elements: [
        {
          name: "orders-repo",
          label: "Orders Repository",
          tags: ["repo"],
          relations: [{ to: "orders-db" }],
        },
        { name: "orders-db", tags: [] },
      ],
    });
    const result = diff(before, after);
    const renamed = result.changes.find((c) => c.action === "renamed");
    expect(renamed).toBeDefined();
  });
});
