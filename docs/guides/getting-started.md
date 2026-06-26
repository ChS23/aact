# Быстрый старт

От нуля до зелёного `check` за пять минут: `init` → `check` → `--fix`. Установка
не нужна — всё через `npx`.

## 1. Создать каркас: `aact init`

```bash
npx aact init
```

```text
✔ Created aact.config.ts
✔ Created architecture.puml
Next: run `aact check` to see violations, then `aact check --fix` to auto-fix.
```

`init` кладёт два файла: `aact.config.ts` и `architecture.puml`. Конфиг написан
через `import type { AactConfig } from "aact"` — тип стирается на этапе загрузки,
поэтому `aact` работает **без `npm install`**.

`architecture.puml` — стартовая C4-модель, в которую **намеренно зашито
нарушение**: сервис ходит в базу напрямую.

```text
System_Boundary(checkout, "Checkout") {
  Container(orders, "Orders Service")
  Container(orders_repo, "Orders Repo", "PostgreSQL driver")
  ContainerDb(orders_db, "Orders DB")
}

Rel(orders_repo, orders_db, "PostgreSQL")
Rel(orders, orders_db, "PostgreSQL")   ' ← orders лезет в БД мимо репозитория
```

## 2. Найти нарушения: `aact check`

```bash
npx aact check
```

```text
  architecture.puml:23:1  error  crud          orders: directly accesses database orders_db — add a repo or relay
                          ↳ database: orders_db: architecture.puml:19:3
  architecture.puml:19:3  error  dbPerService  orders_db: shared between orders, orders_repo — each database should have a single owner
                          ↳ accessor: orders: architecture.puml:23:1
                          ↳ accessor: orders_repo: architecture.puml:22:1

 ╭───────────────✗ check──────────────────╮
 │  2 violations in 2 rules               │
 │  1 rule has auto-fix — run with --fix  │
 ╰────────────────────────────────────────╯
```

Каждая строка: `файл:строка:колонка`, severity, имя правила, сообщение. Вложенные
`↳` — вторичные якоря (где ещё «живёт» проблема). `файл:строка:колонка`
кликабельны в терминале — прыжок прямо к строке. Exit-код `1`.

Здесь сработали два правила: `crud` (прямой доступ к БД) и `dbPerService`
(у базы два владельца) — оба про одну и ту же лишнюю связь.

## 3. Починить: `aact check --fix`

```bash
npx aact check --fix
```

```text
  ✓  crud  Add repo intermediary for orders → orders_db  (also resolves: dbPerService)

 ╭─────────────✓ check --fix───────────────╮
 │  1 fix applied · 2 violations resolved  │
 │  wrote architecture.puml                │
 ╰─────────────────────────────────────────╯
```

Фикс **range-based**: aact переписывает связь `orders → orders_db` так, чтобы она
шла через уже существующий `orders_repo` (не плодит новый контейнер). Одна правка
закрывает **оба** нарушения. После записи `check` сам перепроверяет результат — в
CI не будет ложного «зелёного».

## 4. Чисто

```bash
npx aact check
```

```text
 ╭───────✓ check──────────╮
 │  No violations found.  │
 ╰────────────────────────╯
```

Exit `0` — гейт пройден.

## Что в конфиге

`aact.config.ts` — это `source` (формат + путь) и `rules`. Правила **opt-in**:
работают только перечисленные, `true` = с дефолтами, объект = с опциями, `false`
= выключить.

```ts
rules: {
  acl: true,                  // только ACL-контейнеры зависят от внешних систем
  acyclic: true,              // нет циклов
  apiGateway: true,           // внешние вызовы — через API-gateway
  crud: true,                 // в БД ходят только repo/relay-контейнеры
  dbPerService: true,         // у каждой БД один владелец
  cohesion: true,             // связность boundary > связанности
  stableDependencies: false,  // зависеть от более стабильного — off, пока не размечена стабильность
  commonReuse: true,          // переиспользуй весь публичный API контекста или ничего
},
```

Свои правила добавляются через `defineConfig` + `customRules` (после
`npm install aact`) — см. [Свои правила](./custom-rules.md).

## Дальше

- Как описать архитектуру, чтобы правила срабатывали верно — [Моделирование под aact](./modeling.md).
- Какие правила бегут и как их настроить — [Настройка правил](./configuring-rules.md).
- Все режимы `check` (`--json` / `--sarif`, exit-коды) — [Запуск проверки](./check.md).
- Увидеть архитектуру глазами — [Разобраться в архитектуре (`view`)](./explore-view.md).
