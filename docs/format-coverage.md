# Format coverage matrix (v3.0)

Какие поля Model заполняются при load и emit'ятся при generate для каждого
формата. `✓` = full support, `⚠` = partial / known limitation, `—` = field
not applicable to this format, `gap` = silent drop (документировано).

PUML-сторона теперь обрабатывается собственным chevrotain-based parser'ом
(`src/formats/plantuml/parser/`). Structurizr (JSON и DSL) тоже идёт через
chevrotain — общая инфраструктура.

## Element

| Field            | PUML load                                           | PUML generate                            | Structurizr load                                    |
| ---------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `name`           | ✓ alias                                             | ✓                                        | ✓ via `structurizr.dsl.identifier` или raw id       |
| `label`          | ✓                                                   | ✓                                        | ✓ `name` field                                      |
| `kind`           | ✓ macro lookup                                      | ✓ reverse map                            | ✓ inferKindFromTechnology                           |
| `external`       | ✓ `_Ext` suffix                                     | ✓                                        | ✓ `location: External` или tag                      |
| `description`    | ✓ positional 4 / `$descr=`                          | ✓ positional 4                           | ✓ `description`                                     |
| `technology`     | ✓ positional 3 / `$techn=`                          | ✓ positional 3                           | ✓ `technology`                                      |
| `tags`           | ✓ `$tags=` или positional                           | ✓ `$tags=`                               | ✓ CSV `tags`                                        |
| `sprite`         | ✓ `$sprite=` или positional                         | ✓ `$sprite=`                             | —                                                   |
| `link`           | ✓ `$link=` или positional                           | ✓ `$link=`                               | ✓ `url`                                             |
| `relations`      | ✓ Rel + BiRel expansion + RelIndex                  | ✓ Rel each                               | ✓ Pass 3 mapping                                    |
| `properties`     | ✓ `AddProperty` rows attached by preParse line scan | ✓ emits `AddProperty` lines before macro | ✓ user properties + `group` + `perspectives.<name>` |
| `sourceLocation` | ✓ chevrotain populates per element (file/start/end) | —                                        | ✓ chevrotain populates per element                  |

## Boundary

| Field            | PUML load                                                                       | PUML generate                            | Structurizr load                                                        |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `name`           | ✓ alias                                                                         | ✓                                        | ✓ dslId                                                                 |
| `label`          | ✓                                                                               | ✓                                        | ✓ `name` field                                                          |
| `kind`           | ✓ `Boundary` / `System_Boundary` / `Container_Boundary` / `Enterprise_Boundary` | ✓ reverse map                            | hardcoded `"System"` (internal system → Boundary)                       |
| `description`    | ✓ positional / `$descr=`                                                        | ⚠ gap                                    | ✓ `description`                                                         |
| `tags`           | ✓                                                                               | ✓                                        | ✓ CSV                                                                   |
| `elementNames`   | ✓ via children scan                                                             | ✓                                        | ✓ s.containers                                                          |
| `boundaryNames`  | ✓ nested boundaries                                                             | ✓                                        | always `[]` — Structurizr не nests softwareSystem inside softwareSystem |
| `link`           | ✓                                                                               | ✓ `$link=`                               | ✓ `url`                                                                 |
| `properties`     | ✓ `AddProperty` rows attached by preParse line scan                             | ✓ emits `AddProperty` lines before macro | ✓ user + group + perspectives                                           |
| `sourceLocation` | ✓ spans `{` … `}` block                                                         | —                                        | ✓ spans the body block                                                  |

## Relation

| Field            | PUML load                                              | PUML generate                            | Structurizr load                                                           |
| ---------------- | ------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| `to`             | ✓                                                      | ✓                                        | ✓ targetName via idToName                                                  |
| `description`    | ✓ `label`                                              | ✓ positional 3                           | ✓ `description`                                                            |
| `technology`     | ✓ `techn`                                              | ✓ positional 4                           | ✓ `technology`                                                             |
| `tags`           | ✓ `$tags=` или positional 7                            | ✓ `$tags=`                               | ✓ CSV + `async` для async interactionStyle                                 |
| `sprite`         | ✓ `$sprite=` или positional 6                          | ✓ `$sprite=`                             | —                                                                          |
| `order`          | ✓ `RelIndex*` first positional или `$index=` named arg | ✓ — (default order preserved)            | ⚠ `gap` — Structurizr step order живёт в `views[].dynamic`, не на relation |
| `link`           | ✓ `$link=` или positional 8                            | ✓ `$link=`                               | ✓ `url`                                                                    |
| `properties`     | ✓ `AddProperty` rows attached by preParse line scan    | ✓ emits `AddProperty` lines before macro | ✓ user + perspectives prefix                                               |
| `sourceLocation` | ✓ points at the `Rel(…)` call                          | —                                        | ✓ points at the relationship statement                                     |

## Workspace metadata (Structurizr-only)

| Field         | Structurizr load                                       |
| ------------- | ------------------------------------------------------ |
| `name`        | ✓ `workspace "name"`                                   |
| `description` | ✓ `workspace "name" "description"`                     |
| `extends`     | ✓ `workspace extends "url"` / via `!extends` directive |

PUML и Kubernetes форматы workspace не имеют — `Model.workspace` остаётся
`undefined`.

## Known gaps and their resolution

| Gap                             | Workaround в v3.0                                | Resolution                                                |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Boundary description (generate) | none — generator не пишет `descr=`               | Add positional/named arg в `renderBoundary`               |
| `Relation.order` (Structurizr)  | none — dynamic views живут отдельно от relations | Surface step order через `Model.workspace.views[]` в v3.x |

### Closed gaps (post v3.0.0-beta.17)

- **`Element.properties` / `Relation.properties` from PUML** —
  `preParse.extractAttachedProperties` walks the source for
  `AddProperty(...)` rows preceding any in-scope macro (Container /
  Person / System / Boundary / Rel / BiRel / RelIndex) and attaches
  the key=value map by 1-based target line. `SetPropertyHeader` and
  `WithoutPropertyHeader` are header-only protocol; they reset the
  pending row buffer but do not surface on `Model.properties`. The
  generator emits one `AddProperty(...)` line per entry before each
  macro on round-trip.

## Capability matrix (capability-based Format API)

| Format        | load | generate | fix                                                   |
| ------------- | ---- | -------- | ----------------------------------------------------- |
| `plantuml`    | ✓    | ✓        | ✓ `plantumlSyntax` for in-place edits                 |
| `structurizr` | ✓    | —        | ✓ `structurizrDslSyntax` (пишет в `source.writePath`) |
| `kubernetes`  | —    | ✓        | —                                                     |

Adding new format = `src/formats/<name>/` папка + строка в `src/formats/registry.ts`.
См. `test/formats/registry.test.ts` для contract.
