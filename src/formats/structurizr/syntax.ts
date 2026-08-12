import type { FormatSyntax } from "../types";

export const structurizrDslSyntax: FormatSyntax = {
  containerDecl: (name, label, tags) => {
    if (tags) {
      return `${name} = container "${label}" {\n    tags "${tags}"\n}`;
    }
    return `${name} = container "${label}"`;
  },
  // Structurizr DSL relationship: `from -> to "description" "technology"`,
  // with an optional `{ tags "..." }` block for tag overrides. Both
  // slot strings are positional and quote-wrapped; an empty
  // description survives the round-trip as `""`.
  relationDecl: (from, to, opts) => {
    const description = opts?.description;
    const technology = opts?.technology;
    const parts = [`${from} -> ${to}`];
    if (description !== undefined || technology) {
      parts.push(`"${description ?? ""}"`);
    }
    if (technology) parts.push(`"${technology}"`);
    const head = parts.join(" ");
    if (opts?.tags) {
      return `${head} {\n    tags "${opts.tags}"\n}`;
    }
    return head;
  },
};
