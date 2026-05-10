import { loadConfig } from "c12";
import * as v from "valibot";

import { type AactConfig, AactConfigSchema } from "../config";

export const loadAndValidateConfig = async (
  configPath?: string,
): Promise<AactConfig> => {
  const { config } = await loadConfig({
    name: "aact",
    ...(configPath ? { configFile: configPath } : {}),
  });
  if (!config) {
    throw new Error("No source configured. Create an aact.config.ts file.");
  }
  return v.parse(AactConfigSchema, config);
};
