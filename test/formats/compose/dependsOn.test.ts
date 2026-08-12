import { normalizeDependsOn } from "../../../src/formats/compose/dependsOn";

describe("normalizeDependsOn", () => {
  it("returns empty array for undefined", () => {
    // Param is required + nullable; passing undefined is the documented null path.
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(normalizeDependsOn(undefined)).toEqual([]);
  });

  it("returns empty array for empty array form", () => {
    expect(normalizeDependsOn([])).toEqual([]);
  });

  it("returns empty array for empty map form", () => {
    expect(normalizeDependsOn({})).toEqual([]);
  });

  it("short array form returns names verbatim", () => {
    expect(normalizeDependsOn(["db", "cache"])).toEqual(["db", "cache"]);
  });

  it("preserves order in short form (stable diff)", () => {
    expect(normalizeDependsOn(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("long map form returns map keys", () => {
    const result = normalizeDependsOn({
      db: { condition: "service_healthy" },
      cache: { condition: "service_started" },
    });
    expect([...result]).toEqual(["db", "cache"]);
  });

  it("ignores condition / restart / required fields in map form", () => {
    const result = normalizeDependsOn({
      db: { condition: "service_healthy", restart: true, required: false },
    });
    expect(result).toEqual(["db"]);
  });

  it("array form filters out non-string entries defensively", () => {
    // Compose-spec disallows non-strings here, but we never throw —
    // unknowns are simply skipped.
    const result = normalizeDependsOn(["db", 42 as unknown as string, "cache"]);
    expect(result).toEqual(["db", "cache"]);
  });

  it("returns frozen result", () => {
    expect(Object.isFrozen(normalizeDependsOn(["a"]))).toBe(true);
    expect(Object.isFrozen(normalizeDependsOn({ a: {} }))).toBe(true);
  });
});
