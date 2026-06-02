import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — body statements + directives", () => {
  it("body `description` overrides header positional", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" "Header description" {
          description "Body description"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["bank"]?.description).toBe("Body description");
  });

  it("body `technology` lands on Container.technology", () => {
    const src = `workspace {
      model {
        api = container "API" {
          technology "Node.js 22"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.technology).toBe("Node.js 22");
  });

  it("body `tags` appends to header tags (comma-split, de-duped)", () => {
    const src = `workspace {
      model {
        api = container "API" "" "" "external,api" {
          tags "compliance,api"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.tags).toEqual([
      "Element",
      "Container",
      "external",
      "api",
      "compliance",
    ]);
  });

  it("body `tags` accepts multiple whitespace-separated string args", () => {
    const src = `workspace {
      model {
        api = container "API" {
          tags "alpha" "beta" "gamma"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.tags).toEqual([
      "Element",
      "Container",
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("body `tag` is an alias for `tags` — splits CSV", () => {
    // Reference: StructurizrDslParser.java:612 dispatches both `tag`
    // and `tags` to ModelItemParser.parseTags. Each arg is
    // comma-split, multiple args accepted.
    const src = `workspace {
      model {
        api = container "API" {
          tag "alpha,beta"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["api"]?.tags).toEqual([
      "Element",
      "Container",
      "alpha",
      "beta",
    ]);
  });

  it("body `tag` accepts multiple whitespace-separated args (like tags)", () => {
    const src = `workspace {
      model {
        api = container "API" {
          tag "alpha" "beta" "gamma"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["api"]?.tags).toEqual([
      "Element",
      "Container",
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("`!const` inside an element body parses (reference accepts at any scope)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          !const TEAM "Platform"
          api = container "API"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("body `tag` appends a single tag", () => {
    const src = `workspace {
      model {
        api = container "API" {
          tag "compliance"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["api"]?.tags).toEqual([
      "Element",
      "Container",
      "compliance",
    ]);
  });

  it("body `url` lands on Container.link", () => {
    const src = `workspace {
      model {
        api = container "API" {
          url "https://docs.example.com/api"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.link).toBe("https://docs.example.com/api");
  });

  it("body `url` accepts official unquoted URL form", () => {
    const src = `workspace {
      model {
        api = container "API" {
          url https://docs.example.com/api
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.link).toBe("https://docs.example.com/api");
  });

  it("relationship body applies tags/url/properties/perspectives", () => {
    const src = `workspace {
      model {
        user = person "User"
        api = softwareSystem "API"
        user -> api "Uses" {
          tags "Critical"
          url https://example.com/rel
          properties {
            sla "99.9"
          }
          perspectives {
            Security "Threat model reviewed" "high"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["user"]?.relations).toEqual([
      expect.objectContaining({
        to: "api",
        description: "Uses",
        tags: ["Relationship", "Critical"],
        link: "https://example.com/rel",
        properties: {
          sla: "99.9",
          "perspective.Security": "Threat model reviewed",
          "perspective.Security.value": "high",
        },
      }),
    ]);
  });

  it("body `properties` accepts bare `/` as a value (e.g. groupSeparator)", () => {
    const src = `workspace {
      model {
        properties {
          "structurizr.groupSeparator" /
        }
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("body `properties { key value }` lands on Container.properties", () => {
    const src = `workspace {
      model {
        api = container "API" {
          properties {
            owner "platform-team"
            sla "99.99"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties).toEqual({
      owner: "platform-team",
      sla: "99.99",
    });
  });

  it("body `perspectives { name desc value }` populates properties.perspective.<name>", () => {
    const src = `workspace {
      model {
        api = container "API" {
          perspectives {
            Security "OWASP top 10 covered"
            Scalability "Tested to 10k rps" "high"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties).toEqual({
      "perspective.Security": "OWASP top 10 covered",
      "perspective.Security.value": "",
      "perspective.Scalability": "Tested to 10k rps",
      "perspective.Scalability.value": "high",
    });
  });

  it("parses !const and !var BEFORE the workspace block", () => {
    const src = `!const ORG "Acme"
!var VERSION "1.0"
workspace {
  model {
    api = container "API"
  }
}`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("parses workspace-scope !const before model { }", () => {
    const src = `workspace {
      !const ORG_TAG "platform"
      !var ENV "prod"
      model {
        api = container "API"
      }
    }`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("parses workspace-scope properties { } block", () => {
    const src = `workspace {
      properties {
        "structurizr.dsl.source" "false"
      }
      model {
        api = container "API"
      }
    }`;
    const { parseErrors, model } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("supports !const with a triple-quoted text block value", () => {
    const src = `workspace {
      model {
        !const SVG """<svg>
          <path d="M0,0" />
        </svg>"""
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("supports !const at model scope (parsed, currently no toModel effect)", () => {
    const src = `workspace {
      model {
        !const MY_TAG "platform"
        api = container "API"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]).toBeDefined();
  });

  it("supports !include at model scope", () => {
    const src = `workspace {
      model {
        !include "other.dsl"
        api = container "API"
      }
    }`;
    const { parseErrors, issues } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loader-warning",
          code: "include-not-expanded",
        }),
      ]),
    );
  });

  it("supports !include with bare path (unquoted, with slashes)", () => {
    const src = `workspace {
      model {
        !include path/to/other.dsl
        api = container "API"
      }
    }`;
    const { parseErrors, issues } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loader-warning",
          code: "include-not-expanded",
        }),
      ]),
    );
  });

  it("`workspace extends path/to/parent.dsl` parses without errors", () => {
    const src = `workspace extends path/to/parent.dsl {
      model {}
    }`;
    const { parseErrors, issues } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "loader-warning",
          code: "extends-not-expanded",
        }),
      ]),
    );
  });

  it("supports !identifiers hierarchical", () => {
    const src = `workspace {
      model {
        !identifiers hierarchical
        api = container "API"
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("supports !impliedRelationships true", () => {
    const src = `workspace {
      model {
        !impliedRelationships true
        a = person "A"
        b = softwareSystem "B"
        a -> b
      }
    }`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });

  it("body statements on a promoted Boundary aggregate onto the Boundary", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          description "The bank's internal system"
          tag "core"
          api = container "API"
          db = container "DB"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.boundaries["bank"]).toEqual(
      expect.objectContaining({
        description: "The bank's internal system",
        tags: ["Element", "Software System", "core"],
      }),
    );
    expect(model.elements["api"]).toBeDefined();
    expect(model.elements["db"]).toBeDefined();
  });

  it("preserves sourceLocation on body-driven Container fields", () => {
    const src = `workspace {
      model {
        api = container "API" {
          technology "Node.js"
        }
      }
    }`;
    const { model } = parse(src);
    const c = model.elements["api"];
    expect(c?.sourceLocation?.file).toBe("test.dsl");
    expect(c?.technology).toBe("Node.js");
  });
});
