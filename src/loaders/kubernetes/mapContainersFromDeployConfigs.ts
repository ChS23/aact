import { Section } from "../../model";
import { DeployConfig } from "./index";

export interface KubernetesMapOptions {
  envWhitelist?: (string | RegExp)[];
  envNamePartsToCleanup?: (string | RegExp)[];
}

const DEFAULT_ENV_WHITELIST: (string | RegExp)[] = [
  "BASE_URL",
  "PROTOCOL",
  "_TOPIC",
  "__BaseAddress",
  "__Endpoint",
  "__SmtpServer",
  "QueueName",
];

const DEFAULT_ENV_CLEANUP: (string | RegExp)[] = [
  "_BASE_URL",
  "_API",
  "_CLIENT",
  "_PROTOCOL",
  /_KAFKA_(?:[A-Z]+_)+TOPIC/,
];

const mapFromConfig = (
  deployConfig: DeployConfig,
  options?: KubernetesMapOptions,
): DeployConfig => {
  const envWhitelist = options?.envWhitelist ?? DEFAULT_ENV_WHITELIST;
  const envNamePartsToCleanup =
    options?.envNamePartsToCleanup ?? DEFAULT_ENV_CLEANUP;

  const synonymes = new Map<string, string[]>([]);

  const environment = deployConfig?.environment ?? {};
  const envKeys = Object.keys(environment);
  const filteredEnvKeys = envKeys.filter((envName) =>
    envWhitelist.some((white) =>
      typeof white === "string"
        ? envName.includes(white)
        : white.exec(envName) !== null,
    ),
  );

  const sections: Section[] = filteredEnvKeys
    .map((envName) => {
      const value = environment[envName];
      return {
        prod_value: value?.prod ?? value?.default ?? "",
        name: envNamePartsToCleanup.reduce<string>(
          (acc, partToCleanup) => acc.replace(partToCleanup, ""),
          envName,
        ),
      };
    })
    .map((relation) => {
      relation.name = relation.name.toLowerCase();
      for (const entry of synonymes.entries()) {
        if (entry[1].includes(relation.name)) relation.name = entry[0];
      }
      return relation;
    });
  deployConfig.name = (deployConfig.name ?? deployConfig.fileName).replaceAll(
    /[\s\-()]/g,
    "_",
  );
  deployConfig.sections = sections;

  return deployConfig;
};

export const mapFromConfigs = (
  deployConfigs: DeployConfig[],
  options?: KubernetesMapOptions,
): DeployConfig[] => {
  return deployConfigs
    .map((c) => mapFromConfig(c, options))
    .sort((a, b) => a.name.localeCompare(b.name));
};
