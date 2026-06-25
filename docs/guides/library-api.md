# aact как библиотека

CLI закрывает почти всё, но иногда нужно встроить aact **в свой код**: гейт со
своей логикой, дашборд по модели, генерация из архитектуры, прогон правил внутри
другого инструмента. Всё, что для этого нужно, реэкспортируется из корня пакета
(`src/index.ts`) — формат-объекты, правила, движок диффа, метрики, типы. Остальное
под `src/` внутреннее и может меняться без повышения мажорной версии.

Полный рабочий пример — [`examples/library-api/`](../../examples/library-api).

## Загрузить модель

У каждого формата — объект с опциональными возможностями (`load` / `generate` /
`fix`). `load` возвращает нормализованную `Model` плюс `issues` загрузчика
(висячие ссылки, дубликаты имён):

```ts
import { structurizrFormat, allElements } from "aact";

const { model, issues } = await structurizrFormat.load!("architecture.dsl");
console.log(
  allElements(model)
    .map((e) => `${e.name} (${e.kind})`)
    .join(", "),
);
// → orders (Container), orders-db (ContainerDb)
```

`load` объявлен опционально (формат может его не поддерживать), поэтому в TS — либо
`load!`, либо проверка `canLoad(format)`. Динамический выбор по имени — через
`loadFormat`:

```ts
import { loadFormat, canLoad } from "aact";

const format = await loadFormat("kubernetes"); // "plantuml" | "structurizr" | …
if (canLoad(format)) {
  const { model } = await format.load("./k8s/");
}
```

`Model` — это `elements` / `boundaries` (Record по имени) + `rootBoundaryNames`.
Помощники `allElements(model)` / `allBoundaries(model)` дают плоские массивы.

## Прогнать встроенное правило

Каждое правило экспортируется как объект `xxxRule` с методом
`check(model): Violation[]`:

```ts
import { crudRule } from "aact";

for (const v of crudRule.check(model)) {
  console.log(`${v.target}: ${v.message}`);
}
// → orders: directly accesses database orders-db — add a repo or relay
```

`Violation` — это `{ target, targetKind: "element" | "boundary", message,
sourceLocation? }`. Те же объекты (`aclRule`, `dbPerServiceRule`, …) лежат в
`ruleRegistry`.

## Своё правило

`defineRule` ничего не меняет — он просто возвращает переданный
`RuleDefinition`, но сохраняет литеральные типы (имя, опции) для автодополнения
в `defineConfig`. Минимум — `name` / `description` / `check`:

```ts
import { defineRule, allElements } from "aact";
import type { Violation } from "aact";

export const requireDescription = defineRule({
  name: "requireDescription",
  description: "Every container must carry a description",
  check: (model): readonly Violation[] =>
    allElements(model)
      .filter((e) => e.kind.startsWith("Container") && e.description === "")
      .map((e) => ({
        target: e.name,
        targetKind: "element",
        message: `${e.name} has no description`,
      })),
});
```

Тот же объект кладётся в `defineConfig({ customRules: [...] })` для CLI — встроенные
и кастомные правила используют один контракт. Подробнее про правила с
автофиксом — [Свои правила](./custom-rules.md).

## Метрики

`analyzeArchitecture(model)` возвращает `{ model, report }` — связность,
связанность, sync/async, hotspot'ы:

```ts
import { analyzeArchitecture } from "aact";

const { report } = analyzeArchitecture(model);
console.log(
  report.elementsCount,
  report.databases.count,
  report.relationsByStyle,
);
// → 2 1 { sync: 0, async: 0, unspecified: 1 }
```

## Сравнить две модели

`computeDiff(baseline, current, baselineSide, currentSide, options?)` — тот же
движок, что за `aact diff`. «Стороны» — это `{ source, format }` для
диагностики:

```ts
import { computeDiff } from "aact";

const { changes, summary } = computeDiff(
  before,
  after,
  { source: "architecture.dsl", format: "structurizr" },
  { source: "architecture-fixed.dsl", format: "structurizr" },
);
console.log(summary.headline);
for (const c of changes) console.log(c.action, c.entity, c.name);
```

```text
+1 element, +2 relations, -1 relation [structural]
  removed relation orders→orders-db
  added element orders-repo
  added relation orders-repo→orders-db
  added relation orders→orders-repo
  modified boundary shop
```

`summary` несёт `bySeverity` (`structural` / `semantic` / `cosmetic`), `byAction`,
`byEntity`; `changes` — плоский список; `groups` — распознанные «намерения» вроде
«введён слой репозитория».

## Сгенерировать артефакты

`format.generate(model)` отдаёт `{ files: [{ path, content }] }`:

```ts
import { kubernetesFormat } from "aact";

const out = kubernetesFormat.generate!(model);
console.log(out.files.map((f) => f.path).join(", "));
// → namespaces.yaml, orders.yaml, orders-db.yaml
```

`generate` (как и `load` / `fix`) опционален — проверяйте `canGenerate(format)`
либо ставьте `!`, если формат точно умеет.

## Разобрать вывод CLI

Если интегрируетесь с уже работающим `aact <command> --json`, типы envelope тоже
публичны: `CliEnvelope`, `CheckData`, `ModelData`, `DiffData`, `AnalysisReport`,
`RuleMetadata` и т.д. `envelope.data` типизируется под конкретную команду — парсить
ничего руками не нужно, схема зафиксирована (`schemaVersion: 1`).

## Дальше

- Правила с автофиксом целиком — [Свои правила](./custom-rules.md).
- Из чего состоит `Model`, которую вы грузите — [Моделирование под aact](./modeling.md).
- Тот же `computeDiff` против кластера — [Соответствие архитектуры и реализации](./architecture-conformance.md).
