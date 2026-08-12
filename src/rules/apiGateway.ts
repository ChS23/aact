import type { Element } from "../model";
import { allElements, getElement, targetOf } from "../model";
import {
  DEFAULT_ACL_NAME_PATTERNS,
  matchesAnyName,
} from "./lib/namingPatterns";
import type { RuleDefinition, Violation } from "./types";

export interface ApiGatewayOptions {
  /** Tag, который маркирует ACL-контейнер. Default "acl". */
  readonly aclTag?: string;
  /** Regex для определения "это gateway technology". Default /gateway/i. */
  readonly gatewayPattern?: RegExp;
  /**
   * Picomatch globs (case-insensitive). Container counts as an ACL
   * even without an explicit tag if its name matches any pattern.
   * Shared semantics with `acl.namePatterns` — see that option for
   * default list and rationale.
   */
  readonly aclNamePatterns?: readonly string[];
}

/** ACL identity = explicit tag OR name-convention match. Mirrors the
 *  `isAcl` helper in `acl.ts` (kept inline to avoid coupling rules
 *  through helper imports). */
const isAcl = (
  element: Element,
  options: ApiGatewayOptions | undefined,
): boolean => {
  const tag = options?.aclTag ?? "acl";
  if (element.tags.includes(tag)) return true;
  return matchesAnyName(
    element.name,
    options?.aclNamePatterns ?? DEFAULT_ACL_NAME_PATTERNS,
  );
};

/**
 * API Gateway pattern: ACL-контейнеры, зовущие внешние системы, должны
 * проходить через API Gateway (technology содержит "gateway").
 */
export const apiGatewayRule: RuleDefinition<ApiGatewayOptions> = {
  name: "apiGateway",
  description:
    "ACL containers calling external systems must route through an API Gateway",
  rationale:
    "Outbound traffic to external systems crosses a trust + observability boundary every call. Routing it through a dedicated API Gateway centralises retry / circuit-breaker / rate-limit policy, gives one place to instrument latency and error metrics, and reduces the blast radius of credential rotation. Without a gateway, every ACL container reimplements the same retry/auth/timeout logic — drift between containers is inevitable.",
  examples: [
    {
      label: "bad",
      source: `Container(payment_acl, "Payment ACL", $tags="acl")
System_Ext(payment_api, "Payment API")
Rel(payment_acl, payment_api, "POST", "HTTPS")`,
      note: "Direct HTTPS — no gateway, every ACL handles retries / auth itself.",
    },
    {
      label: "good",
      source: `Container(payment_acl, "Payment ACL", $tags="acl")
System_Ext(payment_api, "Payment API")
Rel(payment_acl, payment_api, "POST", "HTTPS via API Gateway")`,
      note: "Technology field mentions `gateway` — rule recognises the routing path.",
    },
  ],

  check(model, options) {
    const gatewayPattern = options?.gatewayPattern ?? /gateway/i;
    const violations: Violation[] = [];

    for (const element of allElements(model)) {
      if (!isAcl(element, options)) continue;

      for (const rel of element.relations) {
        if (targetOf(model, rel)?.external !== true) continue;

        const techs = rel.technology?.split(", ") ?? [];
        if (!techs.some((t) => gatewayPattern.test(t))) {
          const target = getElement(model, rel.to);
          violations.push({
            target: element.name,
            targetKind: "element" as const,
            message: `calls external "${rel.to}" without going through an API Gateway`,
            ...(rel.sourceLocation
              ? { sourceLocation: rel.sourceLocation }
              : {}),
            ...(target?.sourceLocation
              ? {
                  relatedLocations: [
                    {
                      sourceLocation: target.sourceLocation,
                      message: `external system: ${rel.to}`,
                    },
                  ],
                }
              : {}),
          });
        }
      }
    }

    return violations;
  },
};
