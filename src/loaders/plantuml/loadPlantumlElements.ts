import fs from "node:fs/promises";
import path from "node:path";

import {
  Comment,
  parse as parsePuml,
  Stdlib_C4_Dynamic_Rel,
  UMLElement,
} from "plantuml-parser";

import { filterElements } from "./lib/filterElements";

export const loadPlantumlElements = async (
  filePath: string,
): Promise<UMLElement[]> => {
  const filepath = path.resolve(filePath);

  let data = await fs.readFile(filepath, "utf8");
  data = data.replaceAll(/, \$tags=(".+?")/g, ", $1").replaceAll('""', '" "');
  const [{ elements }] = parsePuml(data);

  for (const element of elements) {
    if (element instanceof Comment) continue;
    const relation = element as Stdlib_C4_Dynamic_Rel;
    if (relation.type_.name.startsWith("Rel_Back")) {
      const from = relation.from;
      relation.from = relation.to;
      relation.to = from;
    }
  }

  return filterElements(elements);
};
