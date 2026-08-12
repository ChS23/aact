// In a real consumer project this would be `from "aact"`. We use the local
// monorepo path so the example can be tested in-place without `npm install`.
import type { Model } from "../../../src";
import { defineRule } from "../../../src";

export interface BcIsolationOptions {
  /** Prefix marking a bounded-context tag. Default `"bc:"` → `bc:orders`. */
  readonly bcTagPrefix?: string;
  /** Suffix that marks the public-API container of a BC. Default `"_api"`. */
  readonly apiSuffix?: string;
  /** Tag that marks a message broker / event bus. Default `"broker"`. */
  readonly brokerTag?: string;
}

/**
 * `bcIsolation` — containers in one bounded context must not call containers
 * in another BC directly. Cross-BC traffic must go through either:
 *
 *   - the destination BC's public-API container (name ends with `apiSuffix`)
 *   - or a container tagged as `brokerTag` (message bus, event broker)
 *
 * This is C4-level enforcement of Bounded Contexts (DDD) — keeps domain
 * boundaries visible in the architecture and prevents accidental coupling
 * between teams.
 *
 * A container with no `bc:*` tag is ignored (shared infrastructure, logging,
 * tracing, etc.). To enforce ownership separately, see `requireOwnerTag`.
 */
export const bcIsolationRule = defineRule({
  name: "bcIsolation",
  description:
    "Cross-bounded-context calls must route through a *_api container or a broker-tagged container",

  check(model: Model, options?: BcIsolationOptions) {
    const bcPrefix = options?.bcTagPrefix ?? "bc:";
    const apiSuffix = options?.apiSuffix ?? "_api";
    const brokerTag = options?.brokerTag ?? "broker";

    const bcOf = (containerName: string): string | undefined => {
      const tag = model.elements[containerName]?.tags.find((t) =>
        t.startsWith(bcPrefix),
      );
      return tag ? tag.slice(bcPrefix.length) : undefined;
    };

    const violations = [];
    for (const container of Object.values(model.elements)) {
      const sourceBc = bcOf(container.name);
      if (!sourceBc) continue;

      for (const rel of container.relations) {
        const target = model.elements[rel.to];
        if (!target) continue;

        const targetBc = bcOf(target.name);
        if (!targetBc || targetBc === sourceBc) continue;

        const targetIsApi = target.name.endsWith(apiSuffix);
        const targetIsBroker = target.tags.includes(brokerTag);
        if (targetIsApi || targetIsBroker) continue;

        violations.push({
          target: container.name,
          targetKind: "element" as const,
          message: `crosses bounded contexts (${sourceBc} → ${targetBc}) via "${rel.to}" — route through *${apiSuffix} or a ${brokerTag}-tagged broker`,
        });
      }
    }
    return violations;
  },
});
