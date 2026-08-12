/**
 * Парсинг тегов из разных источников. Все возвращают `readonly string[]`
 * (пустой массив если нет тегов) — никаких optional'ов в Container.tags.
 */

/**
 * Tags из любого формата:
 *   Structurizr / k8s / Compose: comma-separated (`"tag1, tag2"`).
 *   PlantUML C4-stdlib `$tags=`: plus-separated (`"tag1+tag2"`).
 *
 * Splits on either delimiter, trim'ит whitespace, фильтрует пустые segments.
 * Один parser покрывает все форматы — pragma "один способ парсить tags".
 */
export const parseCsvTags = (raw?: string): readonly string[] =>
  raw
    ?.split(/[,+]/)
    .map((t) => t.trim())
    .filter(Boolean) ?? [];

/**
 * LikeC4 inline `#tag` syntax — извлекает имена тегов из текста, strip'ит `#`.
 * Поддерживает alphanumeric + `-` + `_` в имени тега.
 */
export const parseHashtagTags = (raw: string): readonly string[] =>
  [...raw.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
