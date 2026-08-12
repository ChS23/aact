// In a real consumer project this would be `from "aact"`. We use the local
// monorepo path so the example can be tested in-place without `npm install`.
import type { Model } from "../../../src";
import { defineRule } from "../../../src";

export interface RequireOwnerTagOptions {
  /** Tag prefix that identifies ownership. Default `"owner:"`. */
  readonly prefix?: string;
}

/**
 * `requireOwnerTag` — every operational container must carry an
 * `owner:<team>` tag so on-call ownership is visible from the C4 model
 * alone. Applies to `Container`, `ContainerDb`, and `ContainerQueue`.
 *
 * `Person`, `System`, and `Component` are excluded — they don't carry
 * runtime ownership in the operational sense.
 *
 * No `fix()` here: choosing an owner is a human decision, not something
 * the tool can auto-resolve. For an example of a rule with `fix()`, see
 * the built-in `acl` (`src/rules/acl.ts`).
 */
export const requireOwnerTagRule = defineRule({
  name: "requireOwnerTag",
  description: "Every Container must carry an owner:<team> tag",

  check(model: Model, options?: RequireOwnerTagOptions) {
    const prefix = options?.prefix ?? "owner:";
    const operationalKinds = new Set([
      "Container",
      "ContainerDb",
      "ContainerQueue",
    ]);

    return Object.values(model.elements)
      .filter((c) => operationalKinds.has(c.kind))
      .filter((c) => !c.tags.some((t) => t.startsWith(prefix)))
      .map((c) => ({
        target: c.name,
        targetKind: "element" as const,
        message: `missing ownership tag (expected "${prefix}<team>")`,
      }));
  },
});
