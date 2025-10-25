/* eslint-disable unicorn/prevent-abbreviations */

import fs from "fs/promises";
import path from "path";

import { Stdlib_C4_Dynamic_Rel } from "plantuml-parser";

import { DeployConfig } from "./deployConfigs";

export interface PumlGeneratorOptions {
  title?: string;
  outputPath?: string;
  includeUrl?: string;
}

const DEFAULT_OPTIONS: Required<PumlGeneratorOptions> = {
  title: "Demo Generated",
  outputPath: path.join(
    process.cwd(),
    "resources/architecture",
    "generated.puml",
  ),
  includeUrl:
    "https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
};

const escapePlantUmlUrl = (url: string): string => {
  return url.replace(/:\//g, ':~/');
};

export const generatePuml = async (
  deployConfigs: DeployConfig[],
  options: PumlGeneratorOptions = {},
): Promise<string> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let data = `@startuml "${opts.title}"
!include ${opts.includeUrl}
LAYOUT_WITH_LEGEND()
AddRelTag("async",  $lineStyle = DottedLine())
AddElementTag("acl",  $bgColor = "#6F9355")
Boundary(project, "Our system"){
`;

  const rels: Stdlib_C4_Dynamic_Rel[] = [];
  const extSystems: string[] = [];
  const intContainers: string[] = [];

  const addRel = (
    fromName: string,
    toName: string,
    transport: string,
    async: boolean,
  ): void => {
    if (
      !rels.some(
        (x) =>
          (x.from === fromName && x.to === toName) ||
          (x.to === fromName && x.from === toName),
      )
    ) {
      let transportAttribute = "";
      if (!intContainers.includes(toName) && !extSystems.includes(toName)) {
        data += `System_Ext(${toName}, "${toName}", " ")
`;
        extSystems.push(toName);
        transportAttribute = `, "${escapePlantUmlUrl(transport)}"`;
      }

      data += `Rel(${fromName}, ${toName}, ""${transportAttribute}`;
      if (async) data += `, $tags="async"`;
      data += `)
`;

      rels.push({
        from: fromName,
        to: toName,
      } as Stdlib_C4_Dynamic_Rel);
    }
  };

  for (const config of deployConfigs) {
    data += `Container(${config.name}, "${config.name.replaceAll("_", " ")}"`;
    if (config.name.endsWith("acl")) data += `, "", "", $tags="acl"`;
    data += `)
`;
    intContainers.push(config.name);

    if (config.environment?.PG_CONNECTION_STRING) {
      const dbName = config.name + "_db";
      data += `ContainerDb(${dbName}, "DB")
`;
      intContainers.push(dbName);
      addRel(config.name, dbName, "", false);
    }
  }

  data += `}
`;

  for (const config of deployConfigs) {
    for (const section of config.sections) {
      if (section.name.startsWith("kafka")) {
        const containers = deployConfigs.filter(
          (x) =>
            x.name !== config.name &&
            x.sections.some((s) => s.prod_value === section.prod_value),
        );
        for (const rel of containers) {
          addRel(config.name, rel.name, "", true);
        }
        if (containers.length === 0) {
          addRel(
            config.name,
            section.name.replaceAll("kafka_", "").replaceAll("_topic", ""),
            section.prod_value,
            true,
          );
        }
      } else {
        addRel(config.name, section.name, section.prod_value, false);
      }
    }
  }

  data += "@enduml";

  if (opts.outputPath) {
    await fs.writeFile(opts.outputPath, data);
  }

  return data;
};
