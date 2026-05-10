import { readFileSync, writeFileSync } from "node:fs";

import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["src/index", "src/cli/index"],
  declaration: true,
  clean: true,
  externals: ["plantuml-parser", "yaml"],
  failOnWarn: true,
  hooks: {
    "build:done"(ctx) {
      const cli = ctx.options.outDir + "/cli/index.mjs";
      const content = readFileSync(cli, "utf8");
      writeFileSync(cli, "#!/usr/bin/env node\n" + content);
    },
  },
});
