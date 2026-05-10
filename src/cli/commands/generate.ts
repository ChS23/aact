import fs from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";
import consola from "consola";

import type { AactConfig } from "../../config";
import { generateKubernetes } from "../../generators/kubernetes";
import { generatePlantumlFromModel } from "../../generators/plantumlFromModel";
import type { ArchitectureModel } from "../../model";
import { loadAndValidateConfig } from "../loadConfig";
import { loadModel } from "../loadModel";

const runPlantuml = async (
  model: ArchitectureModel,
  config: AactConfig,
  outputPath?: string,
): Promise<void> => {
  const puml = generatePlantumlFromModel(model, {
    boundaryLabel: config.generate?.boundaryLabel,
  });

  if (outputPath) {
    await fs.writeFile(outputPath, puml);
    consola.success(`Written to ${outputPath}`);
  } else {
    console.log(puml);
  }
};

const runKubernetes = async (
  model: ArchitectureModel,
  config: AactConfig,
  outputDir?: string,
): Promise<void> => {
  const outputs = generateKubernetes(model);

  const targetDir =
    outputDir ??
    config.generate?.kubernetes?.path ??
    "resources/kubernetes/microservices";

  await fs.mkdir(targetDir, { recursive: true });

  await Promise.all(
    outputs.map((output) =>
      fs.writeFile(path.join(targetDir, output.fileName), output.content),
    ),
  );

  consola.success(`Generated ${outputs.length} file(s) in ${targetDir}`);
};

export const generate = defineCommand({
  meta: { description: "Generate architecture artifacts" },
  args: {
    config: {
      type: "string",
      description: "Path to aact config file",
    },
    output: {
      type: "string",
      description: "Output path (file for plantuml, directory for kubernetes)",
    },
    format: {
      type: "string",
      description: "Output format: plantuml, kubernetes",
    },
  },
  async run({ args }) {
    const config = await loadAndValidateConfig(args.config);
    const model = await loadModel(config);
    const format = args.format ?? "plantuml";

    switch (format) {
      case "plantuml": {
        await runPlantuml(model, config, args.output);
        break;
      }
      case "kubernetes": {
        await runKubernetes(model, config, args.output);
        break;
      }
      default: {
        throw new Error(`Unknown format: ${format}`);
      }
    }
  },
});
