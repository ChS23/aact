# v3 parser — Phase 0 inventory

**Status:** in progress. This is the first work product of the
chevrotain-parser refactor (`project_v3_parser_strategy` memo, Phase 0).

**Purpose.** Before we design an AST or write a line of grammar, we list
exactly **which `Model` fields are read by something inside the project**
— rules, the analyzer, generators, future `aact sync` reconcilers. The
new parser MUST populate every field on that list. Anything not on the
list is either round-trip-only data or out of scope.

This inventory feeds three downstream decisions:

1. **Minimum AST surface** — what the parser is obliged to emit.
2. **Round-trip obligations** — what `generate()` reads, so the parser
   must not lose it during `load()`.
3. **Scope discipline** — what the parser is allowed to ignore (opaque
   `LoadResult.raw`) and what should never enter the Model at all.

## Method

For each consumer, list the `Model` accessors it touches in `check()`
and `fix()` (rules), in `analyzeArchitecture()` (analyzer), and in
`generate()` (format outputs). Group by Model entity. Resolve every
column as one of: **core** (parser must populate, rules depend on it),
**round-trip** (parser must populate for `generate()`), or
**diagnostics** (`sourceLocation` — parser-only obligation, no consumer
yet but load-bearing for why the refactor exists).

## Consumers surveyed

| Layer              | File                                                                                                                            | Role                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Rule (check)       | `src/rules/acl.ts`                                                                                                              | tag-based external dependency check                                |
| Rule (check + fix) | `src/rules/acyclic.ts`, `apiGateway.ts`, `cohesion.ts`, `commonReuse.ts`, `crud.ts`, `dbPerService.ts`, `stableDependencies.ts` | 7 built-in rules, 3 with auto-fix                                  |
| Analyzer           | `src/analyze.ts`                                                                                                                | coupling / cohesion / databases metrics, sync/async classification |
| Generator          | `src/formats/plantuml/generate.ts`                                                                                              | Model → C4-PlantUML, full round-trip target                        |
| Generator          | `src/formats/kubernetes/generate.ts`                                                                                            | Model → k8s YAML scaffolds, `kind === "Container"` only            |
| Generator          | _missing_ — `src/formats/structurizr/` has no `generate.ts`                                                                     | Round-trip from Structurizr load is **not implemented** today      |

Custom rules (user-supplied via `customRules`) are out of scope for this
table — they may read any `Model` field. The parser must populate the
full Model contract regardless.

## `Container` field × consumer matrix

| Field            | rules (check)                                                 | rules (fix)                 | analyzer                       | plantuml gen                        | k8s gen                             | sync (planned)        | Status                                            |
| ---------------- | ------------------------------------------------------------- | --------------------------- | ------------------------------ | ----------------------------------- | ----------------------------------- | --------------------- | ------------------------------------------------- |
| `name`           | all                                                           | acl, crud, dbPerService     | yes                            | yes                                 | yes (`toKebab`)                     | yes (match)           | **core**                                          |
| `kind`           | crud, dbPerService (`target.kind === "ContainerDb"`)          | crud, dbPerService          | yes (`kind === "ContainerDb"`) | yes (`c4MacroName(kind, external)`) | yes (filter `kind === "Container"`) | yes (drift)           | **core**                                          |
| `external`       | apiGateway, cohesion, stableDependencies, (analyzer)          | —                           | yes (sync API classification)  | yes (`c4MacroName`)                 | yes (`*_BASE_URL`)                  | yes                   | **core**                                          |
| `tags`           | acl, apiGateway, crud, dbPerService                           | crud, dbPerService          | yes (`async`)                  | yes (`$tags=`)                      | yes (`async` → Kafka)               | yes (labels)          | **core**                                          |
| `label`          | —                                                             | acl (synthesises `"X ACL"`) | yes                            | yes                                 | —                                   | —                     | **round-trip + fix**                              |
| `description`    | —                                                             | —                           | —                              | yes                                 | —                                   | —                     | **round-trip**                                    |
| `technology`     | apiGateway (`.split(", ")`), dbPerService (round-trip in fix) | acl, crud, dbPerService     | yes (sync API classification)  | yes                                 | yes (env var values)                | yes (drift)           | **core**                                          |
| `relations`      | all                                                           | acl, crud, dbPerService     | yes (all metrics)              | yes                                 | yes (all env vars)                  | yes (unenforced)      | **core**                                          |
| `sprite`         | —                                                             | —                           | —                              | yes (`$sprite=`)                    | —                                   | —                     | **round-trip**                                    |
| `link`           | —                                                             | —                           | —                              | yes (`$link=`)                      | —                                   | —                     | **round-trip**                                    |
| `properties`     | —                                                             | —                           | —                              | — (PUML gen doesn't emit yet)       | —                                   | —                     | **round-trip (Structurizr-side)**                 |
| `sourceLocation` | —                                                             | —                           | —                              | —                                   | —                                   | yes (clickable drift) | **diagnostics — parser must populate everywhere** |

## `Relation` field × consumer matrix

| Field            | rules                                        | analyzer         | plantuml gen   | k8s gen                     | sync                      | Status                            |
| ---------------- | -------------------------------------------- | ---------------- | -------------- | --------------------------- | ------------------------- | --------------------------------- |
| `to`             | all                                          | yes              | yes            | yes (`relation.to`)         | yes (NetworkPolicy match) | **core**                          |
| `description`    | —                                            | —                | yes (label)    | —                           | —                         | **round-trip**                    |
| `technology`     | apiGateway, dbPerService (round-trip in fix) | yes (sync/async) | yes            | yes (env value source)      | yes (drift)               | **core**                          |
| `tags`           | — (today)                                    | yes (`async`)    | yes (`$tags=`) | yes (`async` → Kafka topic) | possible                  | **core**                          |
| `sprite`         | —                                            | —                | yes            | —                           | —                         | **round-trip**                    |
| `order`          | —                                            | —                | —              | —                           | —                         | **round-trip (dynamic diagrams)** |
| `link`           | —                                            | —                | yes            | —                           | —                         | **round-trip**                    |
| `properties`     | —                                            | —                | —              | —                           | —                         | **round-trip (Structurizr-side)** |
| `sourceLocation` | —                                            | —                | —              | —                           | yes                       | **diagnostics**                   |

## `Boundary` field × consumer matrix

| Field            | rules                                                                               | analyzer     | plantuml gen               | k8s gen | sync                 | Status                             |
| ---------------- | ----------------------------------------------------------------------------------- | ------------ | -------------------------- | ------- | -------------------- | ---------------------------------- |
| `name`           | cohesion, commonReuse                                                               | yes          | yes                        | —       | possibly (namespace) | **core**                           |
| `label`          | —                                                                                   | yes          | yes                        | —       | —                    | **round-trip**                     |
| `kind`           | —                                                                                   | —            | yes (`boundaryMacroName`)  | —       | —                    | **round-trip**                     |
| `description`    | —                                                                                   | —            | — (PUML 0.4 cannot expose) | —       | —                    | round-trip when parser supports it |
| `tags`           | —                                                                                   | —            | yes (`$tags=`)             | —       | possible             | **round-trip**                     |
| `containerNames` | cohesion, commonReuse, crud-fix, dbPerService-fix (via `buildContainerBoundaryMap`) | yes          | yes (children)             | —       | possible             | **core**                           |
| `boundaryNames`  | cohesion                                                                            | yes (nested) | yes                        | —       | possible             | **core**                           |
| `link`           | —                                                                                   | —            | yes (`$link=`)             | —       | —                    | **round-trip**                     |
| `properties`     | —                                                                                   | —            | —                          | —       | —                    | round-trip (Structurizr-side)      |
| `sourceLocation` | —                                                                                   | —            | —                          | —       | yes                  | **diagnostics**                    |

Plus `Model.rootBoundaryNames` — read by the PlantUML generator for
top-level structure. **core**.

## Findings

### 1. Minimum AST surface is small

`core` columns above cover what every rule, the analyzer, and the
Kubernetes generator depend on. It is a _strict subset_ of the field
list — drop `description`, `label`, `sprite`, `link`, `properties`, `order`,
and the rules and the analyzer still run unchanged. The parser cannot
drop them, because round-trip needs them, but the AST does not need
deep typing for them — they pass through as strings.

### 2. Round-trip surface is shaped by `generate()`, not rules

Eight `Container` / `Relation` / `Boundary` fields are touched only by
`generate()`. They are round-trip baggage: the parser must not drop
them on `load`, the generator emits them on `generate`, no rule reads
them. Round-trip integrity tests (F3 from the May-13 work) already pin
this contract.

### 3. `properties` round-trip is currently a Structurizr-only obligation

`Container.properties` and `Boundary.properties` exist on the Model and
are populated by the Structurizr loader. The PlantUML loader cannot
populate them (parser 0.4 hides `SetPropertyHeader` / `AddProperty`).
**The PlantUML generator does not emit them either** — so PlantUML
round-trip silently drops Structurizr-imported `properties`. The
chevrotain refactor closes the loader half; the generator half is a
separate item that should land in the same Phase 3 PR.

### 4. Structurizr `generate` is missing entirely

`src/formats/structurizr/` has no `generate.ts`. The strategy memo's
Phase-2 round-trip ambition (Structurizr DSL emit including opaque
`LoadResult.raw` re-merge) presupposes a generator that does not exist
yet. Phase 2 acceptance must include that generator, otherwise the
diff-test loop is one-way.

### 5. `sourceLocation` has no consumer yet

No rule, no analyzer, no generator reads `sourceLocation`. It is the
single biggest reason the refactor exists — `aact check` violations
should point to `file.dsl:42:8`. That capability lives downstream of
the parser (CLI formatter, future AST fixers, planned `aact sync` drift
reports). The parser is the upstream supplier. **It must populate
`sourceLocation` on every Container, Boundary, and Relation node,
not just "where possible".**

### 6. `aact sync` adds no new Model fields

Future reconcile (`aact-reconcile-iac.md` memo) reads `name`, `kind`,
`external`, `tags`, `technology`, `relations`, optionally `containerNames`,
plus `sourceLocation` for clickable drift output. Every one of these is
already on the **core** list. The sync feature does not stretch the
parser's contract — only its diagnostics quality.

## Implications for parser / AST design

- AST must let `toModel` populate every **core** and **round-trip** field
  exactly as the current loaders do, with no regressions against the
  F3 round-trip fixtures.
- `sourceLocation` is mandatory at the AST level for every node that
  becomes a Container / Boundary / Relation in the Model — the
  `toModel` step copies it across.
- The AST does not need typed nodes for opaque material (Structurizr
  `views` / `styles`, PUML `skinparam`). Tokenize and skip, or attach
  to a flat opaque container that goes into `LoadResult.raw`.
- Custom-rule consumers do not change the contract — they get the full
  Model, parser obligation does not vary.

## Out of scope (recorded so we don't re-litigate)

- Deployment, ArchiMate, UML — out of the C4 paradigm
  (`project_long_term_vision`, `project_v3_parser_strategy` §9).
- `Container.properties` on the PlantUML side — parser 0.4 hides it; new
  parser can expose it. Generator must emit it. Tracked separately, not
  blocking AST design.
- Structurizr `generate.ts` — required for the Phase 2 diff loop, not
  for Phase 1 inventory.

## Open items for the next phase

1. **AST node shape draft.** With the field matrix locked, draft the
   AST types (`src/formats/structurizr/parser/ast.ts`,
   `src/formats/plantuml/parser/ast.ts`) — every node carries a
   mandatory `range: SourceLocation`. Pending.
2. **Grammar scope tables (`grammar.md` ×2).** In-scope productions
   that map to Model entities, opaque productions that go to `raw`,
   tokenized-and-ignored productions. Pending.
3. **Structurizr generator (`src/formats/structurizr/generate.ts`).**
   Required to make Phase 2's diff loop bidirectional. Schedule
   alongside Phase 2 implementation, not after.
4. **`SourceLocation` shape upgrade.** Today it is `{file, line,
column?, endLine?}`. Memo §3 calls for `{start: {line, col, offset},
end: {line, col, offset}}` — full `Range` for OSC8 and AST fixes.
   Migration is non-breaking (extend, not replace) but should land
   before the new parser starts populating.

## References

- `project_v3_parser_strategy` memo (full plan, 5 calibration decisions)
- `aact-reconcile-iac.md` (`aact sync` design, IaC reconciliation)
- `docs/format-coverage.md` (today's per-format field coverage)
- F3 round-trip tests (`test/formats/plantuml/roundtrip.test.ts`) — the
  binding contract for round-trip fidelity
