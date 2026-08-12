import {
  parseExternalFlag,
  parseSkipFlag,
  resolveAnnotationKeys,
} from "../../../src/formats/kubernetes/annotations";

describe("resolveAnnotationKeys", () => {
  it("defaults to aact.* prefix", () => {
    const keys = resolveAnnotationKeys();
    expect(keys.element).toBe("aact.element");
    expect(keys.kind).toBe("aact.kind");
    expect(keys.label).toBe("aact.label");
    expect(keys.description).toBe("aact.description");
    expect(keys.technology).toBe("aact.technology");
    expect(keys.tags).toBe("aact.tags");
    expect(keys.external).toBe("aact.external");
    expect(keys.link).toBe("aact.link");
    expect(keys.skip).toBe("aact.skip");
    expect(keys.dependsOn).toBe("aact.depends-on");
  });

  it("respects custom prefix", () => {
    const keys = resolveAnnotationKeys({
      annotations: { prefix: "arch" },
    });
    expect(keys.element).toBe("arch.element");
    expect(keys.dependsOn).toBe("arch.depends-on");
  });

  it("empty options object → defaults", () => {
    const keys = resolveAnnotationKeys({});
    expect(keys.element).toBe("aact.element");
  });
});

describe("parseExternalFlag", () => {
  it.each(["true", "TRUE", "True", "1"])("%s → true", (v) => {
    expect(parseExternalFlag(v)).toBe(true);
  });

  it.each(["false", "0", "no", "", "yes", undefined])("%s → false", (v) => {
    expect(parseExternalFlag(v)).toBe(false);
  });

  it("trims whitespace", () => {
    expect(parseExternalFlag("  true  ")).toBe(true);
  });
});

describe("parseSkipFlag", () => {
  it("mirrors parseExternalFlag", () => {
    expect(parseSkipFlag("true")).toBe(true);
    expect(parseSkipFlag("1")).toBe(true);
    expect(parseSkipFlag("false")).toBe(false);
    expect(parseSkipFlag()).toBe(false);
  });
});
