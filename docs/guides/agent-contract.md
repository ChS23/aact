# Контракт для агентов

AI-агент работает с aact **не парся текст**, а через стабильный JSON-envelope и
exit-коды. aact в этой связке — **детерминированная** обратная связь: агент
переводит намерение в C4, а aact проверяет результат — без LLM в петле валидации.
Цикл: `model` → рассуждение → правка → `check` → повтор.

## Стабильный конверт: `--json`

Любая команда с `--json` отдаёт один и тот же `CliEnvelope` (`schemaVersion: 1`,
заморожен на GA — меняется только при breaking-переименованиях). Меняются лишь
`data` и набор диагностик:

```jsonc
{
  "schemaVersion": 1,
  "command": "check", // check | model | analyze | diff | rule list | …
  "ok": false, // === (exitCode === 0)
  "exitCode": 1, // 0 чисто · 1 нарушения/изменения · 2 ошибка инструмента
  "data": {
    /* пер-командная форма (см. ниже) */
  },
  "diagnostics": [
    /* проблемы загрузчика / инструмента */
  ],
  "meta": {
    "aactVersion": "3.0.0",
    "durationMs": 2,
    "configPath": null,
    "source": "…",
  },
}
```

## Exit-коды — гейт без парсинга

Контракт: **`0`** чисто · **`1`** нарушения (или structural/semantic-изменения в
`diff`) · **`2`** ошибка инструмента (конфиг невалиден, источник не найден,
парсинг упал). Агент **ветвится на коде**, а не на тексте — и не схлопывает
`1` и `2` в «не ноль».

## Инспекция модели: `aact model --json`

Главная поверхность для агента. Возвращает нормализованный C4-граф — **ту же
Model, что видят правила**, — так что reasoning агента согласован с тем, что
скажет `check`. Это надёжнее, чем парсить `.puml` / `.dsl` руками.

```jsonc
"data": {
  "model": {
    "elements": { /* по имени: { name, kind, external, technology, tags, relations[…] } */ },
    "boundaries": { /* по имени: { kind, elementNames[], boundaryNames[] } */ },
    "rootBoundaryNames": ["shop"]
  },
  "issues": [ /* типизированные проблемы загрузчика: dangling-relation, … */ ]
}
```

Источник — **позиционно**: `aact model architecture.dsl` или `aact model ./k8s/`
(директория автодетектится как kubernetes), конфиг не нужен.

## Проверка: `aact check --json`

```jsonc
"data": {
  "summary": { "passed": 7, "failed": 1, "violations": 1 },
  "violations": [
    {
      "ruleId": "crud",
      "target": "orders",
      "targetKind": "element",     // "element" | "boundary" — какую таблицу смотреть
      "severity": "error",         // "error" | "warning" | "info"
      "message": "directly accesses database orders-db — add a repo or relay",
      "sourceLocation": {
        "file": "architecture.dsl",
        "start": { "line": 9, "col": 9, "offset": 259 },   // offset — UTF-16 code units
        "end":   { "line": 9, "col": 43, "offset": 293 }
      }
    }
  ],
  "rules": [ /* RuleMetadata по каждому правилу */ ],
  "suggestedFixes": [ /* range-based правки, применимые через --fix */ ]
}
```

`summary.passed`/`failed` считают **правила**, `violations` — **находки**.
`ruleId` совпадает с `result.ruleId` в SARIF и с `rules[].ruleId` — джойнить по
одному ключу, не по тексту. `sourceLocation` точно указывает на проблемное место
(агент чинит ровно там).

## Узнать правила: `aact rule list` / `rule explain`

`rule list --json` → `RuleMetadata` по каждому (встроенному + кастомному):

```jsonc
{
  "ruleId": "crud",
  "description": "Direct database access only through repo/relay …",
  "source": "built-in",
  "enabled": true,
  "hasFix": true,
  "helpUri": "https://github.com/Byndyusoft/aact/blob/main/ADRs/Database%20per%20CRUD-service.md",
}
```

`rule explain <name> --json` добавляет `rationale`, `examples` (good/bad-сниппеты)
и `adrPath` — агент использует `rationale` как контекст, когда предлагает фикс,
вместо того чтобы выдумывать обоснование.

## SARIF и аннотации CI

`--sarif` у `check` / `model` — SARIF v2.1.0 для GitHub Code Scanning (тот же
`ruleId`, `helpUri` из ADR). Подробнее — [CI: SARIF → Code
Scanning](./ci-github-code-scanning.md).

## Скилл `aact-architect`

Чтобы агент **знал, когда и как** звать aact, поставьте agent skill — он несёт
каталог C4-паттернов, ADR-шаблоны и CLI-обёртки:

```bash
npx aact skill install --claude   # ~/.claude/skills/aact-architect
npx aact skill install --codex    # ~/.agents/skills/aact-architect (Codex/Cursor/Copilot)
npx aact skill install --all
```

Скилл держит **всё рассуждение о паттернах в markdown** и **делегирует проверку
детерминированному CLI** — ровно разделение из этого гайда: агент переводит
намерение в C4 + ADR, aact проверяет.

## Дальше

- Все режимы `check` и автофикс — [Запуск проверки](./check.md).
- Те же примитивы из кода (без CLI) — [aact как библиотека](./library-api.md).
- С нуля для человека — [Быстрый старт](./getting-started.md).
