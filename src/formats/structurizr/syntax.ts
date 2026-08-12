import type { Element } from "../../model";
import type { FormatSyntax } from "../types";

const quote = (value: string): string => {
  const escaped = value.replaceAll('"', String.raw`\"`);
  return ['"', escaped, '"'].join("");
};

const bodyLines = (element: Element): readonly string[] => [
  ...(element.description
    ? [`    description ${quote(element.description)}`]
    : []),
  ...(element.technology
    ? [`    technology ${quote(element.technology)}`]
    : []),
  ...(element.tags.length > 0
    ? [`    tags ${quote(element.tags.join(","))}`]
    : []),
  ...(element.link ? [`    url ${quote(element.link)}`] : []),
  ...(element.properties
    ? [
        "    properties {",
        ...Object.entries(element.properties).map(
          ([key, value]) => `        ${quote(key)} ${quote(value)}`,
        ),
        "    }",
      ]
    : []),
];

export const structurizrDslSyntax: FormatSyntax = {
  containerDecl: (element) => {
    const lines = bodyLines(element);
    if (lines.length === 0)
      return `${element.name} = container ${quote(element.label)}`;
    return `${element.name} = container ${quote(element.label)} {\n${lines.join("\n")}\n}`;
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
