import type { ElementKind } from "../../model";

/**
 * Public + internal types для Compose Format loader.
 *
 * `ComposeLoadOptions` — публичный shape user-override'ов которые
 * пользователь передаёт через `AactConfig.source.options`. Все поля
 * optional + readonly; не выставленные derive'ятся из built-in
 * defaults в реализации loader'а.
 *
 * Internal shapes (`ParsedComposeFile`, `ParsedService`, ...) — то
 * что мы получаем из `yaml` пакета после parse. Деривативные от
 * Compose Spec (2026 edition), достаточные для построения C4 Model.
 * Поля которые нам не нужны (resources / restart / healthcheck /
 * env_file / etc.) намеренно не типизированы — нужно будет — добавим.
 */

/* ------------------------------------------------------------------ */
/*  Public — ComposeLoadOptions                                       */
/* ------------------------------------------------------------------ */

/**
 * Compose Format loader options.
 *
 * Покрывает 99% real-world сценариев декларативно — без обращения к
 * per-service labels на каждом сервисе. Defaults подобраны под
 * ванильный stack (postgres/mysql/redis/kafka/...) — для типового
 * проекта config не нужен вообще.
 */
export interface ComposeLoadOptions {
  /**
   * Преобразование compose service-key → Model element-name.
   *
   * Самое важное для drift detection match rate. DSL архитектора
   * обычно camelCase (`landingApp`), compose — kebab-case
   * (`landing-app`). Без выравнивания naming каждый сервис
   * дрифтует впустую как "missing in DSL".
   *
   * Preset'ы:
   *   "as-is"            (default) — без трансформации
   *   "kebab-to-camel"   landing-app → landingApp
   *   "kebab-to-pascal"  landing-app → LandingApp
   *   "snake-to-camel"   landing_app → landingApp
   *   "snake-to-pascal"  landing_app → LandingApp
   *   "to-kebab"         landingApp / landing_app → landing-app
   *   "to-snake"         landingApp / landing-app → landing_app
   *   { transform }      runtime escape hatch (не сериализуется
   *                       в JSON envelope — агенты не увидят).
   *                       Для машинных consumers используем
   *                       строковые preset'ы.
   */
  readonly naming?: NamingPreset | { readonly transform: NamingTransform };

  /**
   * Aact label conventions для per-service overrides.
   * Defaults используют prefix `aact` + стандартные ключи.
   */
  readonly labels?: ComposeLabelKeys;

  /**
   * Image pattern → ElementKind map. Аддитивно к built-in defaults
   * (postgres → ContainerDb, kafka → ContainerQueue, ...); user
   * entries WIN на коллизии.
   *
   * Pattern syntax:
   *   "postgres"             exact-match (vs lowercased baseName)
   *   "*postgres*"           glob — содержит подстроку
   *   "mycompany/db-*"       glob по полному repo path (с `/`)
   *
   * Iteration order: user-entries FIRST (insertion order, first-match-
   * wins), defaults после. User override всегда побеждает default.
   */
  readonly imageHeuristic?: Readonly<Record<string, ElementKind>>;

  /**
   * Service-name patterns to **exclude** from Model. Exact или glob
   * (с `*`). Применяется ДО любого parsing — skipped сервисы не
   * попадают в Model вообще, не дают drift в `aact diff`.
   *
   *   skip: ["cypress-*", "mock-*", "adminer"]
   *
   * Альтернатива — `aact.skip: "true"` label per service. `skip`
   * config удобен когда таких сервисов 5+ и они следуют паттерну.
   */
  readonly skip?: readonly string[];

  /**
   * Multi-file merge (как `docker compose -f a.yml -f b.yml`).
   * Phase 1.5 — option принимается, но не применяется (info issue).
   */
  readonly overrides?: readonly string[];

  /**
   * Compose profile filter. Без option — все сервисы. С option —
   * только сервисы matching один из profiles ИЛИ без profiles
   * вообще. Phase 1.5 — option принимается, но не применяется.
   */
  readonly profiles?: readonly string[];

  /** Provider service (Compose Spec 2026) customization. */
  readonly providers?: {
    /** Tags на каждый provider-derived Element. Default `["provider"]`. */
    readonly defaultTags?: readonly string[];
  };

  /** AI Model + relation customization (Compose Spec 2026 `models:`). */
  readonly models?: {
    /** Tags для top-level AI model Element. Default `["ai", "model"]`. */
    readonly defaultTags?: readonly string[];
    /** Description для relation service → model. Default `"uses AI model"`. */
    readonly relationDescription?: string;
  };
}

export type NamingPreset =
  | "as-is"
  | "kebab-to-camel"
  | "kebab-to-pascal"
  | "snake-to-camel"
  | "snake-to-pascal"
  | "to-kebab"
  | "to-snake";

export type NamingTransform = (rawServiceKey: string) => string;

/** Aact label keys. Все optional; не выставленные derive'ятся из
 *  `prefix` (default `aact`). */
export interface ComposeLabelKeys {
  readonly prefix?: string;
  readonly element?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly description?: string;
  readonly technology?: string;
  readonly tags?: string;
  readonly external?: string;
  readonly link?: string;
  /** Label который при значении `"true"` / `"1"` исключает сервис
   *  из Model — per-service альтернатива config-level `skip`. */
  readonly skip?: string;
}

/* ------------------------------------------------------------------ */
/*  Resolved-defaults shape (internal) — то с чем работает loader     */
/*  после подмешивания defaults поверх user options.                  */
/* ------------------------------------------------------------------ */

export interface ResolvedLabelKeys {
  readonly element: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly technology: string;
  readonly tags: string;
  readonly external: string;
  readonly link: string;
  readonly skip: string;
}

export interface ResolvedOptions {
  readonly applyNaming: NamingTransform;
  readonly labels: ResolvedLabelKeys;
  /** Объединённый pattern → kind map (user first, defaults after).
   *  Iteration order matters — first-match-wins. */
  readonly imageHeuristic: ReadonlyArray<{
    readonly pattern: string;
    readonly kind: ElementKind;
  }>;
  readonly skip: readonly string[];
  readonly overrides: readonly string[];
  readonly profiles: readonly string[];
  readonly providers: {
    readonly defaultTags: readonly string[];
  };
  readonly models: {
    readonly defaultTags: readonly string[];
    readonly relationDescription: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Internal — то что мы получаем из YAML parser'а (yaml@2.x).        */
/* ------------------------------------------------------------------ */

/** Mapping form `{ KEY: VALUE }` ИЛИ list form `[ "KEY=VALUE", ... ]`. */
export type ComposeLabelsRaw =
  | Readonly<Record<string, string>>
  | readonly string[];

/** Short form `[name]` ИЛИ long form `{ name: { condition, ... } }`. */
export type ComposeDependsOnRaw =
  | readonly string[]
  | Readonly<Record<string, ComposeDependsOnEntry>>;

export interface ComposeDependsOnEntry {
  readonly condition?: string;
  readonly restart?: boolean;
  readonly required?: boolean;
}

/** Provider services (Compose Spec 2026) — native extension point. */
export interface ComposeProvider {
  readonly type: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface ParsedService {
  readonly image?: string;
  readonly build?: string | Readonly<Record<string, unknown>>;
  readonly labels?: ComposeLabelsRaw;
  readonly depends_on?: ComposeDependsOnRaw;
  readonly profiles?: readonly string[];
  readonly provider?: ComposeProvider;
  readonly models?: readonly string[];
  /** `extends:` — Phase 1 emits info-ModelIssue and skips base merge. */
  readonly extends?: Readonly<{ file?: string; service: string }>;
  /** Прочие поля игнорируем; типизируем как unknown для forward-compat. */
  readonly [other: string]: unknown;
}

/** Top-level `models:` — AI models declaration (Compose Spec 2026). */
export interface ParsedAiModel {
  readonly model: string;
  readonly [other: string]: unknown;
}

/** `include:` — short form (string) или long form (object). */
export type ParsedIncludeEntry =
  | string
  | Readonly<{
      path: string | readonly string[];
      project_directory?: string;
      env_file?: string | readonly string[];
    }>;

export interface ParsedComposeFile {
  readonly name?: string;
  readonly version?: string;
  readonly services?: Readonly<Record<string, ParsedService>>;
  readonly models?: Readonly<Record<string, ParsedAiModel>>;
  readonly include?: readonly ParsedIncludeEntry[];
  readonly [other: string]: unknown;
}
