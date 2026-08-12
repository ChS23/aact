import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — opaque workspace blocks", () => {
  it("strips a `views { ... }` block without raising parse errors", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
      }
      views {
        systemContext bank "ctx" {
          include *
          autolayout lr
        }
      }
    }`;
    const { model, parseErrors, opaqueBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["bank"]).toBeDefined();
    expect(opaqueBlocks).toEqual([expect.objectContaining({ name: "views" })]);
    expect(opaqueBlocks[0]?.range.file).toBe("test.dsl");
  });

  it("strips multiple opaque blocks (views + styles + configuration)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
      }
      views {
        systemLandscape "all" { include * }
        styles {
          element "Person" { shape Person }
        }
      }
      configuration {
        users {
          "admin@example.com" read
        }
      }
    }`;
    const { parseErrors, opaqueBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    // `views` (outer) and `configuration`; the inner `styles` lives inside
    // `views` so it is consumed by the outer balance-brace skip.
    expect(opaqueBlocks.map((b) => b.name).sort()).toEqual([
      "configuration",
      "views",
    ]);
  });

  it("balances nested braces inside an opaque block", () => {
    const src = `workspace {
      model { bank = softwareSystem "Bank" }
      views {
        container bank {
          include *
          autolayout lr
          styles { element "x" { shape Box } }
        }
      }
    }`;
    const { parseErrors, opaqueBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(opaqueBlocks.length).toBe(1);
    expect(opaqueBlocks[0]?.name).toBe("views");
  });

  it("captures source range covering the keyword through closing brace", () => {
    const src = `workspace {
      model { bank = softwareSystem "Bank" }
      views {
        systemContext bank "ctx" { include * }
      }
    }`;
    const { opaqueBlocks } = parse(src);
    const range = opaqueBlocks[0]?.range;
    expect(range?.start.line).toBe(3); // `views {` opens on line 3
    expect(range?.end.line).toBeGreaterThanOrEqual(range.start.line);
  });

  it("leaves a syntactically-broken opaque block to the parser", () => {
    // Missing closing brace — preParse should NOT consume the whole tail
    // of the file, parser should surface a real error.
    const src = `workspace {
      model { bank = softwareSystem "Bank" }
      views {
        systemContext bank "ctx" {
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors.length).toBeGreaterThan(0);
  });
});

describe("Structurizr parser — auxiliary directives (!docs / !script / etc)", () => {
  it("strips inline `!docs <path>` without errors", () => {
    const src = `workspace {
      model {
        !docs "./docs"
        api = container "API"
      }
    }`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("strips inline `!decisions <path> <importer>` (two args)", () => {
    const src = `workspace {
      model {
        !decisions "./adrs" "com.example.Importer"
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("strips inline `!adrs <path>`", () => {
    const src = `workspace {
      model {
        !adrs "./adrs"
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("strips block `!script <lang> { ... }` wholesale", () => {
    const src = `workspace {
      model {
        api = container "API"
        !script "javascript" {
          workspace.model.addPerson("Bot")
        }
      }
    }`;
    const { parseErrors, opaqueBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(opaqueBlocks.some((b) => b.name.startsWith("!script"))).toBe(true);
  });

  it("strips `!element <ref> { ... }` selector block", () => {
    const src = `workspace {
      model {
        api = container "API"
        !element api {
          tag "auto"
        }
      }
    }`;
    const { issues, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loader-warning",
          code: "selector-body-not-applied",
        }),
      ]),
    );
  });

  it("strips `!relationships <selector> { ... }` selector block", () => {
    const src = `workspace {
      model {
        a = container "A"
        b = container "B"
        a -> b
        !relationships "*" {
          tags "auto"
        }
      }
    }`;
    const { issues, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loader-warning",
          code: "selector-body-not-applied",
        }),
      ]),
    );
  });

  it("strips `archetypes { ... }` block (declaration parses cleanly)", () => {
    // Reference fixture `archetypes.dsl` declares alias→base-kind
    // mappings; aact does not yet support alias usages in the model
    // body, but stripping the declaration block keeps the rest of
    // the file parseable.
    const src = `workspace {
      model {
        archetypes {
          mobile = container "" "Xamarin"
          web = container "" "Spring MVC"
        }
        api = container "API"
      }
    }`;
    const { parseErrors, opaqueBlocks } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(opaqueBlocks.some((b) => b.name === "archetypes")).toBe(true);
  });

  it("strips block `!plugin <id> { ... }` wholesale", () => {
    const src = `workspace {
      model {
        api = container "API"
        !plugin "com.foo.Plugin" {
          key value
        }
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });
});

describe("Structurizr parser — hard-removed constructs", () => {
  it("reports `!ref` with the modern replacement hint", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        !ref bank {
          web = container "Web"
        }
      }
    }`;
    const { parseErrors } = parse(src);
    const refError = parseErrors.find((e) => e.message.includes("!ref"));
    expect(refError).toBeDefined();
    expect(refError?.message).toMatch(/no longer supported/);
    expect(refError?.line).toBeGreaterThan(0);
  });

  it("reports `!extend` with the modern replacement hint", () => {
    const src = `workspace {
      model {
        !extend "https://example/base.dsl" {
        }
      }
    }`;
    const { parseErrors } = parse(src);
    const ext = parseErrors.find((e) => e.message.includes("!extend"));
    expect(ext).toBeDefined();
    expect(ext?.message).toMatch(/workspace extends/);
  });

  it("reports `!constant` with rename hint to `!const`", () => {
    const src = `workspace {
      model {
        !constant MY_TAG "platform"
      }
    }`;
    const { parseErrors } = parse(src);
    const c = parseErrors.find((e) => e.message.includes("!constant"));
    expect(c).toBeDefined();
    expect(c?.message).toMatch(/!const/);
  });

  it("reports bare `enterprise` keyword with replacement hint", () => {
    const src = `workspace {
      model {
        enterprise "BigCo" {
          bank = softwareSystem "Bank"
        }
      }
    }`;
    const { parseErrors } = parse(src);
    const e = parseErrors.find((p) => p.message.includes("enterprise"));
    expect(e).toBeDefined();
    expect(e?.message).toMatch(/group/);
  });

  it("surfaces the hard-removed error and lets the parser continue", () => {
    // `!constant NAME VALUE` is a 3-token bare form (no body). The
    // pre-pass drops only `!constant`; the parser still sees the
    // orphan NAME + value tokens and reports normal grammar errors
    // for them. We only assert that the explanatory hard-removed
    // error is in the list.
    const src = `workspace {
      model {
        !constant MY_TAG "platform"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors.some((e) => e.message.includes("!constant"))).toBe(true);
  });

  it('strips the whole `enterprise "X" { ... }` block including body', () => {
    const src = `workspace {
      model {
        enterprise "BigCo" {
          bank = softwareSystem "Bank"
        }
        api = container "API"
      }
    }`;
    const { model, parseErrors } = parse(src);
    // One error for `enterprise`; the body is stripped wholesale so
    // declarations after the block still parse cleanly.
    expect(
      parseErrors.filter((e) => e.message.includes("enterprise")).length,
    ).toBe(1);
    expect(model.elements["api"]).toBeDefined();
    // Bank declared INSIDE the enterprise block is intentionally dropped
    // (we cannot represent the enterprise grouping in the Model).
    expect(model.elements["bank"]).toBeUndefined();
  });

  it("strips `!ref bank { ... }` body wholesale", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        !ref bank {
          web = container "Web"
        }
        api = container "API"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors.some((e) => e.message.includes("!ref"))).toBe(true);
    expect(model.elements["bank"]).toBeDefined();
    expect(model.elements["api"]).toBeDefined();
  });

  it("a hard-removed token on its own does not block declarations that come before it", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        !ref bank
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors.some((e) => e.message.includes("!ref"))).toBe(true);
    expect(model.elements["bank"]).toBeDefined();
  });
});
