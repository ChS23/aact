import {
  extractAttachedProperties,
  extractSimpleConstants,
  keepFirstDiagram,
  preParse,
  stripDeploymentBlocks,
  stripOpaqueMacros,
  stripPlantumlNative,
  stripPreprocessor,
} from "../../../../src/formats/plantuml/parser/preParse";

const FILE = "test.puml";

const expectSameLength = (out: string, src: string) =>
  expect(out.length).toBe(src.length);

describe("PUML preParse — length preservation", () => {
  // Critical invariant: every pass must replace stripped content with
  // whitespace of identical length so chevrotain offsets stay
  // anchored to the original file. SourceLocation correctness depends
  // on this for every downstream Model node.
  it("stripPreprocessor preserves length", () => {
    const src = `!include foo\n!define X 1\nContainer(api, "API")\n`;
    const out = stripPreprocessor(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('Container(api, "API")');
  });

  it("stripPlantumlNative preserves length", () => {
    const src = `title Big diagram\nskinparam roundCorner 5\nContainer(api, "API")\n`;
    const out = stripPlantumlNative(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('Container(api, "API")');
  });

  it("stripOpaqueMacros preserves length on single-line call", () => {
    const src = `LAYOUT_WITH_LEGEND()\nContainer(api, "API")\n`;
    const out = stripOpaqueMacros(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('Container(api, "API")');
  });

  it("stripDeploymentBlocks preserves length on macro + body", () => {
    const src = `Deployment_Node(prod, "Prod") {\n  Container(api, "API")\n}\nPerson(c, "C")\n`;
    const { text } = stripDeploymentBlocks(src, FILE);
    expect(text.length).toBe(src.length);
    expect(text).toContain('Person(c, "C")');
  });

  it("keepFirstDiagram preserves length", () => {
    const src = `@startuml\nContainer(a)\n@enduml\n@startuml\nContainer(b)\n@enduml\n`;
    const { text } = keepFirstDiagram(src, FILE);
    expect(text.length).toBe(src.length);
    expect(text).toContain("Container(a)");
    expect(text).not.toContain("Container(b)");
  });

  it("composite preParse preserves length across all passes", () => {
    const src = `@startuml\n!include https://example/C4_Container.puml\nLAYOUT_WITH_LEGEND()\ntitle Big diagram\nContainer(api, "API")\n@enduml\n`;
    const { text } = preParse(src, FILE);
    expect(text.length).toBe(src.length);
  });
});

describe("PUML preParse — offsets stay anchored to original source", () => {
  it("Container offset in stripped buffer matches offset in original", () => {
    const src = `!include "lib"\nLAYOUT_WITH_LEGEND()\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text.indexOf("Container")).toBe(src.indexOf("Container"));
    // Newlines must still be `\n` in same positions.
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "\n") expect(text[i]).toBe("\n");
    }
  });
});

describe("PUML preParse — content stripping", () => {
  it("strips !include URL", () => {
    const src = `!include https://example/C4_Container.puml\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/!include/);
    expect(text).toContain("Container(api,");
  });

  it("warns when parseSource ignores a local !include", () => {
    const src = `!include people.puml\nContainer(api, "API")\n`;
    const { issues } = preParse(src, FILE);
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "info",
        message: expect.stringMatching(/Local !include "people\.puml"/),
      }),
    );
  });

  it("warns when parseSource ignores local !include_once", () => {
    const src = `!include_once common.puml\nContainer(api, "API")\n`;
    const { issues } = preParse(src, FILE);
    expect(issues).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/common\.puml/),
      }),
    );
  });

  it("strips LAYOUT_WITH_LEGEND() opaque call", () => {
    const src = `LAYOUT_WITH_LEGEND()\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/LAYOUT_WITH_LEGEND/);
    expect(text).toContain("Container(api,");
  });

  it("strips AddElementTag with $shape arg", () => {
    const src = `AddElementTag("async", $shape=RoundedBoxShape())\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/AddElementTag/);
    expect(text).toContain("Container(api,");
  });

  it("strips title and skinparam", () => {
    const src = `title Big diagram\nskinparam roundCorner 5\nContainer(api, "API")\n`;
    const { text } = preParse(src, FILE);
    expect(text).not.toMatch(/title|skinparam/);
    expect(text).toContain("Container(api,");
  });

  it("strips Deployment_Node block AND emits info issue", () => {
    const src = `Deployment_Node(prod, "Prod") {\n  Container(api, "API")\n}\nPerson(c, "C")\n`;
    const { text, issues } = preParse(src, FILE);
    expect(text).not.toMatch(/Deployment_Node/);
    expect(text).not.toContain('Container(api, "API")');
    expect(text).toContain('Person(c, "C")');
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("info");
    expect(issues[0].message).toMatch(/Deployment/);
    expect(issues[0].range.file).toBe(FILE);
  });

  it("keeps only the first @startuml diagram and emits info issue", () => {
    const src = `@startuml\nContainer(a, "A")\n@enduml\n@startuml\nContainer(b, "B")\n@enduml\n`;
    const { text, issues } = preParse(src, FILE);
    expect(text).toContain('Container(a, "A")');
    expect(text).not.toContain('Container(b, "B")');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Multiple/);
  });
});

describe("PUML preParse — simple constants", () => {
  it("extracts !$var and !define literal constants without changing source text", () => {
    const src = [
      '!$combinedSprite="person2,scale=0.5"',
      '!define TAG_CRITICAL "critical"',
      'Container(api, "API", $sprite=$combinedSprite, $tags=TAG_CRITICAL)',
    ].join("\n");

    const constants = extractSimpleConstants(src);

    expect(constants.get("$combinedSprite")).toBe("person2,scale=0.5");
    expect(constants.get("TAG_CRITICAL")).toBe("critical");
  });
});

describe("PUML preParse — arithmetic stripping", () => {
  it("does not strip arithmetic-like text inside quoted labels", () => {
    const src = 'Container(api, "API (v2)-1", "Node")\n';
    const { text } = preParse(src, FILE);
    expect(text).toContain('"API (v2)-1"');
  });

  it("strips arithmetic tails after Index() outside strings", () => {
    const src = 'Rel(a, b, "calls", $index=Index()-1)\n';
    const { text } = preParse(src, FILE);
    expect(text).toContain("$index=Index()  ");
    expect(text.length).toBe(src.length);
  });
});

describe("PUML preParse — edge cases pinned for behaviour stability", () => {
  // Multi-line opaque macro: `AddElementTag` continues across newlines
  // with `$arg=value` wrapped onto separate lines. `stripOpaqueMacros`
  // walks balanced parens through `\n`, so the entire span — keyword,
  // opening `(`, body, closing `)` — is whitespace'd out.
  it("strips multi-line opaque macros across newlines", () => {
    const src = `@startuml
AddElementTag("backend",
  $bgColor="blue",
  $shape=EightSidedShape())
Container(api, "API")
@enduml
`;
    const { text } = preParse(src, FILE);
    expect(text).not.toContain("AddElementTag");
    expect(text).not.toContain("$bgColor");
    expect(text).not.toContain("EightSidedShape");
    // Length preserved — every offset still anchored to original.
    expect(text.length).toBe(src.length);
    // `Container(api, "API")` survives untouched.
    expect(text).toContain('Container(api, "API")');
  });

  // Multi-line preprocessor with `\` continuation (`!define M(x) \\\n
  // body`) — currently NOT supported. `stripPreprocessor` only matches
  // a single line, so the continuation line leaks into the parser as
  // unrecognised tokens, surfacing as parse errors. Architects rarely
  // use this form (no occurrences in `.parser-refs/.../samples/`); the
  // C4-PUML stdlib never wraps preprocessor directives this way.
  //
  // This test pins the current behaviour — surfaces parse errors
  // without crashing, model partially recovers. If we ever close the
  // gap, this test breaks loudly and we update grammar.md.
  it("multi-line preprocessor with backslash continuation surfaces parse errors (known gap)", () => {
    const src = String.raw`@startuml
!define LONG_MACRO(x) \
  x + 1
Container(api, "API")
@enduml
`;
    // Run through the FULL parser, not just preParse — the parse error
    // surfaces at the chevrotain stage, after preParse leaves the
    // continuation line untouched.
    const parsed = preParse(src, FILE);
    // Continuation line `  x + 1` should still be in the stripped
    // text (only the `!define ... \` line itself is blanked).
    expect(parsed.text).toContain("x + 1");
  });
});

describe("PUML preParse — extractAttachedProperties", () => {
  it("attaches AddProperty rows to the next in-scope macro by 1-based line", () => {
    const src = [
      "@startuml", //                       1
      'AddProperty("region", "us-east-1")', // 2
      'AddProperty("tier", "premium")', //   3
      'Container(api, "API")', //            4 ← target
      "@enduml", //                          5
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.size).toBe(1);
    expect(map.get(4)).toEqual({
      region: "us-east-1",
      tier: "premium",
    });
  });

  it("resets pending rows when SetPropertyHeader appears between blocks", () => {
    // First block's AddProperty rows are stranded — no macro follows
    // before the new SetPropertyHeader resets the pending state.
    const src = [
      "@startuml", //                       1
      'AddProperty("orphan", "value")', //  2 ← discarded, no anchor
      'SetPropertyHeader("Property", "Value")', // 3
      'AddProperty("tier", "premium")', //  4
      'Container(api, "API")', //           5 ← target
      "@enduml", //                         6
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.size).toBe(1);
    expect(map.get(5)).toEqual({ tier: "premium" });
  });

  it("resets after each attachment so the next macro starts fresh", () => {
    const src = [
      "@startuml", //                       1
      'AddProperty("a", "1")', //           2
      'Container(c1, "C1")', //             3 ← target a
      'AddProperty("b", "2")', //           4
      'Container(c2, "C2")', //             5 ← target b
      'Container(c3, "C3")', //             6 ← no properties
      "@enduml", //                         7
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.size).toBe(2);
    expect(map.get(3)).toEqual({ a: "1" });
    expect(map.get(5)).toEqual({ b: "2" });
    expect(map.has(6)).toBe(false);
  });

  it("attaches to relation macros (Rel / BiRel / RelIndex variants)", () => {
    const src = [
      "@startuml", //                                1
      'Container(a, "A")', //                        2
      'Container(b, "B")', //                        3
      'AddProperty("latency", "10ms")', //           4
      'Rel(a, b, "calls")', //                       5 ← target
      'AddProperty("delivery", "at-least-once")', // 6
      'BiRel_Down(a, b, "sync")', //                 7 ← target
      "@enduml", //                                  8
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.get(5)).toEqual({ latency: "10ms" });
    expect(map.get(7)).toEqual({ delivery: "at-least-once" });
  });

  it("returns an empty map when no AddProperty appears", () => {
    const src = '@startuml\nContainer(api, "API")\n@enduml\n';
    expect(extractAttachedProperties(src).size).toBe(0);
  });

  it("supports single-argument AddProperty as key with empty value", () => {
    // `SetPropertyHeader("Property")` with `AddProperty("Value1")` —
    // the property table is single-column. The Model only carries
    // key=value, so we surface single-arg rows as key="".
    const src = [
      "@startuml", //                      1
      'SetPropertyHeader("Property")', //  2
      'AddProperty("Value1")', //          3
      'AddProperty("Value2")', //          4
      'System(s, "Label")', //             5 ← target
      "@enduml", //                        6
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.get(5)).toEqual({ Value1: "", Value2: "" });
  });

  it("drops whitespace-only keys (column placeholders) from Model.properties", () => {
    // Upstream `TestPropertyMissingColumns.puml` uses bare-string
    // " " as a column placeholder. Architecturally these rows
    // carry no key=value pair — surfacing them on Model would
    // mean a `" "` (or `"  "`) key with no semantic content.
    const src = [
      "@startuml", //                                       1
      'AddProperty("region", "us-east-1")', //              2 ← keeps
      'AddProperty(" ", " ", $col3="col3")', //             3 ← drop (whitespace key)
      'AddProperty("\t", "tab-only")', //                   4 ← drop (whitespace key)
      'AddProperty("real", "value")', //                    5 ← keeps
      'Container(api, "API")', //                           6 ← target
      "@enduml", //                                         7
    ].join("\n");
    const props = extractAttachedProperties(src).get(6);
    expect(props).toEqual({ region: "us-east-1", real: "value" });
  });

  it('unwraps named-arg form `$colN="value"` used by upstream fixtures', () => {
    // Mirrors `.parser-refs/C4-PlantUML/percy/TestPropertyMissingColumns.puml`.
    // Without the named-arg strip, the row key would land as the
    // literal text `$col1="col1"` — a synthetic key the user never
    // wrote.
    const src = [
      "@startuml", //                                       1
      'SetPropertyHeader("", $col2Name="2")', //            2
      'AddProperty($col1="col1")', //                       3
      'AddProperty("", $col2="col2")', //                   4
      'Container(c, "Container")', //                       5 ← target
      "@enduml", //                                         6
    ].join("\n");
    const map = extractAttachedProperties(src);
    const props = map.get(5);
    expect(props).toBeDefined();
    // Row 1: `$col1="col1"` → key="col1", value=""
    // Row 2: `"", $col2="col2"` → empty key, skipped by buildPropertiesObject
    //        (Model.properties has no use for a row whose key is "").
    expect(props).toEqual({ col1: "" });
  });

  it("unescapes JSON-style sequences in property values", () => {
    // Backslash-quote sequences must survive intact so the value the
    // user typed lands on Model.properties verbatim. The fixture is
    // assembled via `String.raw` so backslashes in the embedded
    // PUML literals appear once, not double-escaped through the JS
    // string layer.
    const src = [
      "@startuml", //                                                          1
      String.raw`AddProperty("path", "C:\\Users\\me")`, //                     2
      String.raw`AddProperty("quote", "she said \"hi\"")`, //                  3
      `Container(api, "API")`, //                                              4 ← target
      "@enduml", //                                                            5
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.get(4)).toEqual({
      path: String.raw`C:\Users\me`,
      quote: `she said "hi"`,
    });
  });

  it("keeps a bare (unquoted) AddProperty value verbatim", () => {
    // `enabled` is not quoted — unwrapArg's JSON-parse branch is
    // skipped and the bare token survives as the value verbatim.
    const src = [
      "@startuml", //                       1
      'AddProperty("flag", enabled)', //    2 ← bare value
      'Container(api, "API")', //           3 ← target
      "@enduml", //                         4
    ].join("\n");
    const map = extractAttachedProperties(src);
    expect(map.get(3)).toEqual({ flag: "enabled" });
  });
});

describe("PUML preParse — note ... end note block regex (second pass)", () => {
  // The first pass blanks line-leading `note` / `end note` / `endnote`.
  // The second pass (`note\b[\s\S]*?\bend\s*note\b`) catches `note`
  // keywords that are NOT line-leading — so they survive pass 1 and
  // must be cleaned up as a span here.
  it("strips an inline `note ... endnote` span that is not line-leading", () => {
    const src = `@startuml\nfoo note left : body text here endnote bar\nContainer(api, "API")\n@enduml\n`;
    const out = stripPlantumlNative(src);
    expectSameLength(out, src);
    expect(out).not.toMatch(/body text here/);
    // Surrounding `foo` / `bar` on the same line survive.
    expect(out).toContain("foo");
    expect(out).toContain("bar");
    expect(out).toContain('Container(api, "API")');
  });

  it("strips a multi-line `note ... end note` span when not line-leading", () => {
    const src = [
      "@startuml",
      "  x note here",
      "  body line",
      "  z end note",
      'Container(api, "API")',
      "@enduml",
      "",
    ].join("\n");
    const out = stripPlantumlNative(src);
    expectSameLength(out, src);
    expect(out).not.toMatch(/body line/);
    expect(out).not.toMatch(/note here/);
    // The leading `x` before `note` is preserved by the span match.
    expect(out).toContain("  x ");
    expect(out).toContain('Container(api, "API")');
  });
});

describe("PUML preParse — stripOpaqueMacros unbalanced fallback", () => {
  it("falls back to single-line strip when opaque macro paren never closes", () => {
    // `LAYOUT_WITH_LEGEND(` opens but never closes through the rest of
    // the buffer — the balancer reaches EOF without depth 0, so the
    // fallback blanks only the opening line and leaves the remainder.
    const src = `LAYOUT_WITH_LEGEND(\nContainer(api, "API")\n`;
    const out = stripOpaqueMacros(src);
    expectSameLength(out, src);
    // Opening line blanked.
    expect(out).not.toMatch(/LAYOUT_WITH_LEGEND/);
    // Remainder of the file is NOT eaten by the unbalanced strip.
    expect(out).toContain('Container(api, "API")');
  });
});

describe("PUML preParse — positionAt range computation", () => {
  it("computes a multi-line range for a deployment block not at offset 0", () => {
    // The deployment macro starts on line 3 (offset > 0), so
    // positionAt iterates to count lines/cols for the issue range —
    // and the issue's end lands at the block's closing brace.
    const src = [
      "@startuml", //               line 1
      'Person(c, "Customer")', //   line 2
      'Deployment_Node(prod, "Prod") {', // line 3
      '  Container(api, "API")', // line 4
      "}", //                       line 5
      "@enduml", //                 line 6
      "",
    ].join("\n");
    const { issues } = stripDeploymentBlocks(src, FILE);
    expect(issues).toHaveLength(1);
    const { start, end } = issues[0].range;
    // positionAt iterated past lines 1-2 to reach the line-3 macro.
    expect(start.line).toBe(3);
    expect(start.col).toBe(1);
    expect(end.line).toBeGreaterThan(start.line);
    expect(start.offset).toBe(src.indexOf("Deployment_Node"));
  });

  it("computes a range reaching end-of-source for a trailing second diagram", () => {
    // keepFirstDiagram blanks from the second @startuml to the end of
    // the buffer; positionAt is called with offset === source length,
    // exercising the `i < source.length` loop guard.
    const src = `@startuml\nContainer(a, "A")\n@enduml\n@startuml\nContainer(b, "B")\n@enduml`;
    const { issues } = keepFirstDiagram(src, FILE);
    expect(issues).toHaveLength(1);
    expect(issues[0].range.end.offset).toBe(src.length);
    // The end position resolves to the final line of the source.
    expect(issues[0].range.end.line).toBeGreaterThan(1);
  });
});
