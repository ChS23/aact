import type { ArchitectureModel } from "../model";

export type NamingConvention = "snake" | "camel" | "kebab";

export const detectNamingConvention = (
  model: ArchitectureModel,
): NamingConvention => {
  const names = model.allContainers.map((c) => c.name);
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
