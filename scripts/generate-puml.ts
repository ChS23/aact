#!/usr/bin/env ts-node

/* eslint-disable no-console, n/shebang */

import path from "path";

import {
  loadMicroserviceDeployConfigs,
  mapFromConfigs,
} from "../src/deployConfigs";
import { generatePuml, PumlGeneratorOptions } from "../src/pumlGenerator";

interface CliArguments {
  config?: string;
  output?: string;
  title?: string;
  help?: boolean;
}

const parseArgs = (): CliArguments => {
  const args: CliArguments = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const currentArgument = argv[i];
    switch (currentArgument) {
      case "--config":
      case "-c":
        args.config = argv[++i];
        break;
      case "--output":
      case "-o":
        args.output = argv[++i];
        break;
      case "--title":
      case "-t":
        args.title = argv[++i];
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }

  return args;
};

const printHelp = (): void => {
  console.log(`
Usage: yarn generate:puml [options]

Options:
  -c, --config <path>   Path to kubernetes configs directory
                        (default: resources/kubernetes/microservices)
  -o, --output <path>   Output PUML file path
                        (default: resources/architecture/generated.puml)
  -t, --title <title>   Diagram title
                        (default: Demo Generated)
  -h, --help            Show this help message

Examples:
  yarn generate:puml
  yarn generate:puml --title "Production Architecture"
  yarn generate:puml --output custom.puml
  `);
};

const main = async (): Promise<void> => {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    // eslint-disable-next-line n/no-process-exit
    process.exit(0);
  }

  try {
    console.log("Loading deploy configs...");
    const deployConfigs = mapFromConfigs(
      await loadMicroserviceDeployConfigs(),
    );

    console.log(`Found ${deployConfigs.length} microservices`);

    const options: PumlGeneratorOptions = {};
    if (args.title) options.title = args.title;
    if (args.output) options.outputPath = path.resolve(args.output);

    console.log("Generating PlantUML diagram...");
    await generatePuml(deployConfigs, options);

    const outputPath = options.outputPath ?? "resources/architecture/generated.puml";
    console.log(`Successfully generated: ${outputPath}`);
  } catch (error) {
    console.error("Error generating PlantUML:", error);
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  }
};

main().catch((error: Error) => {
  console.error("Fatal error:", error);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});
