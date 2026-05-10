import type { SourceSyntax } from "../../rules/fix";

export const plantumlSyntax: SourceSyntax = {
  containerPattern: (name) => `(${name},`,
  containerDecl: (name, label, tags) => {
    const tagsPart = tags ? `, "", "", $tags="${tags}"` : "";
    return `Container(${name}, "${label}"${tagsPart})`;
  },
  relationPattern: (from, to) => `Rel(${from}, ${to}`,
  relationDecl: (from, to, tech, tags) => {
    const tagsPart = tags ? `, $tags="${tags}"` : "";
    return `Rel(${from}, ${to}, "${tech ?? ""}"${tagsPart})`;
  },
};
