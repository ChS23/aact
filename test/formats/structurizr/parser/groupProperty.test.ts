import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — group → properties.group", () => {
  it("tags each container in a group with properties.group = <group name>", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API"
          db = container "DB"
        }
        external = container "External"
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.group).toBe("Payments");
    expect(model.elements["db"]?.properties?.group).toBe("Payments");
    expect(model.elements["external"]?.properties?.group).toBeUndefined();
  });

  it("group does not itself appear in the Model as a Container or Boundary", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["Payments"]).toBeUndefined();
    expect(model.boundaries["Payments"]).toBeUndefined();
  });

  it("softwareSystem boundary lists group members on elementNames, not group names", () => {
    // Earlier code pushed the group's display name onto the enclosing
    // boundary's `elementNames`, leaving a dangling reference that
    // `validateModel` flagged as `elementInBoundaryNotInModel`. The
    // assertion below pins the flatten — the group is a logical
    // wrapper, its members surface directly on the parent boundary.
    const src = `workspace {
      model {
        sys = softwareSystem "S" {
          group "Backend" {
            api = container "API"
            db = container "DB"
          }
          group "Frontend" {
            web = container "Web"
          }
        }
      }
    }`;
    const { model, issues } = parse(src);
    expect(model.boundaries["sys"]?.elementNames).toEqual(["api", "db", "web"]);
    // No dangling references — both groups vanish from the boundary
    // membership entirely.
    expect(model.boundaries["sys"]?.elementNames).not.toContain("Backend");
    expect(model.boundaries["sys"]?.elementNames).not.toContain("Frontend");
    expect(
      issues.filter((i) => i.kind === "element-in-boundary-not-in-model"),
    ).toHaveLength(0);
  });

  it("flattens nested groups into the enclosing boundary's elementNames", () => {
    const src = `workspace {
      model {
        properties { "structurizr.groupSeparator" "/" }
        sys = softwareSystem "S" {
          group "Outer" {
            group "Inner" {
              deep = container "Deep"
            }
            mid = container "Mid"
          }
          flat = container "Flat"
        }
      }
    }`;
    const { model } = parse(src);
    expect(model.boundaries["sys"]?.elementNames).toEqual([
      "deep",
      "mid",
      "flat",
    ]);
    expect(model.elements["deep"]?.properties?.group).toBe("Outer/Inner");
    expect(model.elements["mid"]?.properties?.group).toBe("Outer");
  });

  it("does not register repeated group names as duplicate identifiers", () => {
    const src = `workspace {
      model {
        sys = softwareSystem "S" {
          group "Backend" {
            api = container "API"
          }
          group "Backend" {
            worker = container "Worker"
          }
        }
      }
    }`;
    const { issues, model } = parse(src);
    expect(
      issues.filter((i) => i.kind === "duplicate-identifier"),
    ).toHaveLength(0);
    expect(model.boundaries["sys"]?.elementNames).toEqual(["api", "worker"]);
  });

  it("allows a group display name to collide with a real element identifier", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API"
        }
        Payments = container "Payments Service"
      }
    }`;
    const { issues, model } = parse(src);
    expect(
      issues.filter((i) => i.kind === "duplicate-identifier"),
    ).toHaveLength(0);
    expect(model.elements["Payments"]?.label).toBe("Payments Service");
    expect(model.elements["api"]?.properties?.group).toBe("Payments");
  });

  it("nested groups join names with structurizr.groupSeparator", () => {
    // Reference: `GroupParser` reads `structurizr.groupSeparator` from
    // the model's `properties { }` block and joins nested group
    // names with it (`Outer/Inner` when separator is `/`).
    const src = `workspace {
      model {
        properties {
          "structurizr.groupSeparator" /
        }
        group "Outer" {
          group "Inner" {
            api = container "API"
          }
          db = container "DB"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.group).toBe("Outer/Inner");
    expect(model.elements["db"]?.properties?.group).toBe("Outer");
  });

  it("without separator, nested elements get the innermost group name only", () => {
    const src = `workspace {
      model {
        group "Outer" {
          group "Inner" {
            api = container "API"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.group).toBe("Inner");
  });

  it('`<element> { group "Layer" }` body-form sets properties.group', () => {
    // Reference: StructurizrDslParser.java:690-691 — a `group` token
    // inside a component body (no `{ }` block on the group) is a
    // property statement, not a nested element declaration.
    const src = `workspace {
      model {
        api = container "API" {
          ctrl = component "Controller" {
            group "Web Layer"
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["ctrl"]?.properties?.group).toBe("Web Layer");
  });

  it("body-form group does not promote a leaf container into a boundary", () => {
    const src = `workspace {
      model {
        api = container "API" {
          group "Application Layer"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.group).toBe("Application Layer");
    expect(model.boundaries["api"]).toBeUndefined();
  });

  it("reopen body-form group merges into existing container properties", () => {
    const src = `workspace {
      model {
        api = container "API"
        api {
          group "Application Layer"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties?.group).toBe("Application Layer");
    expect(model.boundaries["api"]).toBeUndefined();
  });

  it("reopen body-form group merges into existing boundary properties", () => {
    const src = `workspace {
      model {
        sys = softwareSystem "S" {
          api = container "API"
        }
        sys {
          group "Platform"
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.boundaries["sys"]?.properties?.group).toBe("Platform");
    expect(model.boundaries["sys"]?.elementNames).toEqual(["api"]);
  });

  it("preserves other properties alongside group", () => {
    const src = `workspace {
      model {
        group "Payments" {
          api = container "API" {
            properties {
              owner "platform-team"
            }
          }
        }
      }
    }`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.properties).toEqual({
      owner: "platform-team",
      group: "Payments",
    });
  });
});
