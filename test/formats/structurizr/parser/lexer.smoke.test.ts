import {
  Container,
  Identifier,
  LBrace,
  Model,
  Person,
  RBrace,
  Relationship,
  SoftwareSystem,
  StringLiteral,
  StructurizrLexer,
  Views,
  Workspace,
} from "../../../../src/formats/structurizr/parser/tokens";

const tokenize = (src: string) => {
  const result = StructurizrLexer.tokenize(src);
  return {
    errors: result.errors,
    tokens: result.tokens.map((t) => ({
      type: t.tokenType.name,
      image: t.image,
      line: t.startLine,
      col: t.startColumn,
    })),
  };
};

describe("Structurizr lexer — smoke", () => {
  it("tokenises a minimal workspace + model + element + relationship", () => {
    const src = `workspace "Bank" "Internet Banking" {
  model {
    customer = person "Customer"
    bank = softwareSystem "Internet Banking" {
      web = container "Web App" "Java"
    }
    customer -> bank "uses"
  }
}`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    const types = tokens.map((t) => t.type);
    expect(types).toContain("Workspace");
    expect(types).toContain("Model");
    expect(types).toContain("Person");
    expect(types).toContain("SoftwareSystem");
    expect(types).toContain("Container");
    expect(types).toContain("Relationship");
  });

  it("treats identifiers that share a keyword prefix as Identifier", () => {
    const src = `personnel = person "Bob"`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    expect(tokens[0]).toEqual({
      type: "Identifier",
      image: "personnel",
      line: 1,
      col: 1,
    });
    expect(tokens.find((t) => t.image === "person")?.type).toBe("Person");
  });

  it("skips line comments (// and #) and preserves following tokens", () => {
    const src = `// header comment
# hash comment
workspace {
}`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.type)).toEqual([
      "Workspace",
      "LBrace",
      "RBrace",
    ]);
  });

  it("skips block comments", () => {
    const src = `/* multi
line comment */ workspace { }`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.type)).toEqual([
      "Workspace",
      "LBrace",
      "RBrace",
    ]);
  });

  it("recognises both `->` and `-/>` operators", () => {
    const src = `a -> b\nc -/> d`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.type)).toEqual([
      "Identifier",
      "Relationship",
      "Identifier",
      "Identifier",
      "NoRelationship",
      "Identifier",
    ]);
  });

  it("tokenises text blocks (triple-quoted)", () => {
    const src = `description """multi
line
description"""`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.type)).toEqual(["Description", "TextBlock"]);
  });

  it("recognises !directive tokens distinctly from a bare bang", () => {
    const src = `!include "model.dsl"
!const NAME "value"
!identifiers hierarchical`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    expect(tokens.map((t) => t.type)).toEqual([
      "BangInclude",
      "StringLiteral",
      "BangConst",
      "Identifier",
      "StringLiteral",
      "BangIdentifiers",
      "Identifier",
    ]);
  });

  it("disambiguates !constant (hard-removed) from !const", () => {
    const src = `!constant FOO "bar"\n!const BAR "baz"`;
    const { errors, tokens } = tokenize(src);
    expect(errors).toEqual([]);
    const directives = tokens.filter((t) => t.type.startsWith("Bang"));
    expect(directives.map((t) => t.type)).toEqual([
      "BangConstantHardError",
      "BangConst",
    ]);
  });

  it("tracks line + column on every token", () => {
    const src = `workspace {\n  model {\n  }\n}`;
    const { tokens } = tokenize(src);
    const workspace = tokens.find((t) => t.type === "Workspace");
    const model = tokens.find((t) => t.type === "Model");
    expect(workspace).toEqual(expect.objectContaining({ line: 1, col: 1 }));
    expect(model).toEqual(expect.objectContaining({ line: 2, col: 3 }));
  });

  it("exports we'll need from parser.ts are present", () => {
    expect(Workspace.name).toBe("Workspace");
    expect(Model.name).toBe("Model");
    expect(Person.name).toBe("Person");
    expect(SoftwareSystem.name).toBe("SoftwareSystem");
    expect(Container.name).toBe("Container");
    expect(Views.name).toBe("Views");
    expect(Identifier.name).toBe("Identifier");
    expect(StringLiteral.name).toBe("StringLiteral");
    expect(Relationship.name).toBe("Relationship");
    expect(LBrace.name).toBe("LBrace");
    expect(RBrace.name).toBe("RBrace");
  });
});
