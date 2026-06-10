# Настройка правил в конфиге

Built-in правила — **opt-in**: `aact check` запускает только те, что вы явно
перечислили в `aact.config.ts`. Пустой или отсутствующий `rules` — ничего не
проверяется. Так конфиг всегда показывает, что именно энфорсится, без невидимых
дефолтов.

## Включить, выключить, посмотреть

Правило в `rules` — это `true` (включить с дефолтами), объект опций (включить с
настройкой) или `false` (явно выключить). Не перечислили — значит выключено.

```ts
import { defineConfig } from "aact";

export default defineConfig({
  source: "./architecture.puml",
  rules: {
    crud: { repoTags: ["repo", "dao"] }, // включено, с опциями
    acl: true, // включено, дефолты
    dbPerService: true,
    acyclic: false, // выключено явно
    // apiGateway, cohesion, stableDependencies, commonReuse
    // не перечислены — значит не работают
  },
});
```

Итоговый набор всегда виден через `aact rule list`:

```text
Built-in
  ●  acl                 Containers calling external systems must be tagged as ACL (Anti-corruption Layer) [fix]
  ○  acyclic             Dependency graph between containers must be acyclic (no cycles)
  ○  apiGateway          ACL containers calling external systems must route through an API Gateway
  ●  crud                Direct database access only through repo/relay containers; repos must access databases only [fix]
  ●  dbPerService        Each database container must have a single owner (one repo/relay per DB) [fix]
  ○  cohesion            Each boundary should be more cohesive than coupled; parent boundaries less cohesive than inner ones
  ○  stableDependencies  Dependencies should point toward more stable containers (instability calculation)
  ○  commonReuse         Consumers using part of a boundary's public surface should use all of it

3/8 rules enabled · ● enabled · ○ disabled
```

`npx aact init` сразу выписывает все built-ins явно — так что после `init`
конфиг уже самодокументирован, останется убрать ненужное.

## Опции правил

Часть правил настраивается — передайте объект вместо `true`. Что значат теги и
имена — в гайде [Моделирование под aact](./modeling.md).

| Правило                                                    | Опции (дефолт)                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `crud`                                                     | `repoTags` (`["repo","relay"]`), `repoNamePatterns`                    |
| `acl`                                                      | `tag` (`"acl"`), `namePatterns`                                        |
| `apiGateway`                                               | `aclTag` (`"acl"`), `gatewayPattern` (`/gateway/i`), `aclNamePatterns` |
| `dbPerService`                                             | `ownerTags` (`["repo","relay"]`), `ownerNamePatterns`                  |
| `acyclic`, `cohesion`, `stableDependencies`, `commonReuse` | без опций                                                              |

```ts
rules: {
  // у вас репозитории зовутся иначе — переопределите теги и имена
  crud: { repoTags: ["repo", "dao"], repoNamePatterns: ["*_store", "*Gateway"] },
  acl: { tag: "adapter", namePatterns: ["*_ext"] },
  apiGateway: { gatewayPattern: /gw|edge/i },
  dbPerService: { ownerNamePatterns: ["*_repo"] },
}
```

`defineConfig` дженерик: TypeScript подсказывает имена правил и форму их опций
прямо в `rules: { crud: { ←tab } }`. Подробности по конкретному правилу —
`npx aact rule explain crud` или [справочник правил](../reference/rules/).

## Свои правила

Кастомные правила подключаются через `customRules` и **авто-включаются** (их
регистрация и есть opt-in). Как их писать — в гайде
[Свои правила](./custom-rules.md).

## Метрики: блок `analyze`

`aact analyze` (и правило `cohesion`) настраиваются отдельным блоком:

```ts
analyze: {
  // подстроки в technology, по которым связь считается sync / async,
  // когда на ней нет явного тега sync/async
  syncTechnologies: ["rest", "http", "grpc"],
  asyncTechnologies: ["kafka", "rabbitmq"],
  // что исключить из hotspot-рейтингов (структурные метрики — по всему графу)
  exclude: { tags: ["legacy"], namePatterns: ["*_proxy"] },
  topN: 10, // размер списка hotspot'ов (дефолт 5)
}
```

## Дальше

- Что значат теги/имена, которые читают правила — [Моделирование под aact](./modeling.md).
- Полный список правил с rationale и примерами — [справочник](../reference/rules/).
