# aact ↔ Kubernetes: дрейф между архитектурой и кластером

Архитектура-as-code описывает **намерение** — как система должна быть устроена.
Кластер описывает **реальность** — что на самом деле задеплоено. Со временем они
расходятся: кто-то выкатил сервис мимо схемы, выкинул слой репозитория «чтобы
быстрее», подменил движок БД. aact читает **обе** стороны в одну C4-модель и
показывает, чем они отличаются.

Для k8s aact работает в двух направлениях:

- **`load`** — настоящие манифесты (`Deployment` / `StatefulSet` / `Service` …)
  → нормализованная C4-модель. Это основа для `diff`, `check`, `model`, `view`.
- **`generate`** — модель → черновые k8s-артефакты (приближение для ревью,
  см. ниже).

Флагман — обнаружение дрейфа: `aact diff architecture.dsl ./k8s/`.

## Пример

[`examples/kubernetes-drift/`](../../examples/kubernetes-drift) — система `Shop`:

- `architecture.dsl` — намеренная архитектура (Structurizr DSL): ни один сервис
  не ходит в БД напрямую, всё через слой репозитория.
- `k8s/` — то, что «задеплоено», с тремя намеренными дрейфами:
  1. `orders-repo` **не задеплоен** — `orders-api` ходит в `orders-db` напрямую;
  2. в кластере крутится `metrics-collector`, которого **нет в архитектуре**;
  3. `billing-db` поднят на **MySQL**, хотя архитектура требует PostgreSQL.

## Найти дрейф: `aact diff`

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
- `+ metrics-collector` — узел задеплоен, но в архитектуре его нет.
- `~ billing-db technology: PostgreSQL → MySQL` — **семантический** дрейф:
  движок БД подменили.

Внизу — классификация: `structural` (граф изменился), `semantic` (поменялся
смысл — технология, теги), `cosmetic` (имена/метаданные). Косметику дефолтный
вывод сворачивает — здесь это метаданные workspace, которых у кластера нет.

Сравнение **кросс-форматное**: aact приводит обе стороны к одной модели и не
тонет в шуме представления. Так, `Orders DB` (DSL) и под `orders-db` (k8s) — это
один элемент: имена выровнены, styling-теги Structurizr и человеческие лейблы
нормализованы, остаётся только настоящий дрейф.

## Как aact читает кластер

| k8s                                     | C4-модель                                   |
| --------------------------------------- | ------------------------------------------- |
| `Deployment` / `StatefulSet` / `Job` …  | `Container` (kind — по образу)              |
| `image: postgres` / `mysql` / `redis` … | `ContainerDb`; `kafka` / `rabbitmq` → Queue |
| `metadata.namespace`                    | `Boundary`                                  |
| env-vars + `Service`-селекторы          | связи между контейнерами                    |
| `aact.*`-аннотации                      | override имени / kind / technology / …      |

`aact model ./k8s/` показывает ровно ту модель, которую увидит `diff`:

```text
Elements: 6
  Container        4
  ContainerDb      2
Boundaries: 1
  shop (System) — 6 element(s), 0 nested
Relations: 4
```

### Связи: env-vars + Service

aact не выдумывает связи — он повторяет k8s-овый service discovery. Для каждого
env-var с суффиксом `_URL` / `_DB_URL` / `_HOST` / `_SERVICE` / `_ADDR` (и т.п.)
из значения извлекается хост, ищется одноимённый `Service`, и связь ведётся к
workload'у, который этот Service expose'ит.

В примере `orders-api` объявляет `BILLING_URL=http://billing-svc:8080`, а
`Service billing-svc` селектит под `billing-service` — aact выводит связь
`orders-api → billing-service`. **Имя Service (`billing-svc`) не обязано
совпадать с именем workload'а (`billing-service`)** — это и есть та сверка,
которую aact делает за вас.

Если service discovery в вашем кластере неявный (DNS, service mesh), задайте
связи явно аннотацией: `aact.depends-on: "billing-service, orders-db"` —
authoritative override, env-vars тогда не парсятся.

### Имена: архитектура ↔ workload

Идентичность элемента aact берёт из имени **workload'а** (`metadata.name`).
Поэтому простое правило: **называйте C4-контейнеры так же, как ваши workload'ы.**
`-svc`-суффиксы Service'ов сводятся автоматически (см. выше).

Если C4-имя всё же отличается от имени workload'а, есть два пути:

- `aact.element: orders-api` на манифесте — переименовать элемент под
  архитектуру (authoritative);
- ничего не делать — `aact diff` распознаёт переименования эвристикой и покажет
  `~ renamed`, а не `add` + `remove`.

### Аннотации

`aact.*`-аннотации на манифесте уточняют модель там, где из голого k8s её не
вывести. В примере БД помечены `aact.technology` (чтобы читались как `PostgreSQL`
/ `MySQL`, а не `postgres:16`), сервисы — `aact.description`, `billing-repo` —
`aact.tags: repo`. Полный список — `element` / `kind` / `label` / `description`
/ `technology` / `tags` / `external` / `link` / `skip` / `depends-on`.

## Линтовать кластер напрямую: `aact check`

`diff` ловит расхождение со схемой. Но кластер можно прогнать и через правила
**сам по себе** — задеплоенная реальность тоже должна соответствовать паттернам.
`check`, `model` и `analyze` принимают source **позиционно** (как `diff`), так что
конфиг не нужен — наведите прямо на каталог манифестов:

```bash
npx aact check ./k8s/        # директория автодетектится как kubernetes
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
задеплоен. (Без конфига ad-hoc `check` гоняет все встроенные правила; для своего
набора — `aact.config.ts`.) `--fix` для k8s недоступен — фиксы правят источник
архитектуры, а не манифесты.

## В CI: гейт на дрейф

Exit-код `aact diff` — готовый гейт:

| Код | Когда                            |
| --- | -------------------------------- |
| `0` | дрейфа нет или только косметика  |
| `1` | есть structural / semantic дрейф |
| `2` | ошибка инструмента               |

```bash
# сравнить главную ветку схемы с тем, что задеплоено
npx aact diff main:architecture.dsl ./k8s/ || echo "deployment drifted from architecture"
```

`--json` отдаёт стабильный envelope (`summary` / `changes` / `groups`), `--sarif`
у `check` — алерты в GitHub Code Scanning. Подробнее — [CI: SARIF → Code
Scanning](./ci-github-code-scanning.md) и [Ревью diff в PR](./review-diff.md).

## `generate`: модель → k8s (приближение)

```bash
npx aact generate --format kubernetes --output ./out/
```

`generate` эмитит **черновые** манифесты-приближение для ревью, а не
production-ready Deployment'ы: у команд обычно свой Helm/Kustomize. Это **не
обратная операция** к `load` — сгенерённый артефакт не предназначен для
повторного `diff`. Воспринимайте вывод как подсказку «вот примерно какие сервисы
и связи следуют из модели», а источник истины для деплоя держите свой.

## Границы

- **Helm** — aact не рендерит шаблоны. Сначала `helm template <release> <chart> >
rendered.yaml`, потом наводите aact на результат. Kustomize (`kustomization.yaml`
  - `resources`) проходится автоматически.
- **Technology** — голый образ даёт `postgres:16`, а архитектура — `PostgreSQL`.
  Чтобы tech-дифф был чистым, проставьте `aact.technology` на workload'ах (как в
  примере) либо не гейтите на технологию, а смотрите на структуру.
- **Вне scope** — `NetworkPolicy`, `Ingress`, `ConfigMap`/`Secret`-ссылки, CRD,
  deployment-view C4. aact про static C4 (System / Container / Component).

## Дальше

- Как описать саму архитектуру — [Моделирование под aact](./modeling.md).
- Что значат `diff`-группы и `aact view --diff` — [Ревью diff в PR](./review-diff.md).
- Правила, которые ловят нарушения паттернов — [Настройка правил](./configuring-rules.md).
