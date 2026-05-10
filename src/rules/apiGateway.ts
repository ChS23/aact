import { Container, EXTERNAL_SYSTEM_TYPE } from "../model";
import { Violation } from "./types";

export interface ApiGatewayOptions {
  aclTag?: string;
  externalType?: string;
  gatewayPattern?: RegExp;
}

export const checkApiGateway = (
  containers: Container[],
  options?: ApiGatewayOptions,
): Violation[] => {
  const aclTag = options?.aclTag ?? "acl";
  const externalType = options?.externalType ?? EXTERNAL_SYSTEM_TYPE;
  const gatewayPattern = options?.gatewayPattern ?? /gateway/i;
  const violations: Violation[] = [];

  for (const container of containers) {
    if (!container.tags?.includes(aclTag)) continue;

    for (const rel of container.relations) {
      if (rel.to.type !== externalType) continue;

      const techs = rel.technology?.split(", ") ?? [];
      if (!techs.some((t) => gatewayPattern.test(t))) {
        violations.push({
          container: container.name,
          message: `calls external "${rel.to.name}" without going through an API Gateway`,
        });
      }
    }
  }

  return violations;
};
