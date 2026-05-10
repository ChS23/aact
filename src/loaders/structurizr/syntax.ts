import type { SourceSyntax } from "../../rules/fix";

export const structurizrDslSyntax: SourceSyntax = {
  containerPattern: (name) => `${name} = container`,
  containerDecl: (name, label, tags) => {
    if (tags) {
      return `${name} = container "${label}" {\n    tags "${tags}"\n}`;
    }
    return `${name} = container "${label}"`;
  },
  relationPattern: (from, to) => `${from} -> ${to}`,
  relationDecl: (from, to, tech, tags) => {
    const techPart = tech ? ` "${tech}"` : "";
    if (tags) {
      return `${from} -> ${to}${techPart} {\n    tags "${tags}"\n}`;
    }
    return `${from} -> ${to}${techPart}`;
  },
};
