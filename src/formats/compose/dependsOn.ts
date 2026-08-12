import type { ComposeDependsOnRaw } from "./types";

/**
 * Compose `depends_on` две формы:
 *   depends_on: [db, cache]                       # short
 *   depends_on:                                    # long
 *     db: { condition: service_healthy }
 *     cache: { condition: service_started }
 *
 * Обе формы нормализуем в массив target-имён. Compose-spec поля
 * `condition` / `restart` / `required` — runtime concerns, не идут
 * в C4 Model (это про startup ordering, не про architectural
 * dependency).
 *
 * Order сохраняем — пригождается для stable diff output.
 */

export const normalizeDependsOn = (
  raw: ComposeDependsOnRaw | undefined,
): readonly string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return Object.freeze(raw.filter((v): v is string => typeof v === "string"));
  }
  return Object.freeze(Object.keys(raw));
};
