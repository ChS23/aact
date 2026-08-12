import type { SourceLocation } from "../../../src/model";
import { applyEdits } from "../../../src/rules/lib/applyEdits";

// Build a SourceLocation that points at `source[start..end]`. Test
// helper — line/col are filled in but the applier only consults
// `.offset`, so we don't bother computing them accurately.
const loc = (
  start: number,
  end: number,
  file = "test.puml",
): SourceLocation => ({
  file,
  start: { line: 1, col: start + 1, offset: start },
  end: { line: 1, col: end + 1, offset: end },
});

describe("applyEdits", () => {
  const source = [
    'Container(svc_a, "Service A")',
    'Container(svc_b, "Service B")',
    'Rel(svc_a, svc_b, "")',
  ].join("\n");
  const aDeclStart = 0;
  const aDeclEnd = 'Container(svc_a, "Service A")'.length;
  const bDeclStart = aDeclEnd + 1; // \n
  const bDeclEnd = bDeclStart + 'Container(svc_b, "Service B")'.length;
  const relStart = bDeclEnd + 1;
  const relEnd = relStart + 'Rel(svc_a, svc_b, "")'.length;

  it("returns source unchanged for empty edits", () => {
    const { content, applied, conflicts } = applyEdits(source, []);
    expect(content).toBe(source);
    expect(applied).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("removes a range", () => {
    const { content } = applyEdits(source, [
      { kind: "remove", range: loc(relStart - 1, relEnd) }, // include leading \n
    ]);
    expect(content).toBe(
      ['Container(svc_a, "Service A")', 'Container(svc_b, "Service B")'].join(
        "\n",
      ),
    );
  });

  it("replaces a range with new content", () => {
    const { content } = applyEdits(source, [
      {
        kind: "replace",
        range: loc(relStart, relEnd),
        content: 'Rel(svc_a, svc_c, "")',
      },
    ]);
    expect(content).toContain('Rel(svc_a, svc_c, "")');
    expect(content).not.toContain("Rel(svc_a, svc_b");
  });

  it("inserts content after an anchor", () => {
    const { content } = applyEdits(source, [
      {
        kind: "insert-after",
        anchor: loc(aDeclStart, aDeclEnd),
        content: '\nContainer(svc_a_acl, "Service A ACL")',
      },
    ]);
    const lines = content.split("\n");
    expect(lines[0]).toBe('Container(svc_a, "Service A")');
    expect(lines[1]).toBe('Container(svc_a_acl, "Service A ACL")');
    expect(lines[2]).toBe('Container(svc_b, "Service B")');
  });

  it("inserts content before an anchor", () => {
    const { content } = applyEdits(source, [
      {
        kind: "insert-before",
        anchor: loc(bDeclStart, bDeclEnd),
        content: 'Container(svc_a_acl, "Service A ACL")\n',
      },
    ]);
    const lines = content.split("\n");
    expect(lines[0]).toBe('Container(svc_a, "Service A")');
    expect(lines[1]).toBe('Container(svc_a_acl, "Service A ACL")');
    expect(lines[2]).toBe('Container(svc_b, "Service B")');
  });

  it("applies multiple non-overlapping edits in one pass", () => {
    const { content, applied, conflicts } = applyEdits(source, [
      { kind: "remove", range: loc(relStart - 1, relEnd) },
      {
        kind: "insert-after",
        anchor: loc(bDeclStart, bDeclEnd),
        content: '\nRel(svc_a, svc_c, "")',
      },
    ]);
    expect(applied).toHaveLength(2);
    expect(conflicts).toEqual([]);
    const lines = content.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('Rel(svc_a, svc_c, "")');
  });

  it("reverse-orders edits so earlier splices do not shift later offsets", () => {
    // Two replaces in input order (first, second) — applier reverses by
    // offset before splicing. Both edits must land on their ORIGINAL
    // byte ranges, not on shifted ones.
    const { content } = applyEdits(source, [
      {
        kind: "replace",
        range: loc(aDeclStart, aDeclEnd),
        content: "Container(A)",
      },
      {
        kind: "replace",
        range: loc(relStart, relEnd),
        content: 'Rel(A, svc_b, "")',
      },
    ]);
    expect(content).toContain("Container(A)");
    expect(content).toContain('Rel(A, svc_b, "")');
  });

  it("reports overlapping edits as conflicts, keeps first, skips second", () => {
    const first = {
      kind: "replace" as const,
      range: loc(relStart, relEnd),
      content: "FIRST_WINS",
    };
    const second = {
      kind: "replace" as const,
      range: loc(relStart + 1, relEnd),
      content: "SECOND_LOSES",
    };
    const { content, applied, conflicts } = applyEdits(source, [first, second]);
    expect(applied).toEqual([first]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].skipped).toBe(second);
    expect(conflicts[0].conflictsWith).toBe(first);
    expect(content).toContain("FIRST_WINS");
    expect(content).not.toContain("SECOND_LOSES");
  });

  it("treats two zero-width inserts at the same offset as a conflict", () => {
    const first = {
      kind: "insert-after" as const,
      anchor: loc(aDeclStart, aDeclEnd),
      content: "X",
    };
    const second = {
      kind: "insert-after" as const,
      anchor: loc(aDeclStart, aDeclEnd),
      content: "Y",
    };
    const { applied, conflicts } = applyEdits(source, [first, second]);
    expect(applied).toEqual([first]);
    expect(conflicts).toHaveLength(1);
  });

  it("allows two zero-width inserts at distinct offsets", () => {
    const { applied, conflicts } = applyEdits(source, [
      {
        kind: "insert-after",
        anchor: loc(aDeclStart, aDeclEnd),
        content: "X",
      },
      {
        kind: "insert-after",
        anchor: loc(bDeclStart, bDeclEnd),
        content: "Y",
      },
    ]);
    expect(applied).toHaveLength(2);
    expect(conflicts).toEqual([]);
  });

  it("operates in UTF-16 code units, matching SourcePosition.offset semantics", () => {
    // Non-ASCII content (cyrillic, emoji) lives in UTF-8 as multibyte
    // sequences, but JS strings are UTF-16 and chevrotain emits
    // UTF-16 code unit offsets. Pin: `applyEdits` slices the same
    // unit producers populate, so cyrillic/emoji prefixes don't
    // shift downstream edits.
    const src = 'Container(svc, "Сервис 📦")\nRel(svc, db, "тест")';
    // `Rel(svc, db, "тест")` starts right after `\n` — count code units.
    const relStart = src.indexOf("Rel(svc, db,");
    const relEnd = relStart + 'Rel(svc, db, "тест")'.length;
    const { content } = applyEdits(src, [
      {
        kind: "replace",
        range: loc(relStart, relEnd),
        content: 'Rel(svc, db, "fixed")',
      },
    ]);
    // Container line stays byte-for-byte intact (no truncated emoji)
    expect(content).toContain('Container(svc, "Сервис 📦")');
    expect(content).toContain('Rel(svc, db, "fixed")');
    expect(content).not.toContain('"тест"');
  });

  it("emits content verbatim — newline/indent are the rule's responsibility", () => {
    // The applier is a pure splicer. If the rule wants the inserted
    // content on its own line, the rule prepends `\n` to `content`.
    const { content } = applyEdits(source, [
      {
        kind: "insert-after",
        anchor: loc(aDeclStart, aDeclEnd),
        content: "INLINE",
      },
    ]);
    // First line now extends with INLINE because content had no \n.
    expect(content.split("\n")[0]).toBe('Container(svc_a, "Service A")INLINE');
  });
});
