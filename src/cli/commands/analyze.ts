import { defineCommand } from "citty";
import consola from "consola";

import { analyzeArchitecture } from "../../analyzer";
import { loadAndValidateConfig } from "../loadConfig";
import { loadModel } from "../loadModel";

export const analyze = defineCommand({
  meta: { description: "Analyze architecture metrics" },
  args: {
    config: {
      type: "string",
      description: "Path to aact config file",
    },
    format: {
      type: "string",
      description: "Output format: text, json",
    },
  },
  async run({ args }) {
    const config = await loadAndValidateConfig(args.config);
    const model = await loadModel(config);
    const { report } = analyzeArchitecture(model);

    if (args.format === "json") {
      console.log(JSON.stringify(report, undefined, 2));
      return;
    }

    consola.info(`Elements: ${report.elementsCount}`);
    consola.info(`Sync API calls: ${report.syncApiCalls}`);
    consola.info(`Async API calls: ${report.asyncApiCalls}`);
    consola.info(
      `Databases: ${report.databases.count} (consumed by ${report.databases.consumes} relation(s))`,
    );

    for (const b of report.boundaries) {
      consola.info(
        `Boundary "${b.label}": cohesion=${b.cohesion}, coupling=${b.coupling}`,
      );
      if (b.couplingRelations.length > 0) {
        for (const r of b.couplingRelations) {
          consola.log(`  ${r.from} → ${r.to}`);
        }
      }
    }
  },
});
