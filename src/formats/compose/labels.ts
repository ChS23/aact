import type { ComposeLabelsRaw } from "./types";

/**
 * Compose labels поддерживают две формы:
 *   labels:                               # mapping form
 *     aact.kind: ContainerDb
 *     aact.tags: "critical,storage"
 *
 *   labels:                               # list form (KEY=VALUE strings)
 *     - aact.kind=ContainerDb
 *     - "aact.tags=critical,storage"
 *
 * Обе формы нормализуем в `Record<string, string>`.
 *
 * Edge cases:
 *  - list entry без `=` → skip с warn (вернётся через `issues` отдельно;
 *    эта функция чистая, ошибки наружу через возвращаемый result).
 *  - Дубликаты ключей (только в list-form, в mapping YAML парсер уже
 *    отверг бы): last-write-wins.
 *  - Boolean/number values в mapping-form → string (`true`, `42`).
 */

export interface NormalizedLabels {
  readonly map: Readonly<Record<string, string>>;
  /** Indices of list-form entries which were skipped (missing `=`). */
  readonly malformedIndices: readonly number[];
}

export const normalizeLabels = (
  raw: ComposeLabelsRaw | undefined,
): NormalizedLabels => {
  if (!raw) return { map: Object.freeze({}), malformedIndices: [] };

  const out: Record<string, string> = {};
  const malformed: number[] = [];

  if (Array.isArray(raw)) {
    for (const [i, entry] of raw.entries()) {
      if (typeof entry !== "string") {
        malformed.push(i);
        continue;
      }
      const eq = entry.indexOf("=");
      if (eq === -1) {
        // Compose Spec позволяет bare label `KEY` без value — value
        // считается пустой строкой. Это валидно, не malformed.
        out[entry] = "";
        continue;
      }
      const key = entry.slice(0, eq);
      const value = entry.slice(eq + 1);
      out[key] = value;
    }
  } else {
    for (const [k, v] of Object.entries(raw)) {
      if (v == null) {
        out[k] = "";
      } else if (typeof v === "string") {
        out[k] = v;
      } else {
        out[k] = String(v);
      }
    }
  }

  return {
    map: Object.freeze(out),
    malformedIndices: Object.freeze(malformed),
  };
};

/**
 * Разрешает default label-keys из prefix'а.
 *
 *   resolveLabelKeys({ prefix: "aact" }) → { element: "aact.element", ... }
 *   resolveLabelKeys({ element: "custom.id" }) → { element: "custom.id", ... }
 *
 * Гранулярный override (`element: "..."`) бьёт prefix-derived ключ.
 */
export const resolveLabelKeys = (
  user: {
    readonly prefix?: string;
    readonly element?: string;
    readonly kind?: string;
    readonly label?: string;
    readonly description?: string;
    readonly technology?: string;
    readonly tags?: string;
    readonly external?: string;
    readonly link?: string;
    readonly skip?: string;
  } = {},
): {
  readonly element: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly technology: string;
  readonly tags: string;
  readonly external: string;
  readonly link: string;
  readonly skip: string;
} => {
  const prefix = user.prefix ?? "aact";
  return Object.freeze({
    element: user.element ?? `${prefix}.element`,
    kind: user.kind ?? `${prefix}.kind`,
    label: user.label ?? `${prefix}.label`,
    description: user.description ?? `${prefix}.description`,
    technology: user.technology ?? `${prefix}.technology`,
    tags: user.tags ?? `${prefix}.tags`,
    external: user.external ?? `${prefix}.external`,
    link: user.link ?? `${prefix}.link`,
    skip: user.skip ?? `${prefix}.skip`,
  });
};
