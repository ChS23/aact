import type { FormatSyntax } from "../types";
import { quotePlantumlArg, quotePlantumlText } from "./strings";

export const plantumlSyntax: FormatSyntax = {
  containerDecl: (element) => {
    const parts = [element.name, quotePlantumlText(element.label)];
    if (element.technology) parts.push(quotePlantumlText(element.technology));
    else if (element.description) parts.push('""');
    if (element.description) parts.push(quotePlantumlText(element.description));

    if (element.sprite)
      parts.push(`$sprite=${quotePlantumlArg(element.sprite)}`);
    if (element.tags.length > 0)
      parts.push(`$tags=${quotePlantumlText(element.tags.join("+"))}`);
    if (element.link) parts.push(`$link=${quotePlantumlArg(element.link)}`);
    return `Container(${parts.join(", ")})`;
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
