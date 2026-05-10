import { Container, EXTERNAL_SYSTEM_TYPE } from "../model";
import { Violation } from "./types";

export type { Violation } from "./types";

export interface AclOptions {
  tag?: string;
  externalType?: string;
}

export const checkAcl = (
  containers: Container[],
  options?: AclOptions,
): Violation[] => {
  const tag = options?.tag ?? "acl";
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const violations: Violation[] = [];

  for (const container of containers) {
    const externalRelations = container.relations.filter(
      (r) => r.to.type === externalType,
    );

    if (!container.tags?.includes(tag) && externalRelations.length > 0) {
      const names = externalRelations.map((r) => r.to.name).join(", ");
      const label = externalRelations.length === 1 ? "system" : "systems";
      violations.push({
        container: container.name,
        message: `calls external ${label} ${names} without an ACL layer`,
      });
    }
  }

  return violations;
};
