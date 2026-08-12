import type { NamingPreset, NamingTransform } from "./types";

/**
 * Naming-convention transforms для compose service-key → Model
 * element-name. Главное для drift detection match-rate когда DSL
 * и compose следуют разным конвенциям (camelCase vs kebab-case).
 *
 * Реализации pure — никакого state, никаких side-effects. Каждый
 * preset идемпотентен на уже-преобразованном input'е.
 */

type WordChar = "lower" | "upper" | "digit";

const classifyWordChar = (char: string): WordChar | undefined => {
  const code = char.codePointAt(0);
  if (code === undefined) return undefined;
  if (code >= 65 && code <= 90) return "upper";
  if (code >= 97 && code <= 122) return "lower";
  if (code >= 48 && code <= 57) return "digit";
  return undefined;
};

const startsNewWord = (
  previous: WordChar,
  current: WordChar,
  next: WordChar | undefined,
): boolean =>
  current === "upper" &&
  (previous === "lower" ||
    previous === "digit" ||
    (previous === "upper" && next === "lower"));

/** Split string на "words" уважая kebab/snake/camel/pascal границы. */
const splitWords = (input: string): readonly string[] => {
  if (input.length === 0) return [];
  const words: string[] = [];
  let current = "";
  let previous: WordChar | undefined;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const charKind = classifyWordChar(char);
    if (charKind === undefined) {
      if (current.length > 0) words.push(current);
      current = "";
      previous = undefined;
      continue;
    }

    const next =
      i + 1 < input.length ? classifyWordChar(input[i + 1]) : undefined;
    if (
      current.length > 0 &&
      previous !== undefined &&
      startsNewWord(previous, charKind, next)
    ) {
      words.push(current);
      current = "";
    }
    current += char;
    previous = charKind;
  }
  if (current.length > 0) words.push(current);
  return words;
};

const toLowerWords = (input: string): readonly string[] =>
  splitWords(input).map((w) => w.toLowerCase());

const capitalize = (word: string): string =>
  word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);

const camelCase = (input: string): string => {
  const words = toLowerWords(input);
  if (words.length === 0) return "";
  return words[0] + words.slice(1).map(capitalize).join("");
};

const pascalCase = (input: string): string =>
  toLowerWords(input).map(capitalize).join("");

const kebabCase = (input: string): string => toLowerWords(input).join("-");

const snakeCase = (input: string): string => toLowerWords(input).join("_");

const PRESETS: Readonly<Record<NamingPreset, NamingTransform>> = Object.freeze({
  "as-is": (raw) => raw,
  "kebab-to-camel": camelCase,
  "kebab-to-pascal": pascalCase,
  "snake-to-camel": camelCase,
  "snake-to-pascal": pascalCase,
  "to-kebab": kebabCase,
  "to-snake": snakeCase,
});

/**
 * Resolve user-facing option to transform function. Принимает string
 * preset, или `{ transform }` объект (runtime escape hatch), или
 * undefined (default = as-is).
 */
export const resolveNamingTransform = (
  raw: ComposeLoadOptionsNamingField,
): NamingTransform => {
  if (raw === undefined) return PRESETS["as-is"];
  if (typeof raw === "string") return PRESETS[raw] ?? PRESETS["as-is"];
  return raw.transform;
};

type ComposeLoadOptionsNamingField =
  | NamingPreset
  | { readonly transform: NamingTransform }
  | undefined;
