# Проверка соответствия инфраструктуры через Format API

## Status

Proposed. Цель — v3.x после GA. Документ проектируется как
**долгосрочный контракт** с принципом
"минимум необратимых решений в первой итерации".

## Границы (C4 paradigm)

aact строго следует C4 (Container и выше — System Context,
System Landscape, Container, Component). Deployment view —
Deployment Nodes с экземплярами Container'ов, привязанные к
физическим нодам / зонам / регионам — **намеренно вне scope**.
Эта ADR не меняет это.

Что эта ADR добавляет — возможность **парсить IaC-источники
(k8s, Docker Compose, Terraform, Backstage catalog) как
свидетельство существования Container'а**, а не как
deployment-диаграммы.

Loader каждого формата извлекает:

- Identity Container'а (имя ресурса → имя Container'а)
- Override kind'а (через тип ресурса + image-эвристику +
  опциональные аннотации/labels)
- Technology (image / runtime hint)
- Relations (где формат их явно содержит — Compose
  `depends_on`, Terraform refs, Backstage `dependsOn`)
- Description (где формат содержит — Compose labels, Backstage
  `description`, Terraform tags)
- `sourceLocation` для каждого элемента / boundary / relation —
  чтобы IDE-клики из `aact view` и `aact diff` работали

Loader **не извлекает, не моделирует и не показывает**:

- Replica counts, resource limits, image digest pinning — это
  infrastructure compliance, домен kube-score / polaris /
  kyverno.
- Pod-level конфигурацию, taints / tolerations, security
  contexts — deployment-view материал, вне scope.
- Cluster topology, node pools, регионы — deployment-view
  материал, вне scope.

## Контекст

aact позиционируется как инструмент для **Solution
Architect'ов**. Канонический loop сегодня:

```
designer → пишет архитектуру в C4 (PlantUML / Structurizr DSL)
         → aact линтит / анализирует / диффает дизайн
         → aact генерирует Kubernetes манифесты как стартовый артефакт
```

Чего этот loop **не** делает — не отвечает на вопрос который
архитектор поднимает в момент когда система реально работает:

> "Мы спроектировали систему X с контейнерами A, B, C и базой D.
> Что сейчас задеплоено? Совпадает ли это с дизайном?"

Соседние экосистемы покрывают только половину:

- **Моделирующие тулзы** (Structurizr, IcePanel) описывают
  дизайн, но не наблюдают деплой.
- **IaC drift тулзы** (terraform plan, Pulumi preview,
  Spacelift, Firefly) видят инфра-дрифт, но остаются внутри
  своего примитивного словаря — они не понимают C4 элементы /
  boundary'и.
- **AI-based тулзы** (Archyl, IcePanel AI) перекрывают разрыв,
  но недетерминированно и не CI-friendly.

Детерминированный, format-agnostic, linter-shaped слот пуст.

## Решение

**Принцип: минимум необратимых решений в v1.** Любое расширение
поверхности откладывается до момента когда оно реально нужно.

### Единственное изменение публичного API

`Format.load?` и `Format.generate?` принимают опциональный
второй параметр `options?`:

```typescript
interface Format {
  readonly name: string;
  readonly canLoad?: (path: string) => boolean;
  readonly load?: (path: string, options?: unknown) => LoadResult;
  readonly generate?: (model: Model, options?: unknown) => string;
  readonly fix?: (...) => readonly SourceEdit[];
}
```

Существующие Format'ы (structurizr / c4-puml / model-json) не
ломаются — второй параметр опциональный, они его игнорируют.

### Новые first-class Format'ы

Каждый — отдельная папка в `src/formats/<name>/` с собственной
parser-pipeline и тестами:

- `kubernetes` (уже есть с `generate`; добавляется `load`)
- `compose` (новый Format, Docker Compose)
- `backstage` (новый Format, `catalog-info.yaml`)
- `terraform` (новый Format, phase 5)

### Per-Format options — типизированно, defaults в Format'е

Каждый Format **типизирует свои options через TypeScript** и
**декларирует defaults в собственной реализации** (не в
центральном коде):

```typescript
// src/formats/kubernetes/index.ts
interface KubernetesLoadOptions {
  readonly annotations?: {
    readonly prefix?: string; // default: "aact"
    readonly element?: string; // default: "{prefix}/element"
    readonly kind?: string;
    readonly technology?: string;
    readonly description?: string;
    readonly tags?: string;
  };
  readonly helmTemplate?: {
    readonly values?: string; // путь к values.yaml
  };
  readonly namespaces?: readonly string[];
}

export const kubernetesFormat: Format = {
  name: "kubernetes",
  load: (path, options?: KubernetesLoadOptions) => { ... },
  generate: (model, options?) => { ... },
};
```

Аналогично `compose` / `terraform` / `backstage` — каждый
декларирует свой `XxxLoadOptions` интерфейс рядом с
реализацией.

### Defaults annotation prefix — `aact` (без TLD)

`aact` — валидный single-label DNS subdomain (RFC 1123), не
требует владения доменом, короткий, грепабельный.

- k8s: `aact/element`, `aact/kind`, `aact/technology`,
  `aact/description`, `aact/tags`
- compose: labels `aact.element`, `aact.kind`, ...
- backstage: native `metadata.annotations` + поля schema
  (`kind`, `dependsOn`, `description`) уже структурированы

Это значение default'а опции `annotations.prefix` — не hard
contract. Меняется patch-level в Format'е с миграционной
dual-prefix дорожкой.

### Где живут user-overrides

`AactConfig.source` получает опциональное поле `options?` —
**одно опц. поле внутри существующего `source` shape**, не
новое top-level поле в Config:

```typescript
interface AactConfig {
  source: {
    type: SourceFormatName;
    path: string;
    options?: unknown; // ← per-Format типизация через discriminated union
  };
  // ...rules / customRules / generate без изменений
}
```

TypeScript narrowing через discriminated union на `source.type`
даёт user'у автокомплит per-Format options без явного импорта
типов.

```typescript
// aact.config.ts
export default defineConfig({
  source: {
    type: "kubernetes",
    path: "./k8s/",
    options: {
      annotations: { prefix: "mycorp.aact" }, // если есть коллизия
      namespaces: ["production"],
    },
  },
});
```

### Drift = `aact diff` поверх двух Format'ов

```bash
aact diff ./arch.dsl ./k8s/         # архитектурный DSL vs k8s манифесты
aact diff ./arch.dsl ./compose.yml  # архитектурный DSL vs Compose
aact diff ./arch.dsl ./catalog.yaml # архитектурный DSL vs Backstage catalog
aact diff ./k8s-prod/ ./k8s-staging/ # два инфра-снапшота между собой
```

Никакого нового diff engine, никакой отдельной subcommand.
Существующий `aact diff` уже грузит два Format'а через registry
и считает `DiffData`. Все existing capabilities (`--json`,
`--sarif`, exit codes 0/1/2) работают автоматически.

### Что НЕ меняется

- **`Model`** — без новых полей. Все существующие optional
  поля уже подходят: loader просто не выставляет relations /
  descriptions если не извлёк. Diff engine видит `undefined` и
  не флагает.
- **`AactConfig` top-level** — без новых top-level полей.
- **`aact diff` CLI** — без новых флагов, без новых дефолтов.
  Юзеры пишут `aact diff a b` явно.
- **`schemaVersion`** — остаётся `1`. Нет breaking changes.

### Всё остальное работает бесплатно

После того как Format `kubernetes` (и friends) получат `load`
capability, **весь существующий aact работает на инфра-источниках
без изменений**:

- `aact view ./k8s/` — визуализирует deployed как C4 с
  live-reload при изменении манифестов
- `aact check ./k8s/` — прогоняет архитектурные правила (acl /
  crud / acyclic) поверх реальной инфры
- `aact analyze ./k8s/` — coupling/cohesion развёрнутой системы
- `aact diff arch.dsl k8s/` — drift detection
- `aact generate kubernetes ./k8s/` — round-trip (если попросит
  юзер)
- `aact model ./k8s/ --json` — envelope для агентов

core не знает что такое k8s, compose, terraform — просто
диспетчит по `source.type` через Format registry.

## Survey форматов

Что **реально** loadable из каждого источника:

| Источник                   | Identity                           | Kind                        | Relations                                    | Description            | Phase     |
| -------------------------- | ---------------------------------- | --------------------------- | -------------------------------------------- | ---------------------- | --------- |
| **k8s manifests**          | Deployment/StatefulSet name        | image-эвристика + аннотация | ❌ (phase 2: NetworkPolicy)                  | annotation only        | 1         |
| **Docker Compose**         | service name                       | image-эвристика             | ✅ `depends_on` явно                         | label `description`    | 1         |
| **Backstage catalog**      | entity name                        | `kind` поле напрямую        | ✅ `dependsOn`/`providesApis`/`consumesApis` | `description` поле     | 2         |
| **Helm chart**             | (рендерится через `helm template`) | как k8s                     | как k8s                                      | как k8s + chart values | 3         |
| **Terraform (HCL)**        | resource name                      | resource_type mapping       | ✅ `depends_on` + refs                       | tag `description`      | 5         |
| **AWS CDK** (CFN output)   | logical ID                         | type                        | ✅ `DependsOn`/refs                          | metadata               | 5         |
| **Pulumi preview JSON**    | output stack name                  | resource_type               | ✅ deps                                      | tags                   | 5+        |
| **ArgoCD Application**     | app name + chased manifests        | (varies)                    | (chase)                                      | annotation             | 4         |
| **Crossplane Composition** | composite + composed               | varies                      | composition logic                            | annotations            | 4+        |
| **OpenAPI / gRPC**         | API title                          | (другой kind — "interface") | endpoints                                    | description            | вне scope |
| **OTel traces / runtime**  | service name                       | runtime hint                | observed calls                               | —                      | вне scope |

**Ключевые наблюдения:**

1. **Docker Compose даёт богаче relations чем k8s** —
   `depends_on` явный. Phase 1 имеет смысл включать обе фичи
   одновременно.
2. **Backstage `catalog-info.yaml`** — наиболее богатый
   источник: kind / dependsOn / description явные. Если у
   команды уже есть Backstage каталог — aact-конформность
   почти бесплатно.
3. **Helm = preprocessor над k8s.** Реализуется внутри k8s
   Format'а через option `options.helmTemplate: { values }`.
4. **OpenAPI / gRPC** — другой kind контракта ("interface
   surface", не "Container existence"). Отложено за пределы
   ADR.
5. **Pulumi/CDK/Argo/Crossplane** — нужен runtime запуск (не
   pure static parse). Phase 4+.
6. **OTel/runtime** — другой paradigm (continuous, not
   snapshot). Не file-based load. Вне scope ADR.

## Phasing

| Phase | Содержание                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | k8s Format `load` для Deployments / StatefulSets / DaemonSets / Jobs / CronJobs + Docker Compose Format `load`. `aact diff` работает |
| 2     | k8s Services / Ingresses → external relation hints. NetworkPolicy → internal hints. Backstage `catalog-info.yaml` Format `load`      |
| 3     | Helm template resolver внутри k8s Format'а через `options.helmTemplate`                                                              |
| 4     | Crossplane / ArgoCD composite chasing                                                                                                |
| 5     | Terraform / Pulumi / CDK Format'ы — плагуются через тот же Format API                                                                |

## Анализ реверсируемости

Дизайн намеренно минимизирует необратимые решения. Сводка:

| #   | Изменение                                                       | Реверсируемость | Recovery story                                                              |
| --- | --------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| 1   | `Format.load` / `Format.generate` принимают `options?: unknown` | **Высокая**     | Параметр опциональный — drop без breaking changes                           |
| 2   | k8s Format получает `load`                                      | **Высокая**     | Capability set расширен аддитивно; remove `load` = breaking, но в beta free |
| 3   | Новые Format'ы (compose, backstage, terraform)                  | **Высокая**     | Каждый отдельная папка; drop = удаление файлов                              |
| 4   | `AactConfig.source.options?` — одно опц. поле                   | **Высокая**     | Optional поле, drop = users просто не используют                            |
| 5   | Annotation prefix default (`aact`)                              | **Средняя**     | Loader поддерживает оба префикса с warning; CHANGELOG-driven миграция       |
| 6   | k8s → C4 mapping table (heuristics)                             | **Высокая**     | Эвристика, не контракт; пользователи всегда могут override через аннотацию  |

**Что не делается в v1 (= нулевой риск необратимости):**

- ❌ Новые поля в `Model`
- ❌ Новые top-level поля в `AactConfig`
- ❌ Новые `aact diff` дефолты / флаги / subcommand
- ❌ Новые drift entry kinds в `DiffData` (используем existing
  `addedElements` / `removedElements`)
- ❌ Centralised настройка annotation conventions
  (per-Format defaults живут в каждом Format'е)

Любое из перечисленного добавляется аддитивно — без
`schemaVersion` бампа.

## Открытые вопросы дизайна

### Вопрос 1. CRD / Operator-managed ресурсы

Phase 1 skip'ает их с `ModelIssue` info. Долгосрочно:

- Hook-механизм: пользователь регистрирует custom CRD reader
  через свой Format
- Pre-built readers для популярных CRD (Crossplane, ArgoCD,
  Knative)

Какой бы вариант ни выбрали в Phase 4 — все аддитивны через
тот же Format API.

## Как покрыть тестами

### Loader (per-Format)

- Unit: `src/formats/<name>/load.test.ts` — для каждого
  поддерживаемого ресурса фикстура + ожидаемый `Model`.
  Включает override-аннотации, missing-annotation эвристики,
  malformed-input error кейсы, `sourceLocation` точность.
- Snapshot: `examples/<format>/` становится integration-фикстура
  для `test:integration`. Snapshot загруженной `Model` так
  чтобы случайные изменения mapping'а краснели.

### Diff

- Property-based: `@fast-check/vitest` генераторы для двух
  Model'ей отличающихся по конкретным осям; assert что
  `aact diff` находит ожидаемые entries.
- Cross-format: загрузить design.dsl + compose.yml в diff,
  убедиться что одинаковые элементы (по имени) matched и
  отсутствующие — flagged.

### CLI integration

- `test:e2e`: fixture pair (`fixtures/conformance/design.dsl` +
  `fixtures/conformance/k8s/*.yaml`), assert envelope JSON
  shape + SARIF v2.1.0 + exit codes (0 нет drift, 1 drift,
  2 tool error).

### Примеры тестов

References:

- `test/formats/structurizr/parser/pipeline.smoke.test.ts` —
  паттерн loader-теста.
- `test/diff/computeDiff.test.ts` — существующая diff test
  поверхность для расширения.
