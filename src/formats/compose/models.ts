import type { Element, Relation } from "../../model";
import type { SourceLocation } from "../../model";
import type { ParsedAiModel, ResolvedOptions } from "./types";

/**
 * Compose Spec 2026 ввёл top-level `models:` для AI runtime
 * declaration:
 *
 *   models:
 *     llama-3:
 *       model: ai/llama3.2
 *
 *   services:
 *     api:
 *       models: [llama-3]
 *
 * В C4 модели это:
 *   - каждый top-level `models.X` → external Element (System kind,
 *     external=true, technology="AI model", description=`ai/llama3.2`)
 *   - service `api.models: [llama-3]` → Relation `api → llama-3` с
 *     description "uses AI model"
 *
 * Архитектурно AI зависимости — important first-class concept (legal /
 * compliance / cost / latency budget). Поднимаем сразу в Phase 1.
 */

export interface AiModelElementInput {
  readonly name: string;
  readonly label: string;
  readonly parsed: ParsedAiModel;
  readonly sourceLocation?: SourceLocation;
}

export const buildAiModelElement = (
  input: AiModelElementInput,
  options: ResolvedOptions,
): Element => {
  const tags = Object.freeze([...options.models.defaultTags]);
  return Object.freeze({
    name: input.name,
    label: input.label,
    kind: "System",
    external: true,
    description: input.parsed.model,
    technology: "AI model",
    tags,
    relations: Object.freeze([]),
    ...(input.sourceLocation === undefined
      ? {}
      : { sourceLocation: input.sourceLocation }),
  } satisfies Element);
};

export const buildAiModelRelation = (
  toModelName: string,
  options: ResolvedOptions,
  sourceLocation?: SourceLocation,
): Relation =>
  Object.freeze({
    to: toModelName,
    description: options.models.relationDescription,
    tags: Object.freeze([]),
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
  } satisfies Relation);
