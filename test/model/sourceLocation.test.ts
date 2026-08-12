import type {
  Boundary,
  Element,
  Relation,
  SourceLocation,
  SourcePosition,
} from "../../src/model";

/**
 * These tests pin the shape of `SourceLocation` / `SourcePosition`. They
 * exist because the type is a public contract that the chevrotain parser
 * (in progress) is being designed around — accidental shape changes
 * here would force a v4. Any breakage of these tests is intentional only
 * if the user has explicitly approved a SourceLocation API change.
 */
describe("SourcePosition shape", () => {
  it("requires line, col, offset — all three mandatory", () => {
    // Compile-time check: a SourcePosition with the three fields must be
    // assignable. If a future change makes any of them optional, this
    // declaration would still pass; the negative checks below catch that.
    const pos: SourcePosition = { line: 1, col: 1, offset: 0 };
    expect(pos.line).toBe(1);
    expect(pos.col).toBe(1);
    expect(pos.offset).toBe(0);
  });

  it("rejects positions missing any of the three required fields", () => {
    // @ts-expect-error — `col` and `offset` are mandatory.
    const missingCol: SourcePosition = { line: 1, offset: 0 };
    // @ts-expect-error — `offset` is mandatory.
    const missingOffset: SourcePosition = { line: 1, col: 1 };
    // @ts-expect-error — `line` is mandatory.
    const missingLine: SourcePosition = { col: 1, offset: 0 };
    expect([missingCol, missingOffset, missingLine]).toHaveLength(3);
  });
});

describe("SourceLocation shape", () => {
  const pos = (line: number, col: number, offset: number): SourcePosition => ({
    line,
    col,
    offset,
  });

  it("requires file + start + end", () => {
    const loc: SourceLocation = {
      file: "workspace.dsl",
      start: pos(12, 4, 320),
      end: pos(12, 30, 346),
    };
    expect(loc.file).toBe("workspace.dsl");
    expect(loc.start.line).toBe(12);
    expect(loc.end.col).toBe(30);
  });

  it("rejects locations missing any of file / start / end", () => {
    // @ts-expect-error — `end` is mandatory when a location is present.
    const noEnd: SourceLocation = { file: "x", start: pos(1, 1, 0) };
    // @ts-expect-error — `start` is mandatory.
    const noStart: SourceLocation = { file: "x", end: pos(1, 1, 0) };
    // @ts-expect-error — `file` is mandatory.
    const noFile: SourceLocation = { start: pos(1, 1, 0), end: pos(1, 1, 0) };
    expect([noEnd, noStart, noFile]).toHaveLength(3);
  });

  it("rejects the legacy v3.0-beta shape (no top-level line/column/endLine)", () => {
    // Pre-Phase-0 shape was { file, line, column?, endLine? }. The new
    // shape replaces it cleanly — positions live inside start/end. This
    // test pins that legacy fields are gone at the type level.
    const legacy: SourceLocation = {
      file: "x",
      start: pos(1, 1, 0),
      end: pos(1, 1, 0),
      // @ts-expect-error — `line` is no longer a SourceLocation field.
      line: 1,
    };
    expect(legacy.file).toBe("x");
  });
});

describe("SourceLocation is optional on every Model node", () => {
  // Each of these must compile without `sourceLocation`. If a future
  // change makes it required, the chevrotain refactor will need to
  // populate it on every fixture and every legacy loader — a breaking
  // change we explicitly want to keep off the table.

  it("Container.sourceLocation stays optional", () => {
    const c: Element = {
      name: "x",
      label: "X",
      kind: "Container",
      external: false,
      description: "",
      tags: [],
      relations: [],
    };
    expect(c.sourceLocation).toBeUndefined();
  });

  it("Boundary.sourceLocation stays optional", () => {
    const b: Boundary = {
      name: "x",
      label: "X",
      kind: "System",
      tags: [],
      elementNames: [],
      boundaryNames: [],
    };
    expect(b.sourceLocation).toBeUndefined();
  });

  it("Relation.sourceLocation stays optional", () => {
    const r: Relation = {
      to: "y",
      tags: [],
    };
    expect(r.sourceLocation).toBeUndefined();
  });
});
