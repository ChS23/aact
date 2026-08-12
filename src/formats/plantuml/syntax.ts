import type { FormatSyntax } from "../types";
import { quotePlantumlText } from "./strings";

export const plantumlSyntax: FormatSyntax = {
  containerDecl: (name, label, tags) => {
    const tagsPart = tags ? `, "", "", $tags=${quotePlantumlText(tags)}` : "";
    return `Container(${name}, ${quotePlantumlText(label)}${tagsPart})`;
  },
  // C4-PUML stdlib Rel signature: Rel(from, to, label, ?techn, ?descr,
  // ?sprite, ?tags, ?link). We emit position 3 (label) from
  // `description` and position 4 (techn) from `technology` — so when
  // a rule rewires `a → b` and preserves both, neither slot gets
  // clobbered. Tags ride on the named `$tags=` argument so positional
  // ordering downstream of position 4 stays flexible.
  relationDecl: (from, to, opts) => {
    const description = opts?.description ?? "";
    const technology = opts?.technology;
    const parts: string[] = [from, to, quotePlantumlText(description)];
    if (technology) parts.push(quotePlantumlText(technology));
    if (opts?.tags) parts.push(`$tags=${quotePlantumlText(opts.tags)}`);
    return `Rel(${parts.join(", ")})`;
  },
};
