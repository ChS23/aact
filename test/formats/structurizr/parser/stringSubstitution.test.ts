import { parseSource } from "../../../../src/formats/structurizr/parser";

const parse = (src: string) => parseSource(src, "test.dsl");

describe("Structurizr parser — ${...} string substitution", () => {
  it("expands ${NAME} from !const into string literals", () => {
    const src = `!const TEAM "Platform"
workspace {
  model {
    api = container "API" "Owned by \${TEAM}"
  }
}`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.description).toBe("Owned by Platform");
  });

  it("expands ${NAME} from !var as well", () => {
    const src = `!var ENV "prod"
workspace {
  model {
    api = container "API" "Running in \${ENV}"
  }
}`;
    const { model, parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
    expect(model.elements["api"]?.description).toBe("Running in prod");
  });

  it("resolves chained references via fixed-point iteration", () => {
    const src = `!const A "\${B}"
!const B "ultimate"
workspace {
  model {
    api = container "API" "\${A}"
  }
}`;
    const { model } = parse(src);
    expect(model.elements["api"]?.description).toBe("ultimate");
  });

  it("leaves unknown ${NAME} references in place (lexer treats as text)", () => {
    const src = `workspace {
      model {
        api = container "API" "Hello \${UNKNOWN}"
      }
    }`;
    const { model } = parse(src);
    expect(model.elements["api"]?.description).toBe("Hello ${UNKNOWN}");
  });

  it("substitutes inside triple-quoted text blocks (TextBlock)", () => {
    const src = `!const ICON "java"
workspace {
  model {
    !const SVG """<icon>\${ICON}</icon>"""
    api = container "API"
  }
}`;
    const { parseErrors } = parse(src);
    expect(parseErrors).toEqual([]);
  });
});
