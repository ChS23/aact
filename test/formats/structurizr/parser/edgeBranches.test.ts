import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

// These tests target error-recovery and edge branches in the pre-parse
// token passes (preParse.ts), the CST→AST visitor (visitor.ts), and the
// AST→Model lowering (toModel.ts). Each snippet exercises a malformed or
// rarely-used construct; assertions check observable output (Model,
// issues, parseErrors, archetype aliases) rather than internals.

describe("Structurizr parser — archetypes block recovery", () => {
  it("ignores an archetypes header with no opening brace before EOF", () => {
    // `archetypes` followed only by identifiers and then EOF — the
    // opening-brace scan walks off the token stream and bails. The
    // workspace is malformed, but extraction must not throw and must
    // yield no aliases.
    const src = `workspace { model { archetypes foo bar`;
    const result = parse(src);
    expect(result.archetypeAliases.size).toBe(0);
    // Parser still surfaces grammar errors for the malformed tail.
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  it("ignores an archetypes block whose closing brace never arrives", () => {
    // Unbalanced `archetypes {` — the block-end scan exhausts the
    // stream with depth still open, so no aliases are registered.
    const src = `workspace {
      model {
        archetypes {
          app = container {
            tag "Application"
    `;
    const result = parse(src);
    expect(result.archetypeAliases.size).toBe(0);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  it("does not substitute an alias used outside element-kind position", () => {
    // `app` is declared as an alias but then used as a relationship
    // SOURCE (`app -> db`). The previous emitted token is not `=`, so
    // the alias token is left as a plain identifier reference rather
    // than rewritten to its base keyword.
    const src = `workspace {
      model {
        archetypes {
          app = container {
            tag "Application"
          }
        }
        db = container "DB"
        app -> db "uses"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // `app` was never declared as an element (only as an alias), so the
    // relationship has no resolvable element and is dropped, but the
    // file parses cleanly and `db` survives.
    expect(model.elements["db"]).toBeDefined();
    expect(model.elements["app"]).toBeUndefined();
  });

  it("registers an alias even when its body brace never closes", () => {
    // `app = container {` opens a body that never closes before the
    // archetypes block end — the body merge is skipped (empty body)
    // but the alias itself is still recorded with no extra defaults.
    const src = `workspace {
      model {
        archetypes {
          app = container {
        }
        s = softwareSystem "S"
      }
    }`;
    const result = parse(src);
    // Alias is registered (base keyword resolved) even though the body
    // was unbalanced; it simply carries no body-derived tags.
    expect(result.archetypeAliases.has("app")).toBe(true);
    expect(result.archetypeAliases.get("app")?.defaults.tags).toEqual([]);
  });

  it("skips an unrecognised nested block inside an archetype body", () => {
    // `metadata { ... }` is not a recognised archetype-body statement.
    // The balanced-block skip steps over it; the recognised `tag`
    // around it is still applied.
    const src = `workspace {
      model {
        archetypes {
          app = container {
            metadata {
              owner "platform"
            }
            tag "Application"
          }
        }
        s = softwareSystem "S" {
          api = app "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.tags).toContain("Application");
  });

  it("skips a malformed leading token inside an archetype properties block", () => {
    // A stray `->` before the key/value pair is neither a string nor an
    // identifier, so the properties scanner skips it and then reads the
    // following valid pair intact.
    const src = `workspace {
      model {
        archetypes {
          app = container {
            properties {
              -> "team" "platform"
            }
          }
        }
        s = softwareSystem "S" {
          api = app "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.["team"]).toBe("platform");
  });

  it("skips a perspective whose name slot is not a string or identifier", () => {
    const src = `workspace {
      model {
        archetypes {
          app = container {
            perspectives {
              -> "ignored description"
              Security "encrypted in transit"
            }
          }
        }
        s = softwareSystem "S" {
          api = app "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.["perspective.Security"]).toBe(
      "encrypted in transit",
    );
  });

  it("skips a perspective whose description slot is not a string", () => {
    // `Scalability horizontal` — the description is a bare identifier,
    // not a quoted string, so that perspective is skipped while the
    // well-formed one is kept.
    const src = `workspace {
      model {
        archetypes {
          app = container {
            perspectives {
              Scalability horizontal
              Security "encrypted in transit"
            }
          }
        }
        s = softwareSystem "S" {
          api = app "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const props = model.elements["api"]?.properties ?? {};
    expect(props["perspective.Security"]).toBe("encrypted in transit");
    expect(props["perspective.Scalability"]).toBeUndefined();
  });
});

describe("Structurizr parser — kind-default usage positions", () => {
  it("applies a kind default to an anonymous element after an opening brace", () => {
    // The kind-default `softwareSystem { ... }` declares defaults for
    // every softwareSystem. Here a softwareSystem is declared without an
    // `id =` prefix, so the keyword's previous emitted token is the
    // model body's `{` — the anonymous-usage detection path.
    const src = `workspace {
      model {
        archetypes {
          softwareSystem {
            tag "Default Tag"
          }
        }
        softwareSystem "Anon System"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const sys = Object.values(model.elements).find(
      (e) => e.label === "Anon System",
    );
    expect(sys?.tags).toContain("Default Tag");
  });

  it("applies a kind default after a closing brace of a prior element", () => {
    // The second `softwareSystem` is preceded (in emitted tokens) by the
    // `}` that closes the first element's body — exercising the
    // RBrace-prefix usage position.
    const src = `workspace {
      model {
        archetypes {
          softwareSystem {
            tag "Default Tag"
          }
        }
        first = softwareSystem "First" {
        }
        softwareSystem "Second Anon"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const second = Object.values(model.elements).find(
      (e) => e.label === "Second Anon",
    );
    expect(second?.tags).toContain("Default Tag");
  });

  it("applies a kind default after `=` (assigned element)", () => {
    const src = `workspace {
      model {
        archetypes {
          softwareSystem {
            tag "Default Tag"
          }
        }
        a = softwareSystem "A"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["a"]?.tags).toContain("Default Tag");
  });

  it("does not treat a base keyword in relationship-target position as a kind usage", () => {
    // A kind-default for `container` exists, but here `container` follows
    // a relationship arrow, not `=`/`{`/`}`. It is NOT an element-kind
    // usage, so no kind-default attachment happens — the token stays a
    // plain relationship destination reference.
    const src = `workspace {
      model {
        archetypes {
          container {
            tag "DT"
          }
        }
        a = softwareSystem "A"
        a -> container "anon"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // `a` keeps exactly one relationship whose destination is the literal
    // `container` reference (not promoted into a new element).
    expect(model.elements["a"]?.relations).toEqual([
      expect.objectContaining({ to: "container", description: "anon" }),
    ]);
  });
});

describe("Structurizr parser — deployment block recovery", () => {
  it("leaves an unbalanced deploymentEnvironment block to the parser", () => {
    // The deployment-stripping pass cannot balance the braces, so it
    // emits the keyword token back and lets chevrotain report the
    // missing `}`. No info block is produced for the broken block.
    const src = `workspace {
      model { bank = softwareSystem "Bank" }
      deploymentEnvironment "Production" {
        deploymentNode "AWS" {
    }`;
    const { parseErrors, infoBlocks } = parse(src);
    expect(parseErrors.length).toBeGreaterThan(0);
    // The unbalanced `deploymentEnvironment` keyword is emitted back to
    // the parser rather than recorded as a stripped info block.
    expect(
      infoBlocks.some((b) => b.construct === "deploymentEnvironment"),
    ).toBe(false);
  });
});

describe("Structurizr parser — hard-removed block recovery", () => {
  it("leaves an unbalanced `!ref` block to the parser", () => {
    // `!ref bank {` opens a body that never closes — the hard-removed
    // pass still records the rejection but does not strip the unbalanced
    // body, leaving a normal grammar error for the parser.
    const src = `workspace {
      model {
        bank = softwareSystem "Bank"
        !ref bank {
          web = container "Web"
    `;
    const { parseErrors } = parse(src);
    expect(parseErrors.some((e) => e.message.includes("!ref"))).toBe(true);
    // The unbalanced body also produces at least one ordinary parse
    // error (the missing closing brace was not stripped away).
    expect(parseErrors.length).toBeGreaterThan(1);
  });
});

describe("Structurizr parser — relationship lowering edge cases", () => {
  it("warns when a relationship destination cannot be resolved (hierarchical)", () => {
    // Under hierarchical identifiers an unknown destination does not
    // fall back to its literal name, so the destination is unresolved
    // and the relationship is dropped with a warning.
    const src = `workspace {
      model {
        !identifiers hierarchical
        a = softwareSystem "A"
        a -> ghost "to nowhere"
      }
    }`;
    const { model, parseErrors, issues } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["a"]?.relations).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "loader-warning",
        source: "structurizr",
        code: "relationship-destination-not-resolved",
      }),
    );
  });

  it("emits a recovered relationship when the destination token is missing", () => {
    // `a ->` with no destination (the arrow is the last meaningful token
    // before the closing braces) leaves a partial CST after recovery.
    // The visitor synthesises a `<recovered>` destination; toModel then
    // drops it as unresolved. The point is that the pipeline does not
    // throw and `a` ends up with no relations.
    const src = `workspace {
      model {
        a = softwareSystem "A"
        a ->
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["a"]).toBeDefined();
    expect(model.elements["a"]?.relations ?? []).toEqual([]);
  });
});

describe("Structurizr parser — reopen lowering edge cases", () => {
  it("adds a new child element when reopening a leaf container", () => {
    // `api` starts as a leaf Container. Reopening it with a new element
    // declaration routes the newcomer through the standalone element
    // handler (we land it at model scope rather than promoting `api`).
    const src = `workspace {
      model {
        api = container "API"
        api {
          worker = container "Worker"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
    expect(model.elements["worker"]?.label).toBe("Worker");
  });

  it("merges technology / url / properties / perspectives onto a reopened container", () => {
    const src = `workspace {
      model {
        api = container "API"
        api {
          technology "Spring Boot"
          url "https://example.com/api"
          properties {
            team platform
          }
          perspectives {
            Security "encrypted" "TLS"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    const api = model.elements["api"];
    expect(api?.technology).toBe("Spring Boot");
    expect(api?.link).toBe("https://example.com/api");
    expect(api?.properties?.["team"]).toBe("platform");
    expect(api?.properties?.["perspective.Security"]).toBe("encrypted");
    expect(api?.properties?.["perspective.Security.value"]).toBe("TLS");
  });

  it("appends a relationship inside a Boundary reopen body", () => {
    // `bank` is a Boundary (softwareSystem with a child). Reopening it
    // with a `-> db` line uses the Boundary as the implicit source and
    // exercises the boundary-branch relationship loop.
    const src = `workspace {
      model {
        db = container "DB"
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank {
          -> db "writes"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // The relationship source is the Boundary `bank`, which maps to an
    // unsupported source for an edge, so a warning is raised rather than
    // a Model edge — but the pipeline stays intact and `db` survives.
    expect(model.elements["db"]).toBeDefined();
    expect(model.boundaries["bank"]).toBeDefined();
  });

  it("patches a Boundary's elementNames when a reopen adds nested elements", () => {
    // Reopening the Boundary `bank` with two new nested containers grows
    // the container list, so the Boundary's elementNames are patched to
    // include both newcomers.
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank {
          db = container "Database"
          cache = container "Cache"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.boundaries["bank"]?.elementNames).toEqual(
      expect.arrayContaining(["api", "db", "cache"]),
    );
    expect(model.elements["db"]?.label).toBe("Database");
    expect(model.elements["cache"]?.label).toBe("Cache");
  });

  it("patches a Boundary's boundaryNames when a reopen adds a nested Boundary", () => {
    // The newcomer `payments` has its own child, so it lowers to a
    // Boundary rather than a leaf Container. Reopening `bank` with it
    // must extend the parent Boundary's boundaryNames list.
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API"
        }
        bank {
          payments = container "Payments" {
            gateway = component "Gateway"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    // `payments` became a Boundary (it has a nested component).
    expect(model.boundaries["payments"]).toBeDefined();
    expect(model.elements["gateway"]?.label).toBe("Gateway");
    // The parent Boundary now references the nested Boundary.
    expect(model.boundaries["bank"]?.boundaryNames).toEqual(
      expect.arrayContaining(["payments"]),
    );
  });
});
