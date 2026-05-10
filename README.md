<img width="150" height="150" alt="aact logo" src="https://github.com/user-attachments/assets/abbcea49-51c9-4e57-8cbe-a1ed11d1fa48" />

# Architecture As Code Tools (aact)

[![npm version](https://img.shields.io/npm/v/aact)](https://www.npmjs.com/package/aact)
[![test workflow](https://github.com/Byndyusoft/aact/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/Byndyusoft/aact/actions/workflows/test.yaml)

CLI и библиотека для валидации, анализа и генерации архитектуры микросервисных систем, описанной "as Code" (PlantUML C4, Structurizr).

Инструменты для работы с архитектурой в формате "as Code":

1. Код и примеры покрытия тестами микросервисной архитектуры, описанной в plantuml ([#](#покрытие-архитектуры-тестами))
2. Автогенерация архитектуры ([#](#автогенерация-архитектуры-1))
3. Тестирование архитектуры модульного монолита ([#](#тестирование-модульного-монолита))

[Планы развития инструментов и репозитория](roadmap.md). PullRequest'ы и Issues'ы приветствуются.

[Справочник](patterns.md) принципов и паттернов проектирования с примерами покрытия их тестами (пополняется...)

<img src="https://github.com/Byndyusoft/aact/assets/1096954/a3c3b3b0-a09b-4da7-aca4-5538159b371c" width="15"/> Телеграм-канал: [Архитектура распределённых систем](https://t.me/rsa_enc)

aact можно использовать двумя способами: как **CLI** (`npx aact check`, авто-фикс, генерация артефактов) или как **библиотеку** (импортировать `checkAcl`, `analyzeArchitecture` и пр. в свои тесты на vitest/jest). CLI — ниже, library-режим — в [соответствующем разделе](#использование-как-библиотеки).

## Quick Start (CLI)

В пустой папке:

```bash
# Создаёт aact.config.ts и стартовый architecture.puml с одним
# умышленным нарушением, чтобы было что чинить
npx aact init

# Покажет 1 нарушение CRUD-правила (orders → orders_db напрямую)
npx aact check

# Применит auto-fix: добавит orders_repo как посредника к БД
npx aact check --fix

# Снова чисто
npx aact check
```

После этого правь `architecture.puml` под свою систему — синтаксис
[C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML).

### Остальные команды

```bash
npx aact check --dry-run             # preview auto-fix без записи
npx aact analyze                     # coupling/cohesion метрики
npx aact generate --format plantuml  # сгенерировать .puml из источника
npx aact generate --format kubernetes
```

> Для `structurizr` укажите `source.writePath` в `aact.config.ts` —
> путь к `workspace.dsl`, в который пишутся правки от `--fix`.

### Что создаёт `aact init`

Два файла рядом:

- **`aact.config.ts`** — настройки источника и набор включённых правил.
  Использует `import type { AactConfig }` — рантайм-резолва пакета не
  происходит, поэтому `npx aact check` работает без `npm install aact`.
- **`architecture.puml`** — стартовая C4-схема с одним сервисом,
  одной БД и умышленным нарушением CRUD-правила. Замени на свою.

```ts
// aact.config.ts (фрагмент)
import type { AactConfig } from "aact";

const config: AactConfig = {
  source: {
    type: "plantuml", // "plantuml" | "structurizr"
    path: "./architecture.puml",
  },
  rules: {
    acl: true,
    acyclic: true,
    apiGateway: true,
    crud: true,
    dbPerService: true,
    cohesion: true,
    stableDependencies: true,
    commonReuse: true,
  },
};

export default config;
```

## Использование как библиотеки

```ts
import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
  checkAcl,
  checkAcyclic,
  checkCrud,
  analyzeArchitecture,
} from "aact";

const elements = await loadPlantumlElements("architecture.puml");
const model = mapContainersFromPlantumlElements(elements);

// Проверка правил
const aclViolations = checkAcl(model.allContainers);
const cyclicViolations = checkAcyclic(model.allContainers);

// Анализ метрик
const { report } = analyzeArchitecture(model);
console.log(`Elements: ${report.elementsCount}`);
```

## Примеры

Запускаемые из коробки (склонируй репо, `cd examples/<name>`, `npx aact check`):

- [`examples/ecommerce-structurizr/`](examples/ecommerce-structurizr/) — Structurizr-источник с `workspace.json` + `workspace.dsl`, полный цикл правил и auto-fix.
- [`examples/violations-demo/`](examples/violations-demo/) — мини-набор умышленных нарушений по каждому правилу — чтобы посмотреть, как выглядит вывод и какие правки предлагает `--fix`.

Тестовые сценарии (для разработчиков пакета, запускаются через `vitest`):

- [`examples/banking-plantuml/`](examples/banking-plantuml/) и [`examples/microservices-structurizr/`](examples/microservices-structurizr/) — интеграционные тесты архитектуры из `resources/`.

## Документация

- [Справочник паттернов](patterns.md) — принципы и паттерны с примерами тестов
- [ADR](ADRs/) — Architecture Decision Records
- [Roadmap](roadmap.md) — планы развития

## Публичные материалы

### Раз архитектура — «as Code», почему бы её не покрыть тестами?!

<a href="https://www.youtube.com/watch?v=POIbWZh68Cg"><img src="https://github.com/Byndyusoft/aact/assets/1096954/e011958e-12c8-4fb9-97f4-a61779408e4f" width="400"/></a>
<a href="https://www.youtube.com/watch?v=tZ-FQeObSjY"><img src="https://github.com/Byndyusoft/aact/assets/1096954/daea29de-776b-49a0-b781-ad4eba9a2221" width="400"/></a>
https://www.youtube.com/watch?v=POIbWZh68Cg &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; https://www.youtube.com/watch?v=tZ-FQeObSjY

[Статья на Хабре](https://habr.com/ru/articles/800205/)

### Автогенерация архитектуры

<a href="https://www.youtube.com/watch?v=fb2UjqjHGUE"><img src="https://github.com/Byndyusoft/aact/assets/1096954/ecb54a6f-f6c1-4816-972b-c845069e9f4a" width="400"/></a><br/>
https://www.youtube.com/watch?v=fb2UjqjHGUE

# Покрытие архитектуры тестами

## Что это, какую боль решает, и с чего начать?

Раз архитектура — «as Code», почему бы её не покрыть тестами?!

Тема идеи и данный открытый репозиторий вызвал неожиданную волну позитивных отзывов о попадании в яблочко болей и о применимости и полезности решения :)

Подход помогает решить **проблемы неактуальности, декларативности и отсутствия контроля ИТ-архитектур и инфраструктуры** (ограничение и требование — архитектура и инфраструктура должны быть "as code").

Тесты проверяют 2 больших блока:

- актуальность архитектуры реальному работающему в продакшне решению
- соответствие "нарисованной" архитектуры выбранным принципам и паттернам проектирования

Подробнее о подходе, решаемых проблемах, схеме работы представленного в репозитории примера и проверяемых в тестах репозитория принципах — на [слайдах](https://docs.google.com/presentation/d/16_3h1BTIRyREXO_oSqnjEbRJAnN3Z4aX/edit?usp=sharing&ouid=106100367728328513490&rtpof=true&sd=true).

### Схема работы

<img src="https://github.com/Byndyusoft/aact/assets/1096954/9b0ad909-b789-4395-a580-9fb44397afa0" height="350">

### Визуализация примера автоматически проверяемого принципа (отсутствие бизнес-логики в CRUD-сервисах)

<img src="https://github.com/Byndyusoft/aact/assets/1096954/292b1bbd-0f18-40be-9560-65385a1d4df9" height="300">

## Пример архитектуры, которую покроем тестами

[![C4](resources/architecture/Demo%20Tests.svg)](resources/architecture/Demo%20Tests.svg)

## Пример тестов

1. [find diff in configs and uml containers](examples/banking-plantuml/architecture.test.ts) — проверяет актуальность списка микросервисов на архитектуре и в [конфигурации инфраструктуры](resources/kubernetes/microservices)
2. [find diff in configs and uml dependencies](examples/banking-plantuml/architecture.test.ts) — проверяет актуальность зависимостей (связей) микросервисов на архитектуре и в [конфигурации инфраструктуры](resources/kubernetes/microservices)
3. [check that urls and topics from relations exist in config](examples/banking-plantuml/architecture.test.ts) — проверяет соответствие между параметрами связей микросервисов (REST-урлы, топики kafka) на архитектуре и в [конфигурации инфраструктуры](resources/kubernetes/microservices)
4. [only acl can depend on external systems](test/rules/acl.test.ts) — проверяет, что не нарушен выбранный принцип построения интеграций с внешними системами только через ACL (Anti Corruption Layer). Проверяет, что только acl-микросервисы имеют зависимости от внешних систем.
5. [connect to external systems only by API Gateway or kafka](examples/banking-plantuml/architecture.test.ts) — проверяет, что все внешние интеграции идут через API Gateway или через kafka

# Автогенерация архитектуры

## Генерация архитектуры из описанной «as Code» инфраструктуры

Сравнение ~~белковой~~ составленной вручную архитектуры и сгенерированной.

### Ручная:

[![C4](resources/architecture/Demo%20Tests.svg)](resources/architecture/Demo%20Tests.svg)

### Сгенерированная:

[![C4](resources/architecture/Demo%20Generated.svg)](resources/architecture/Demo%20Generated.svg)

# Тестирование модульного монолита

Тестами можно покрывать не только архитектуру микросервисов, но архитектуру монолитов, особенно, если они модульные.

- [Тест архитектуры модульного монолита на C#](https://github.com/Byndyusoft/aact/tree/main/ModularMonolith)

# Тестирование на основе информации из кода

Информацию об архитектуре реализованной системы можно извлечь и из ее кода, особенно, если он написан качественно;)

- [Извлечение информации об архитектуры системы из ее кода](https://github.com/Byndyusoft/byndyusoft-architecture-testing)
