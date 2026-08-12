import type { Model } from "../../model";
import { allElements } from "../../model";

export type NamingConvention = "snake" | "camel" | "kebab";

/**
 * Определяет dominant naming convention в model'е (по именам контейнеров).
 * Fix-функции используют для генерации новых имён в том же стиле, что
 * существующие. Empty model → "snake" fallback.
 */
export const detectNamingConvention = (model: Model): NamingConvention => {
  const names = allElements(model).map((c) => c.name);
  // Stryker disable next-line ConditionalExpression
  if (names.length === 0) return "snake";

  const withUnderscore = names.filter((n) => n.includes("_")).length;
  const withHyphen = names.filter((n) => n.includes("-")).length;
  const withCamel = names.filter((n) => /[a-z][A-Z]/.test(n)).length;

  if (withHyphen > withUnderscore && withHyphen > withCamel) return "kebab";
  if (withCamel > withUnderscore) return "camel";
  return "snake";
};

export const joinName = (
  base: string,
  word: string,
  convention: NamingConvention,
): string => {
  switch (convention) {
    case "camel": {
      return base + word.charAt(0).toUpperCase() + word.slice(1);
    }
    case "kebab": {
      return `${base}-${word}`;
    }
    default: {
      return `${base}_${word}`;
    }
  }
};
