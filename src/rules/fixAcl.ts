import consola from "consola";

import type { ArchitectureModel } from "../model";
import { EXTERNAL_SYSTEM_TYPE } from "../model";
import type { AclOptions } from "./acl";
import type { FixResult, SourceSyntax } from "./fix";
import { detectNamingConvention, joinName } from "./namingUtils";
import type { Violation } from "./types";

export const fixAcl = (
  model: ArchitectureModel,
  violations: Violation[],
  syntax: SourceSyntax,
  options?: AclOptions,
): FixResult[] => {
  const tag = options?.tag ?? "acl";
  const convention = detectNamingConvention(model);
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const results: FixResult[] = [];

  for (const violation of violations) {
    const container = model.allContainers.find(
      (c) => c.name === violation.container,
    );
    if (!container) continue;

    const externalRels = container.relations.filter(
      (r) => r.to.type === externalType,
    );
    if (externalRels.length === 0) continue;

    const aclName = joinName(container.name, "acl", convention);
    if (model.allContainers.some((c) => c.name === aclName)) {
      consola.warn(
        `fix acl: skipping ${container.name} — ${aclName} already exists`,
      );
      continue;
    }

    const fix: FixResult = {
      rule: "acl",
      description: `Add ACL layer for ${container.name}`,
      edits: [],
    };

    fix.edits.push(
      // 1. Add ACL container after the violating container
      {
        type: "add",
        search: syntax.containerPattern(container.name),
        content: syntax.containerDecl(aclName, `${container.label} ACL`, tag),
      },
      // 2. Add single Rel(svc, acl) after the ACL container declaration
      {
        type: "add",
        search: syntax.containerPattern(aclName),
        content: syntax.relationDecl(container.name, aclName),
      },
      // 3. Replace each Rel(svc, ext) → Rel(acl, ext) preserving technology
      ...externalRels.map((rel) => ({
        type: "replace" as const,
        search: syntax.relationPattern(container.name, rel.to.name),
        content: syntax.relationDecl(aclName, rel.to.name, rel.technology),
      })),
    );

    results.push(fix);
  }

  return results;
};
