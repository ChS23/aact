import { defineCommand, runMain } from "citty";

import { version } from "../../package.json";
import { analyze } from "./commands/analyze";
import { check } from "./commands/check";
import { diff } from "./commands/diff";
import { generate } from "./commands/generate";
import { init } from "./commands/init";
import { model } from "./commands/model";
import { rule } from "./commands/rule";
import { skill } from "./commands/skill";
import { view } from "./commands/view";

const main = defineCommand({
  meta: {
    name: "aact",
    version,
    description: "Architecture analysis and compliance tool",
  },
  subCommands: {
    init,
    check,
    analyze,
    model,
    diff,
    view,
    generate,
    rule,
    skill,
  },
});

void runMain(main);
