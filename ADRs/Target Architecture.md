# Целевая архитектура aact

## Контекст

aact — OSS CLI-инструмент для автоматической проверки архитектуры по её описанию "as Code".
Используется в реальных проектах. Распространяется как npm-пакет, запускается через `npx aact`.

Сейчас в репозитории смешаны: код фреймворка, примеры использования и юнит-тесты.
Проверки паттернов захардкожены в тестах и не переиспользуемы.
Нет CLI — автогенерация запускается через Jest.

Данный ADR фиксирует целевое состояние, к которому движемся.

## Принципы

1. **Разделение фреймворка и примеров** — код инструмента и примеры использования живут отдельно
2. **Правила настраиваемые** — пользователь конфигурирует теги, именования, соглашения
3. **Форматы равноправны** — PlantUML, Structurizr и будущие форматы маппятся в единую модель
4. **CLI — основной интерфейс** — `npx aact` для генерации, анализа и проверок
5. **Импортируемый API** — можно подключить как библиотеку в свои Vitest/Jest тесты
6. **Современный стек** — ESM-first, актуальные версии инструментов

## Целевая структура репозитория

```
aact/
├── src/
│   ├── model/                          # Единая доменная модель
│   │   ├── container.ts                #   Контейнер (сервис, БД, внешняя система)
│   │   ├── relation.ts                 #   Связь между контейнерами
│   │   ├── boundary.ts                 #   Граница (контекст, подсистема)
│   │   └── index.ts
│   │
│   ├── loaders/                        # Загрузчики форматов → model
│   │   ├── plantuml/                   #   PlantUML C4 (.puml)
│   │   │   ├── loadPlantumlElements.ts
│   │   │   ├── mapContainersFromPlantumlElements.ts
│   │   │   └── index.ts
│   │   ├── structurizr/                #   Structurizr JSON (.json)
│   │   │   ├── types.ts
│   │   │   ├── loadStructurizrElements.ts
│   │   │   └── index.ts
│   │   ├── kubernetes/                 #   K8s YAML → deploy configs
│   │   │   ├── loadMicroserviceDeployConfigs.ts
│   │   │   ├── mapContainersFromDeployConfigs.ts
│   │   │   └── index.ts
│   │   └── index.ts                    #   Реэкспорт всех загрузчиков
│   │
│   ├── rules/                          # Переиспользуемые правила-проверки
│   │   ├── acl.ts                      #   Anti-Corruption Layer
│   │   ├── crud.ts                     #   Пассивные CRUD-сервисы
│   │   ├── acyclic.ts                  #   Ациклические зависимости
│   │   ├── dbPerService.ts             #   Database per Service
│   │   ├── apiGateway.ts               #   API Gateway
│   │   ├── cohesion.ts                 #   Связность > Связанность
│   │   ├── stableDependencies.ts       #   Stable Dependencies Principle
│   │   ├── commonReuse.ts              #   Common Reuse Principle
│   │   └── index.ts                    #   Реэкспорт всех правил
│   │
│   ├── analyzer.ts                     # Метрики: cohesion, coupling, API calls
│   │
│   ├── cli/                            # CLI-интерфейс (npx aact)
│   │   ├── index.ts                    #   Точка входа (citty)
│   │   └── commands/
│   │       ├── generate.ts             #   aact generate — puml из конфигов
│   │       ├── analyze.ts              #   aact analyze — метрики
│   │       └── check.ts               #   aact check — запуск правил
│   │
│   └── index.ts                        # Публичный API пакета
│
├── test/                               # Юнит-тесты ФРЕЙМВОРКА
│   ├── loaders/
│   │   ├── plantuml.test.ts            #   Парсинг puml → model
│   │   ├── structurizr.test.ts         #   Парсинг workspace.json → model
│   │   └── kubernetes.test.ts          #   Парсинг YAML → deploy configs
│   ├── rules/
│   │   ├── acl.test.ts                 #   Правило ACL работает корректно
│   │   ├── acyclic.test.ts             #   Правило ацикличности работает
│   │   └── ...
│   └── analyzer.test.ts
│
├── examples/                           # Примеры для пользователей
│   ├── banking-plantuml/               #   Пример: PlantUML + K8s
│   │   ├── resources/
│   │   │   ├── C4L2.puml
│   │   │   └── kubernetes/
│   │   └── architecture.test.ts
│   ├── microservices-structurizr/      #   Пример: Structurizr JSON
│   │   ├── resources/
│   │   │   └── workspace.json
│   │   └── architecture.test.ts
│   └── microservices-csharp/           #   Пример: C# тесты
│       ├── resources/
│       │   └── workspace.json
│       └── ArchitectureTests/
│
├── ADRs/                               # Архитектурные решения
│   ├── ADR template.md
│   ├── Anti-corruption Layer.md
│   ├── Database per CRUD-service.md
│   ├── Target Architecture.md          #   ← этот документ
│   └── ...                             #   ADR для каждого паттерна
│
├── examples/modular-monolith-csharp/   # Пример: модульный монолит на C#
│
├── patterns.md                         # Каталог: паттерн → ADR → rule → example
├── roadmap.md
├── README.md
└── package.json                        # bin: { "aact": "./src/cli/index.ts" }
```

## Ключевые архитектурные решения

### 1. Единая модель (src/model/)

Все форматы (PlantUML, Structurizr, будущие) маппятся в единую модель:

```
Container  ←→  Relation  ←→  Boundary
```

Правила и анализатор работают только с моделью. Они не знают про формат источника.

### 2. Загрузчики как адаптеры (src/loaders/)

Каждый загрузчик — функция с сигнатурой:

```typescript
(path: string, options?: LoaderOptions) => { containers: Container[], boundaries: Boundary[] }
```

Это позволяет добавлять новые форматы без изменения ядра.

Roadmap форматов:

- ✅ PlantUML (.puml)
- ✅ Structurizr JSON (.json)
- ✅ Kubernetes YAML
- 🟩 Structurizr DSL (.dsl)
- 🟩 Docker Compose
- 🟩 Mermaid C4

### 3. Конфигурация (c12 от UnJS)

Конфиг загружается через [c12](https://github.com/unjs/c12) — поддерживает `.ts`, `.js`, `.json`, `.yaml`, `.toml` из коробки.

Поиск конфига: `aact.config.ts` → `aact.config.js` → `.aactrc` → `.aactrc.json` → `.aactrc.yaml`.

```typescript
// aact.config.ts — основной формат
import { defineConfig } from "aact";

export default defineConfig({
  source: {
    type: "structurizr", // "plantuml" | "structurizr"
    path: "./workspace.json",
  },
  rules: {
    acl: { tag: "adapter" }, // кастомный тег вместо "acl"
    acyclic: true, // true = дефолтный конфиг
    dbPerService: true,
    crud: { repoTag: "repository" },
  },
});
```

```yaml
# .aactrc.yaml — для тех, кому удобнее YAML
source:
  type: structurizr
  path: ./workspace.json
rules:
  acl:
    tag: adapter
  acyclic: true
  dbPerService: true
```

Возможности c12:

- **extends** — наследование конфигов: `extends: "github:Byndyusoft/aact-preset"`
- **environment overrides** — разные правила для dev/prod
- **watch mode** — перезапуск при изменении конфига

### 4. Настраиваемые правила (src/rules/)

Каждое правило — функция, принимающая модель и опциональный конфиг:

```typescript
// Использование в Jest/Vitest (импорт как библиотека)
import { rules, loaders } from "aact";

const model = loaders.structurizr("./workspace.json");
rules.acl(model.containers); // дефолтный конфиг
rules.acl(model.containers, { tag: "adapter" }); // кастомный тег
```

```typescript
// Использование через CLI — конфиг берётся из aact.config.ts
// npx aact check
```

### 5. CLI как обёртка (src/cli/)

CLI построен на [citty](https://github.com/unjs/citty) (UnJS) — минималистичный CLI-builder.

CLI не содержит бизнес-логики. Он:

- Загружает конфиг через c12
- Вызывает загрузчик
- Запускает правила/анализатор
- Форматирует вывод

Три команды:

| Команда                           | Назначение                                   |
| --------------------------------- | -------------------------------------------- |
| `npx aact generate --to plantuml` | Генерация диаграммы из IaC-конфигов          |
| `npx aact analyze`                | Вывод метрик (cohesion, coupling, API calls) |
| `npx aact check`                  | Запуск правил, exit code 1 при нарушении     |

Стек CLI: **citty** (команды) + **c12** (конфиг) — оба из экосистемы UnJS, используются в Nuxt/Nitro.

#### Форматы вывода `aact check`

| Формат | Флаг                                                     | Назначение                             |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| text   | по умолчанию                                             | Читаемый вывод в консоль через consola |
| json   | `--format json`                                          | Машинный парсинг в CI-пайплайнах       |
| github | `--format github` или автодетект по `GITHUB_ACTIONS` env | `::error` аннотации прямо в PR         |

```
$ npx aact check
✓ acl — passed
✓ acyclic — passed
✗ dbPerService — 2 violations
  → "OrderService" accesses database of "UserService"
  → "PaymentService" accesses database of "OrderService"

2 rules passed, 1 failed (2 violations)
```

### 6. Разделение test/ и examples/

| Каталог     | Назначение                                 | Запуск                         |
| ----------- | ------------------------------------------ | ------------------------------ |
| `test/`     | Проверяет корректность кода фреймворка     | `npm test` (CI)                |
| `examples/` | Показывает как использовать aact в проекте | `npm run examples` или вручную |

Пользователь копирует `examples/` к себе как отправную точку.

### 7. Публичный API (src/index.ts)

```typescript
// src/index.ts — что экспортирует пакет
export * from "./model";
export * from "./loaders";
export * from "./rules";
export { analyze } from "./analyzer";
```

## Модернизация тулинга

Текущий стек устарел. Целевое состояние:

### Рантайм и язык

| Было                         | Стало                              | Почему                |
| ---------------------------- | ---------------------------------- | --------------------- |
| `"node": ">=16"`             | `"node": ">=20"`                   | Node 16/18 EOL        |
| `typescript: 5.1`            | `typescript: 5.7+`                 | Актуальный компилятор |
| CJS (без `"type": "module"`) | **ESM-first** (`"type": "module"`) | Стандарт экосистемы   |
| `tsconfig` extends `node16`  | extends `node20`                   | Актуальный таргет     |

### Тестирование

| Было              | Стало                    | Почему                                        |
| ----------------- | ------------------------ | --------------------------------------------- |
| Jest 29 + ts-jest | **Vitest**               | Нативный TS/ESM, быстрее, меньше конфигурации |
| jest-extended     | Vitest built-in matchers | Vitest включает расширенные матчеры           |
| `@types/jest`     | Не нужен                 | Vitest типизирован из коробки                 |

### Линтинг и форматирование

| Было                        | Стало                                            | Почему                              |
| --------------------------- | ------------------------------------------------ | ----------------------------------- |
| ESLint 8 + `.eslintrc.json` | **ESLint 9+** + `eslint.config.ts` (flat config) | ESLint 8 EOL, eslintrc удалён в v10 |
| Prettier 2.7                | **Prettier 3.x**                                 | Актуальная версия                   |
| commitlint 17               | commitlint 19+                                   | Актуальная версия                   |
| husky 8                     | husky 9+                                         | Актуальная версия                   |
| lint-staged 13              | lint-staged 15+                                  | Актуальная версия                   |

### Сборка и публикация

| Было                         | Стало                 | Почему                          |
| ---------------------------- | --------------------- | ------------------------------- |
| Нет сборки                   | **unbuild** (UnJS)    | Сборка ESM + CJS для npm-пакета |
| `name: "ArchAsCode_Tests"`   | `name: "aact"`        | npm-publishable имя             |
| `private: true`              | Убрать                | Для публикации как npm-пакет    |
| `"dependencies": { "yarn" }` | Убрать                | yarn как dep — антипаттерн      |
| Нет `exports`                | `"exports"` + `"bin"` | Точки входа для пакета и CLI    |

### UnJS стек

Консистентный набор инструментов из одной экосистемы:

| Инструмент                                 | Назначение                                  |
| ------------------------------------------ | ------------------------------------------- |
| [c12](https://github.com/unjs/c12)         | Загрузка конфига (TS, JS, JSON, YAML, TOML) |
| [citty](https://github.com/unjs/citty)     | CLI-builder                                 |
| [unbuild](https://github.com/unjs/unbuild) | Сборка пакета (ESM + CJS)                   |
| [jiti](https://github.com/unjs/jiti)       | TS-импорт в рантайме (используется c12)     |
| [consola](https://github.com/unjs/consola) | Красивый вывод в консоль                    |

### Package manager

**pnpm** — для управления зависимостями репозитория. Не влияет на потребителей пакета — они используют любой менеджер (npm, pnpm, yarn, bun).

Corepack для фиксации версии:

```json
{ "packageManager": "pnpm@9.x" }
```

### Целевой package.json (ключевые поля)

```json
{
  "name": "aact",
  "version": "2.0.0",
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "bin": {
    "aact": "./dist/cli.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "unbuild",
    "test": "vitest",
    "lint": "eslint ."
  }
}
```

## Релизы и публикация

- **npm-имя**: `aact` (свободно в registry)
- **Релизы**: [changesets](https://github.com/changesets/changesets) — PR-based, changelog генерируется автоматически
- **Ветка трансформации**: `v2` — отдельная ветка, мержим в main когда всё готово
- **feature/structurizr-support**: входит в v2 (не мержим отдельно в main)

## Документация

- **README.md** — полный рерайт под новый API/CLI
- **patterns.md** — каталог: паттерн → ADR → rule → example
- **ADRs/** — по одному на каждый паттерн
- **CONTRIBUTING.md** — гайд для контрибьюторов

## Связь с issues

| Issue | Что закрывает в этой архитектуре                                         |
| ----- | ------------------------------------------------------------------------ |
| #7    | `src/cli/` — CLI-утилита                                                 |
| #8    | Исправление в `src/loaders/plantuml/`                                    |
| #9    | `examples/microservices-structurizr/` + `examples/microservices-csharp/` |
| #5    | `ADRs/` — по одному на каждый паттерн                                    |
| #6    | `examples/` — тесты-примеры для каждого паттерна                         |
| #10   | `src/rules/` — новые правила resilience, observability                   |

## Порядок реализации

0. Модернизация тулинга (ESM, Vitest, ESLint 9, unbuild, Node >=20)
1. Вынести правила в `src/rules/` с настраиваемым конфигом
2. Исправить баг #8 (puml-ссылки)
3. Создать CLI (`src/cli/`) на citty + c12
4. Разделить `test/` и `examples/`
5. Дописать ADR для паттернов
6. Добавить примеры тестов для паттернов
7. Пример Structurizr + C#
8. Правила для отказоустойчивости и наблюдаемости
