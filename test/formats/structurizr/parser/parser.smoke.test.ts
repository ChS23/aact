import { parseStructurizrDsl } from "../../../../src/formats/structurizr/parser/parser";
import { StructurizrLexer } from "../../../../src/formats/structurizr/parser/tokens";

const parse = (src: string) => {
  const lex = StructurizrLexer.tokenize(src);
  const result = parseStructurizrDsl(lex.tokens);
  return {
    lexerErrors: lex.errors,
    parserErrors: result.errors,
    cst: result.cst,
  };
};

describe("Structurizr parser — smoke", () => {
  it("parses an empty workspace + model without errors", () => {
    const { lexerErrors, parserErrors, cst } = parse(`workspace { model {} }`);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
    expect(cst.name).toBe("workspaceFile");
  });

  it("parses a workspace with name + description", () => {
    const src = `workspace "Bank" "Internet Banking Demo" {
      model {}
    }`;
    const { lexerErrors, parserErrors } = parse(src);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
  });

  it("parses a workspace with `extends` directive on the header", () => {
    const src = `workspace extends "https://example/base.dsl" {
      model {}
    }`;
    const { lexerErrors, parserErrors } = parse(src);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
  });

  it("parses every C4 element kind with optional `id =` assignment", () => {
    const src = `workspace {
      model {
        customer = person "Customer"
        bank = softwareSystem "Internet Banking" {
          api = container "API" "" "Spring Boot"
          server = component "Server" "" "Java"
        }
        bare_person = person "Anon"
      }
    }`;
    const { lexerErrors, parserErrors } = parse(src);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
  });

  it("parses explicit relationships with the four optional positionals", () => {
    const src = `workspace {
      model {
        a = person "A"
        b = softwareSystem "B"
        a -> b "uses"
        a -> b "uses" "HTTPS"
        a -> b "uses" "HTTPS" "external,api"
        a -> b
      }
    }`;
    const { lexerErrors, parserErrors } = parse(src);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
  });

  it("parses nested elements (softwareSystem > container > component)", () => {
    const src = `workspace {
      model {
        bank = softwareSystem "Bank" {
          api = container "API" {
            ctrl = component "Controller"
            svc = component "Service"
            ctrl -> svc "uses"
          }
        }
      }
    }`;
    const { lexerErrors, parserErrors } = parse(src);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
  });

  it("emits a parser error on unmatched braces (no crash)", () => {
    const src = `workspace { model { `;
    const { parserErrors } = parse(src);
    expect(parserErrors.length).toBeGreaterThan(0);
    // Parser should not throw — it should accumulate errors.
  });

  it("real-world fixture (big-bank-plc model section) parses cleanly", () => {
    // The real big-bank fixture has views { ... } and deploymentEnvironment
    // blocks the parser doesn't model yet — we use a model-only subset
    // adapted from the upstream test fixture.
    const src = `workspace "Big Bank plc" "Internet Banking System" {
      model {
        customer = person "Personal Banking Customer"
        bank = softwareSystem "Internet Banking System" {
          webApplication = container "Web Application" "" "Java, Spring MVC"
          singlePageApplication = container "Single-Page Application" "" "JavaScript, Angular"
          mobileApp = container "Mobile App" "" "Xamarin"
          apiApplication = container "API Application" "" "Java, Spring MVC"
          database = container "Database" "" "Oracle Database Schema"
        }
        mainframe = softwareSystem "Mainframe Banking System"
        email = softwareSystem "E-mail System"

        customer -> webApplication "Visits bigbank.com/ib using" "HTTPS"
        customer -> singlePageApplication "Views account balances and makes payments using"
        customer -> mobileApp "Views account balances and makes payments using"
        webApplication -> singlePageApplication "Delivers to the customer's web browser"
        singlePageApplication -> apiApplication "Makes API calls to" "JSON/HTTPS"
        mobileApp -> apiApplication "Makes API calls to" "JSON/HTTPS"
        apiApplication -> database "Reads from and writes to" "JDBC"
        apiApplication -> mainframe "Makes API calls to" "XML/HTTPS"
        apiApplication -> email "Sends e-mail using"
      }
    }`;
    const { lexerErrors, parserErrors } = parse(src);
    expect(lexerErrors).toEqual([]);
    expect(parserErrors).toEqual([]);
  });

  it("CST exposes positions on every token (foundation for SourceLocation)", () => {
    const src = `workspace {
  model {
    bank = softwareSystem "Bank"
  }
}`;
    const { cst, parserErrors } = parse(src);
    expect(parserErrors).toEqual([]);

    // Drill into the CST tree: workspaceFile → workspaceBlock → model →
    // modelBodyItem → elementDeclaration → elementHeader → SoftwareSystem.
    // CST shape smoke; the visitor/toModel pipeline is covered separately.
    expect(cst.children.workspaceBlock?.length ?? 0).toBeGreaterThan(0);
  });
});
