import type { Format } from "../types";
import { generate } from "./generate";
import { load } from "./load";
import { plantumlSyntax } from "./syntax";

export const plantumlFormat: Format = {
  name: "plantuml",
  defaultPattern: "*.puml",
  load,
  generate,
  fix: { syntax: plantumlSyntax },
};
