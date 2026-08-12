import {
  normalizeLabels,
  resolveLabelKeys,
} from "../../../src/formats/compose/labels";

describe("normalizeLabels", () => {
  it("returns empty map for undefined input", () => {
    // Required nullable param — explicit undefined exercises the early-return branch.
    // eslint-disable-next-line unicorn/no-useless-undefined
    const result = normalizeLabels(undefined);
    expect(result.map).toEqual({});
    expect(result.malformedIndices).toEqual([]);
  });

  it("normalizes mapping form (string values)", () => {
    const result = normalizeLabels({
      "aact.kind": "ContainerDb",
      "aact.tags": "critical,storage",
    });
    expect(result.map).toEqual({
      "aact.kind": "ContainerDb",
      "aact.tags": "critical,storage",
    });
    expect(result.malformedIndices).toEqual([]);
  });

  it("coerces non-string mapping values to strings", () => {
    // YAML mapping form can deliver boolean / number values; we expect
    // the loader to stringify them so downstream code reads consistent
    // `Record<string,string>`.
    const result = normalizeLabels({
      "aact.external": true as unknown as string,
      "aact.count": 42 as unknown as string,
      "aact.null": null as unknown as string,
    });
    expect(result.map).toEqual({
      "aact.external": "true",
      "aact.count": "42",
      "aact.null": "",
    });
  });

  it("normalizes list form (KEY=VALUE strings)", () => {
    const result = normalizeLabels([
      "aact.kind=ContainerDb",
      "aact.tags=critical,storage",
    ]);
    expect(result.map).toEqual({
      "aact.kind": "ContainerDb",
      "aact.tags": "critical,storage",
    });
    expect(result.malformedIndices).toEqual([]);
  });

  it("bare KEY (no =) in list form gets empty-string value", () => {
    const result = normalizeLabels(["aact.bare"]);
    expect(result.map).toEqual({ "aact.bare": "" });
    expect(result.malformedIndices).toEqual([]);
  });

  it("non-string list entries are reported as malformed", () => {
    const result = normalizeLabels([
      42 as unknown as string,
      "aact.kind=ContainerDb",
    ]);
    expect(result.map).toEqual({ "aact.kind": "ContainerDb" });
    expect(result.malformedIndices).toEqual([0]);
  });

  it("list-form duplicate keys: last-write-wins", () => {
    const result = normalizeLabels([
      "aact.kind=Container",
      "aact.kind=ContainerDb",
    ]);
    expect(result.map["aact.kind"]).toBe("ContainerDb");
  });

  it("preserves `=` inside value (only first `=` splits)", () => {
    const result = normalizeLabels(["traefik.rule=Host(`api.example.com`)"]);
    expect(result.map["traefik.rule"]).toBe("Host(`api.example.com`)");
  });

  it("freezes the result map", () => {
    const result = normalizeLabels({ "aact.kind": "X" });
    expect(Object.isFrozen(result.map)).toBe(true);
    expect(Object.isFrozen(result.malformedIndices)).toBe(true);
  });
});

describe("resolveLabelKeys", () => {
  it("uses 'aact' prefix when nothing supplied", () => {
    const keys = resolveLabelKeys();
    expect(keys).toEqual({
      element: "aact.element",
      kind: "aact.kind",
      label: "aact.label",
      description: "aact.description",
      technology: "aact.technology",
      tags: "aact.tags",
      external: "aact.external",
      link: "aact.link",
      skip: "aact.skip",
    });
  });

  it("derives keys from custom prefix", () => {
    const keys = resolveLabelKeys({ prefix: "arch" });
    expect(keys.element).toBe("arch.element");
    expect(keys.kind).toBe("arch.kind");
    expect(keys.skip).toBe("arch.skip");
  });

  it("granular per-key override beats prefix-derived key", () => {
    const keys = resolveLabelKeys({
      prefix: "arch",
      element: "custom.id",
      tags: "labels.tags",
    });
    expect(keys.element).toBe("custom.id");
    expect(keys.tags).toBe("labels.tags");
    // Non-overridden keys still derive from prefix.
    expect(keys.kind).toBe("arch.kind");
    expect(keys.description).toBe("arch.description");
  });

  it("granular override works without prefix (uses 'aact' default)", () => {
    const keys = resolveLabelKeys({ kind: "x.kind" });
    expect(keys.kind).toBe("x.kind");
    expect(keys.element).toBe("aact.element");
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(resolveLabelKeys())).toBe(true);
  });
});
