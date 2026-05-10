import fs from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { DeployConfig } from "./deployConfig";

const DEFAULT_DEPLOYS_PATH = path.join("resources/kubernetes", "microservices");
const DEFAULT_EXCLUDE = ["migrator", "platform", "citest", "tests"];

export interface LoadDeployConfigsOptions {
  path?: string;
  exclude?: string[];
}

const getMicroserviceFilepaths = async (
  options?: LoadDeployConfigsOptions,
): Promise<string[]> => {
  const exclude = options?.exclude ?? DEFAULT_EXCLUDE;

  const resolvedPath = path.resolve(
    process.cwd(),
    options?.path ?? DEFAULT_DEPLOYS_PATH,
  );

  const filenames = (await fs.readdir(resolvedPath, "utf8"))
    .filter((filename) =>
      new Set([".yml", ".yaml"]).has(path.extname(filename)),
    )
    .filter((filename) =>
      exclude.every((toExclude) => !filename.includes(toExclude)),
    );

  return filenames.map((filename) => path.join(resolvedPath, filename));
};

interface RawDeployYaml {
  microservice?: RawDeployYaml;
  name?: string;
  fileName?: string;
  environment?: { [key: string]: object };
  sections?: { name: string; prod_value: string }[];
}

export const loadMicroserviceDeployConfigs = async (
  options?: LoadDeployConfigsOptions,
): Promise<DeployConfig[]> => {
  const filepaths = await getMicroserviceFilepaths(options);
  return Promise.all(
    filepaths.map(async (filePath): Promise<DeployConfig> => {
      const content = await fs.readFile(filePath, "utf8");
      let parsed = YAML.parse(
        content.replaceAll("env:", "environment:"),
      ) as RawDeployYaml;
      if (parsed.microservice) parsed = parsed.microservice;
      parsed.fileName = path.parse(filePath).name;
      return parsed as DeployConfig;
    }),
  );
};
