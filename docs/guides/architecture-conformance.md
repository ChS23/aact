# Соответствие архитектуры и реализации (AaC ↔ IaC)

**Architecture-as-Code** (Structurizr DSL, C4-PlantUML) описывает **намерение** —
как система должна быть устроена. **Infrastructure-as-Code** (Kubernetes-манифесты,
Docker Compose) описывает **реальность** — что развёрнуто на самом деле. Со
временем они расходятся: кто-то выкатил сервис мимо схемы, выкинул слой
репозитория «чтобы быстрее», подменил движок БД. aact читает **обе** стороны в
одну C4-модель и показывает, чем они отличаются.

Сравнение **кросс-форматное**: одна сторона берётся из AaC-источника, вторая —
из IaC-таргета, aact приводит их к одной модели. Ниже — подробный разбор на
Kubernetes (самый богатый таргет); с Docker Compose всё работает так же —
разница лишь в том, что Compose плоский и не выражает границы.

Оба направления обратимы через C4-модель:

- **`load`** (манифесты → C4-модель) — основное направление для конформанса:
  aact читает настоящие `Deployment` / `StatefulSet` / `Service` и строит
  модель, на которой работают `diff`, `check`, `model`, `view`.
- **`generate`** (модель → манифесты) — скелет, готовый к `kubectl apply`
  (`apps/v1` Deployment/StatefulSet + Service), но **структурный**: модель не
  несёт ресурсов, probe'ов, секретов, см. раздел ниже.

Главное здесь — находить расхождения: `aact diff architecture.dsl ./k8s/`.

## Пример

[`examples/kubernetes-drift/`](../../examples/kubernetes-drift) — система `Shop`:

- `architecture.dsl` — намеренная архитектура (Structurizr DSL): ни один сервис
  не ходит в БД напрямую, всё через слой репозитория.
- `k8s/` — то, что развёрнуто, с тремя намеренными расхождениями:
  1. `orders-repo` **не развёрнут** — `orders-api` ходит в `orders-db` напрямую;
  2. в кластере крутится `metrics-collector`, которого **нет в архитектуре**;
  3. `billing-db` поднят на **MySQL**, хотя архитектура требует PostgreSQL.

## Найти расхождения: `aact diff`

```bash
npx aact diff architecture.dsl ./k8s/
```

```text
  +1 element, -1 element, +1 relation, -2 relations, 1 technology change [structural]

  - Element orders-repo                  (Container)
  - Relation orders-api → orders-repo
  - Relation orders-repo → orders-db
  + Element metrics-collector            (Container)
  + Relation orders-api → orders-db
  ~ Boundary shop                         elementNames +[metrics-collector] -[orders-repo]
  ~ Element billing-db                   technology: PostgreSQL → MySQL

  + 1 cosmetic change (use --json to see all)

  6 structural / 1 semantic / 1 cosmetic
```

Читается по строкам:

- `- orders-repo` и две связанные связи исчезли, а `+ orders-api → orders-db`
  появилась — **слой репозитория в проде отсутствует**, сервис лезет в базу
  напрямую.
- `+ metrics-collector` — узел развёрнут, но в архитектуре его нет.
- `~ billing-db technology: PostgreSQL → MySQL` — **семантическое** расхождение:
  движок БД подменили.

Внизу — классификация: `structural` (граф изменился), `semantic` (поменялся
смысл — технология, теги), `cosmetic` (имена/метаданные). Косметику вывод по
умолчанию сворачивает — здесь это метаданные workspace, которых у кластера нет.

Сравнение **кросс-форматное**: aact приводит обе стороны к одной модели и не
тонет в шуме представления. Так, `Orders DB` (DSL) и под `orders-db` (k8s) — это
один элемент: имена выровнены, служебные теги Structurizr и человекочитаемые
подписи нормализованы, остаётся только настоящее расхождение.

## Как aact читает кластер

| k8s                                        | C4-модель                                     |
| ------------------------------------------ | --------------------------------------------- |
| `Deployment` / `StatefulSet` / `Job` …     | `Container` (kind — по образу)                |
| `image: postgres` / `mysql` / `redis` …    | `ContainerDb`; `kafka` / `rabbitmq` → Queue   |
| `metadata.namespace`                       | `Boundary`                                    |
| переменные окружения + `Service`-селекторы | связи между контейнерами                      |
| `aact.*`-аннотации                         | переопределение имени / kind / technology / … |

`aact model ./k8s/` показывает ровно ту модель, которую увидит `diff`:

```text
Elements: 6
  Container        4
  ContainerDb      2
Boundaries: 1
  shop (System) — 6 element(s), 0 nested
Relations: 4
```

### Связи: переменные окружения + Service

aact не выдумывает связи — он повторяет то, как сервисы находят друг друга в
k8s. Для каждой переменной окружения с суффиксом `_URL` / `_DB_URL` / `_HOST` /
`_SERVICE` / `_ADDR` (и т.п.) из значения извлекается хост, ищется одноимённый
`Service`, и связь ведётся к workload'у, который этот `Service` обслуживает.

В примере `orders-api` объявляет `BILLING_URL=http://billing-svc:8080`, а
`Service billing-svc` выбирает поды `billing-service` — aact выводит связь
`orders-api → billing-service`. **Имя Service (`billing-svc`) не обязано
совпадать с именем workload'а (`billing-service`)** — это и есть та сверка,
которую aact делает за вас.

Если связи в кластере неявные (DNS, service mesh), задайте их явно аннотацией:
`aact.depends-on: "billing-service, orders-db"` — это приоритетный источник,
переменные окружения тогда не разбираются.

### Имена: архитектура ↔ workload

Идентичность элемента aact берёт из имени **workload'а** (`metadata.name`).
Поэтому простое правило: **называйте C4-контейнеры так же, как ваши workload'ы.**
Суффиксы `-svc` у Service'ов сводятся автоматически (см. выше).

Если C4-имя всё же отличается от имени workload'а, есть два пути:

- `aact.element: orders-api` на манифесте — переименовать элемент под
  архитектуру (приоритетно);
- ничего не делать — `aact diff` распознаёт переименования эвристикой и покажет
  `~ renamed`, а не пару `add` + `remove`.

### Аннотации

`aact.*`-аннотации на манифесте уточняют модель там, где из голого k8s её не
вывести. В примере БД помечены `aact.technology` (чтобы читались как `PostgreSQL`
/ `MySQL`, а не `postgres:16`), сервисы — `aact.description`, `billing-repo` —
`aact.tags: repo`. Полный список — `element` / `kind` / `label` / `description`
/ `technology` / `tags` / `external` / `link` / `skip` / `depends-on`.

## Линтовать кластер напрямую: `aact check`

`diff` ловит расхождение со схемой. Но кластер можно прогнать и через правила
**сам по себе** — развёрнутая реальность тоже должна соответствовать паттернам.
`check`, `model` и `analyze` принимают источник **позиционно** (как `diff`), так
что конфиг не нужен — наведите прямо на каталог манифестов:

```bash
npx aact check ./k8s/        # директория распознаётся как kubernetes
```

```text
     error  crud  orders-api: directly accesses database orders-db — add a repo or relay

 ╭────────✗ check──────────╮
 │  1 violation in 1 rule  │
 ╰─────────────────────────╯

⚠ format.unsupportedFix  Format "kubernetes" doesn't support --fix
```

Архитектура (`npx aact check architecture.dsl`) правила проходит чисто — а
кластер нет: прод нарушает паттерн CRUD, потому что слой репозитория не
развёрнут. (Без конфига `check` гоняет все встроенные правила; для своего
набора — `aact.config.ts`.) `--fix` для k8s недоступен — фиксы правят источник
архитектуры, а не манифесты.

## В CI: гейт на расхождения

Код выхода `aact diff` — готовый гейт:

| Код | Когда                                |
| --- | ------------------------------------ |
| `0` | расхождений нет или только косметика |
| `1` | есть structural / semantic изменения |
| `2` | ошибка инструмента                   |

```bash
# сравнить главную ветку схемы с тем, что развёрнуто
npx aact diff main:architecture.dsl ./k8s/ || echo "deployment drifted from architecture"
```

`--json` отдаёт стабильный envelope (`summary` / `changes` / `groups`), `--sarif`
у `check` — алерты в GitHub Code Scanning. Подробнее — [CI: SARIF → Code
Scanning](./ci-github-code-scanning.md) и [Ревью diff в PR](./review-diff.md).

## `generate`: модель → k8s (скелет)

```bash
npx aact generate --format kubernetes --output ./out/
```

`generate` эмитит **настоящие** манифесты под текущий стабильный API (`apps/v1`
Deployment / StatefulSet, `v1` Service / Namespace) — скелет, готовый к
`kubectl apply`. Один файл на каждый workload (Deployment|StatefulSet + его
Service), namespaces из границ, связи — в ссылки на Service'ы через переменные
окружения, а `aact.*`-аннотации сохраняют kind / technology / tags / имя.
Поэтому операция **обратима**: `generate` → `load` → `diff` воспроизводит модель
(закреплено тестом обратимости).

Но это **скелет, а не источник истины для деплоя**: в C4-модели нет ресурсов,
probe'ов, секретов, ingress — это остаётся вашему Helm/Kustomize. Используйте
вывод как стартовую болванку и дополняйте его своим инструментом.

## Границы применимости

- **Helm** — aact не раскрывает шаблоны. Сначала
  `helm template <release> <chart> > rendered.yaml`, потом наводите aact на
  результат. Kustomize (`kustomization.yaml` с полем `resources`) обходится
  автоматически.
- **Технология** — голый образ даёт `postgres:16`, а архитектура — `PostgreSQL`.
  Чтобы дифф по технологии был чистым, проставьте `aact.technology` на
  workload'ах (как в примере) либо не завязывайте гейт на технологию, а смотрите
  на структуру.
- **Вне рамок** — `NetworkPolicy`, `Ingress`, ссылки на `ConfigMap`/`Secret`,
  CRD, deployment-вью C4. aact — про статические C4-представления (System /
  Container / Component).

## Дальше

- Как описать саму архитектуру — [Моделирование под aact](./modeling.md).
- Что значат `diff`-группы и `aact view --diff` — [Ревью diff в PR](./review-diff.md).
- Правила, которые ловят нарушения паттернов — [Настройка правил](./configuring-rules.md).
