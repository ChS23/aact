import consola from "consola";

import type { Element } from "../model";
import { allElements, getElement, targetOf } from "../model";
import {
  DEFAULT_ACL_NAME_PATTERNS,
  matchesAnyName,
} from "./lib/namingPatterns";
import { detectNamingConvention, joinName } from "./lib/namingUtils";
import type {
  FixResult,
  RelatedLocation,
  RuleDefinition,
  SourceEdit,
  Violation,
} from "./types";

export interface AclOptions {
  /** Tag, который маркирует ACL-контейнер. Default "acl". */
  readonly tag?: string;
  /**
   * Picomatch globs (case-insensitive). Container counts as an ACL
   * even without an explicit tag if its name matches any pattern.
   * Default covers common naming conventions: `*_adapter`,
   * `*_wrapper`, `*_client`, `*_connector`, `*_integration` and
   * PascalCase variants. Override in `aact.config.ts` for
   * project-specific conventions.
   */
  readonly namePatterns?: readonly string[];
}

/** Pick up explicit tag OR a name-convention match — covers legacy
 *  archives without explicit `acl` tags, agent-generated diagrams
 *  with naming conventions, and tagged-by-the-book modern projects. */
const isAcl = (element: Element, options: AclOptions | undefined): boolean => {
  const tag = options?.tag ?? "acl";
  if (element.tags.includes(tag)) return true;
  return matchesAnyName(
    element.name,
    options?.namePatterns ?? DEFAULT_ACL_NAME_PATTERNS,
  );
};

/**
 * Anti-corruption Layer: контейнер, который зовёт внешние системы, должен
 * быть тэгирован как ACL.
 *
 * v3: внешние системы определяются через `target.external === true`
 * (orthogonal flag), не через kind == "System_Ext".
 */
export const aclRule: RuleDefinition<AclOptions> = {
  name: "acl",
  description:
    "Containers calling external systems must be tagged as ACL (Anti-corruption Layer)",
  rationale:
    "An external system has its own model — vocabulary, error codes, serialisation, evolution cadence — that you don't control. When a domain service talks to it directly, that external model leaks: a schema change upstream forces ripple edits across every consumer. An Anti-corruption Layer is a translation boundary: one adapter container per external system, owning protocol/parsing concerns, exposing a domain-friendly API inward. The rest of the architecture stays oblivious of the foreign shape.",
  examples: [
    {
      label: "bad",
      source: `Container(orders, "Orders Service")
System_Ext(payment_provider, "External Payment API")
Rel(orders, payment_provider, "POST", "HTTPS")`,
      note: "Domain service `orders` talks directly to an external system — no adapter, schema couples.",
    },
    {
      label: "good",
      source: `Container(orders, "Orders Service")
Container(payment_acl, "Payment ACL", $tags="acl")
System_Ext(payment_provider, "External Payment API")
Rel(orders, payment_acl, "charges customer")
Rel(payment_acl, payment_provider, "POST", "HTTPS")`,
    },
  ],
  adrPath: "ADRs/Anti-corruption Layer.md",

  check(model, options) {
    const violations: Violation[] = [];

    for (const element of allElements(model)) {
      const externalRelations = element.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );

      if (!isAcl(element, options) && externalRelations.length > 0) {
        const names = externalRelations.map((r) => r.to).join(", ");
        const label = externalRelations.length === 1 ? "system" : "systems";
        // Anchor on the first offending edge — lint-style "click on
        // violation, jump to the Rel line that broke the rule".
        const firstEdge = externalRelations[0];
        const related: RelatedLocation[] = [];
        for (const r of externalRelations) {
          const target = getElement(model, r.to);
          if (target?.sourceLocation) {
            related.push({
              sourceLocation: target.sourceLocation,
              message: `external system: ${r.to}`,
            });
          }
        }
        violations.push({
          target: element.name,
          targetKind: "element" as const,
          message: `calls external ${label} ${names} without an ACL layer`,
          ...(firstEdge.sourceLocation
            ? { sourceLocation: firstEdge.sourceLocation }
            : {}),
          ...(related.length > 0 ? { relatedLocations: related } : {}),
        });
      }
    }

    return violations;
  },

  fix(ctx) {
    const { model, violations, syntax, options } = ctx;
    const tag = options?.tag ?? "acl";
    const convention = detectNamingConvention(model);
    const results: FixResult[] = [];

    for (const violation of violations) {
      const element = model.elements[violation.target];
      if (!element || !element.sourceLocation) continue;

      const externalRels = element.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );
      if (externalRels.length === 0) continue;

      const aclName = joinName(element.name, "acl", convention);
      if (aclName in model.elements) {
        consola.warn(
          `fix acl: skipping ${element.name} — ${aclName} already exists`,
        );
        continue;
      }

      // Insert the new ACL container + its hop edge right after the
      // offending element. Both new lines ship in one atomic block so
      // we don't manufacture a second anchor for "after the new
      // container" — that one wouldn't exist in the source yet.
      const newDecls = [
        syntax.containerDecl({
          name: aclName,
          label: `${element.label} ACL`,
          kind: "Container",
          external: false,
          description: "",
          tags: [tag],
          relations: [],
        }),
        syntax.relationDecl(element.name, aclName),
      ].join("\n");

      const edits: SourceEdit[] = [
        {
          kind: "insert-after",
          anchor: element.sourceLocation,
          content: `\n${newDecls}`,
        },
        ...externalRels.flatMap((rel): SourceEdit[] =>
          rel.sourceLocation
            ? [
                {
                  kind: "replace",
                  range: rel.sourceLocation,
                  content: syntax.relationDecl(aclName, rel.to, {
                    description: rel.description,
                    technology: rel.technology,
                    tags: rel.tags.length > 0 ? rel.tags.join("+") : undefined,
                  }),
                },
              ]
            : [],
        ),
      ];

      if (edits.length === 0) continue;

      results.push({
        ruleId: "acl",
        description: `Add ACL layer for ${element.name}`,
        edits,
      });
    }

    return results;
  },
};
