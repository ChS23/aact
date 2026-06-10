# Запуск проверки (`aact check`)

`check` — центральная команда: прогоняет модель через [включённые
правила](./configuring-rules.md), печатает нарушения, чинит то, что
автофиксится, и умеет машинный вывод. Здесь — как читать результат, три режима
вывода и автофикс.

## Анатомия нарушения

```text
  architecture.puml:11:1  error  crud          orders: directly accesses database orders_db — add a repo or relay
                          ↳ database: orders_db: architecture.puml:7:3
  architecture.puml:7:3   error  dbPerService  orders_db: shared between orders, orders_repo — each database should have a single owner
                          ↳ accessor: orders: architecture.puml:11:1
                          ↳ accessor: orders_repo: architecture.puml:10:1

 ╭───────────────✗ check──────────────────╮
 │  2 violations in 2 rules               │
 │  1 rule has auto-fix — run with --fix  │
 ╰────────────────────────────────────────╯
```

Каждая строка нарушения: `файл:строка:колонка`, `severity`, имя правила,
сообщение. Вложенные `↳` — вторичные якоря (контекст): для `dbPerService` это
все владельцы базы, чтобы видеть, кто конфликтует, не открывая исходник.
`файл:строка:колонка` — кликабельны в терминале (VSCode / Cursor / Zed /
iTerm2 / Ghostty / WezTerm / Kitty): прыжок прямо к строке.

## Автофикс: `--dry-run` и `--fix`

`--dry-run` — план без записи на диск:

```text
  architecture.puml:11:1  error  crud  orders: directly accesses database orders_db — add a repo or relay
                            ↳ database: orders_db: architecture.puml:7:3
     → would Add repo intermediary for orders → orders_db
       replace architecture.puml:6:3  →  Container(orders_repo, "Orders Repo", "", "", $tags="repo")
       replace architecture.puml:11:1  →  Rel(orders, orders_repo, "PostgreSQL")

  architecture.puml:7:3  error  dbPerService  orders_db: shared between orders, orders_repo — each database should have a single owner
     → resolved together with crud fix

 ╭────✗ check (dry-run)───────╮
 │  2 violations · 2 fixable  │
 │  run --fix to apply        │
 ╰────────────────────────────╯
```

Здесь видно ключевое: фиксы **range-based** (каждый — `replace <file:line:col>`),
и одна правка закрывает **два** нарушения — фикс `crud` (вынести связь через
`orders_repo`) заодно решает `dbPerService` (`→ resolved together with crud
fix`). aact дедуплицирует правки, а не плодит их.

`--fix` применяет план и пишет в источник:

```text
  ✓  crud  Add repo intermediary for orders → orders_db  (also resolves: dbPerService)

 ╭─────────────✓ check --fix───────────────╮
 │  1 fix applied · 2 violations resolved  │
 │  wrote architecture.puml                │
 ╰─────────────────────────────────────────╯
```

После записи `check` **перепроверяет** результат — если остались нарушения,
exit остаётся `1` (никакого ложного green в CI).

## Три режима вывода

```bash
npx aact check            # text — для людей, кликабельные ссылки
npx aact check --json     # стабильный envelope для агентов / CI
npx aact check --sarif    # SARIF v2.1.0 → GitHub Code Scanning
```

`--json` отдаёт `CliEnvelope` (`schemaVersion: 1`): на верхнем уровне
`command` / `ok` / `exitCode` / `data` / `diagnostics` / `meta`, а в `data` —
`violations`, `suggestedFixes`, `summary`, `rules` (метаданные правил),
`mergedFixes` (что схлопнулось при дедупе). Каждое нарушение несёт `rule`,
`target`, `severity`, `sourceLocation`. Парсить текст не нужно. Про
`--sarif` и Code Scanning — [CI-гайд](./ci-github-code-scanning.md). Режим
один; `--sarif` выигрывает у `--json`, если заданы оба.

## Exit-коды

| Код | Значение                                                                |
| --- | ----------------------------------------------------------------------- |
| `0` | нарушений нет                                                           |
| `1` | есть нарушения                                                          |
| `2` | ошибка инструмента (конфиг невалиден, источник не найден, парсинг упал) |

На них завязывают гейтинг в CI без парсинга вывода.

## Дальше

- Какие правила вообще бегут — [Настройка правил](./configuring-rules.md).
- Что значат теги/имена, на которые правила реагируют — [Моделирование](./modeling.md).
- `check --sarif` в пайплайне — [CI: Code Scanning](./ci-github-code-scanning.md).
