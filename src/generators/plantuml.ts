import type { DeployConfig } from "../loaders/kubernetes/deployConfig";

export interface PlantumlGenerateOptions {
  boundaryLabel?: string;
}

interface RelRecord {
  from: string;
  to: string;
}

// Generates PlantUML from Kubernetes `DeployConfig[]` directly. Distinct
// entry point from `generatePlantumlFromModel`, which works over an
// `ArchitectureModel` and is what the `aact generate` CLI uses.
/* eslint-disable sonarjs/cognitive-complexity */
export const generatePlantuml = (
  configs: DeployConfig[],
  options?: PlantumlGenerateOptions,
): string => {
  const boundaryLabel = options?.boundaryLabel ?? "Our system";
  const rels: RelRecord[] = [];
  const extSystems: string[] = [];
  const intContainers: string[] = [];

  let data = `@startuml "Demo Generated"
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
LAYOUT_WITH_LEGEND()
AddRelTag("async",  $lineStyle = DottedLine())
AddElementTag("acl",  $bgColor = "#6F9355")
Boundary(project, "${boundaryLabel}"){
`;

  for (const config of configs) {
    data += `Container(${config.name}, "${config.name.replaceAll("_", " ")}"`;
    if (config.name.endsWith("acl")) data += `, "", "", $tags="acl"`;
    data += `)\n`;
    intContainers.push(config.name);

    if (config.environment?.PG_CONNECTION_STRING) {
      const dbName = config.name + "_db";
      data += `ContainerDb(${dbName}, "DB")\n`;
      intContainers.push(dbName);
      addRel(config.name, dbName, "", false);
    }
  }
  data += `}\n`;

  for (const config of configs) {
    for (const section of config.sections) {
      if (section.name.startsWith("kafka")) {
        const containers = configs.filter(
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
  return data;

  function addRel(
    fromName: string,
    toName: string,
    transport: string,
    async: boolean,
  ): void {
    if (
      rels.some(
        (x) =>
          (x.from === fromName && x.to === toName) ||
          (x.to === fromName && x.from === toName),
      )
    ) {
      return;
    }

    if (!intContainers.includes(toName) && !extSystems.includes(toName)) {
      data += `System_Ext(${toName}, "${toName}", " ")\n`;
      extSystems.push(toName);
    }

    const transportAttribute =
      !intContainers.includes(toName) && transport ? `, "${transport}"` : "";

    data += `Rel(${fromName}, ${toName}, ""${transportAttribute}`;
    if (async) data += `, $tags="async"`;
    data += `)\n`;

    rels.push({ from: fromName, to: toName });
  }
};
/* eslint-enable sonarjs/cognitive-complexity */
