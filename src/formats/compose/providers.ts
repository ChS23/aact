import type { Element } from "../../model";
import type { SourceLocation } from "../../model";
import type { ComposeProvider, ResolvedOptions } from "./types";

/**
 * Provider service → external Element.
 *
 * Compose Spec 2026 ввёл `services.X.provider: { type, options }` —
 * native extension point для external resources (cloud DB, AI runtime,
 * tunnels). Это **не** обычный контейнер; provider service
 * делегирует к platform plugin'у.
 *
 * В C4 это external System: что-то что наша система использует, но
 * не реализует. Архитектурно — четкий signal для "вот наша
 * зависимость от внешнего сервиса".
 *
 * Tags из `options.providers.defaultTags` (по умолчанию `["provider"]`)
 * выставляются дополнительно к любым tags из labels.
 */

export interface ProviderElementInput {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly provider: ComposeProvider;
  readonly extraTags: readonly string[];
  readonly sourceLocation?: SourceLocation;
  readonly link?: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export const buildProviderElement = (
  input: ProviderElementInput,
  options: ResolvedOptions,
): Element => {
  const tags = [
    ...new Set([...options.providers.defaultTags, ...input.extraTags]),
  ];
  return Object.freeze({
    name: input.name,
    label: input.label,
    kind: "System",
    external: true,
    description:
      input.description.length > 0
        ? input.description
        : `via Compose provider (${input.provider.type})`,
    technology: input.provider.type,
    tags: Object.freeze(tags),
    relations: Object.freeze([]),
    ...(input.link === undefined ? {} : { link: input.link }),
    ...(input.properties === undefined ? {} : { properties: input.properties }),
    ...(input.sourceLocation === undefined
      ? {}
      : { sourceLocation: input.sourceLocation }),
  } satisfies Element);
};
