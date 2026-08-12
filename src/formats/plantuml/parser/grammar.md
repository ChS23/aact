# C4-PlantUML — target grammar for the aact chevrotain parser

This document defines the C4-PlantUML grammar fragments our parser will
accept. Signatures are **quoted verbatim** from the reference macro
library (`.parser-refs/C4-PlantUML/`) so the contract is anchored to
the canonical implementation rather than memory or `plantuml-parser`
0.4 quirks.

The C4-PlantUML "language" is PlantUML host + a macro library defining
C4 element / relationship / boundary macros. Our parser recognises:

- The C4 macro calls (in scope, mapped to `Model`).
- A subset of PlantUML host syntax needed to delimit the input
  (`@startuml`, `@enduml`, comments, `!include`, block braces).
- Everything else (PlantUML native UML, skinparam, sprite definitions,
  layout directives, themes) is tokenize-ignore at lex.

The host PlantUML is intentionally **not** parsed in full — that is
the job of PlantUML itself, not of an architecture linter.

References used while authoring:

- `C4_Container.puml` / `C4_Component.puml` / `C4_Context.puml`
  — element macro signatures
- `C4.puml` — shared macros (`Boundary`, `BiRel*`, `Lay_*`)
- `C4_Dynamic.puml` — relationship variants (`Rel`, `Rel_*`,
  `RelIndex*`)
- `C4_Deployment.puml` — out-of-scope macros (catalogued for skip)
- `samples/` — real-world C4 diagrams (correct macro usage)

## Scope policy

Identical categories to Structurizr. See
`docs/v3-parser-phase-0-inventory.md`.

| Category                   | Goes to                                                    | Examples                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In scope**               | `Model` via AST → toModel                                  | C4 element macros (Container / Component / System / Person / their `_Ext` and `_Db` / `_Queue` variants), boundary macros, `Rel*`, `BiRel*`, `RelIndex*`, `!include`, `@startuml` / `@enduml`                                                                                                               |
| **Opaque**                 | `LoadResult.raw` verbatim                                  | `LAYOUT_*`, `HIDE_STEREOTYPE()`, `SHOW_LEGEND` / `SHOW_FLOATING_LEGEND` / `SHOW_DYNAMIC_LEGEND` / `SHOW_ELEMENT_TYPE`, themes, sprite definitions, custom tag definitions (`AddElementTag`, `AddRelTag`, `UpdateElementStyle`, `UpdateRelStyle`, `SetPropertyHeader` / `AddProperty` — once we expose them) |
| **Parsed-then-info-issue** | parsed for syntactic correctness, never reach Model or raw | `C4_Deployment` family (`Deployment_Node`, `Node`, etc.) — outside C4 paradigm per `project_long_term_vision`.                                                                                                                                                                                              |
| **Tokenize-ignore**        | lexer consumes, no warning                                 | PlantUML native syntax (`class`, `participant`, `note`, `skinparam`, `title`, `header`, `footer`, etc.), `Lay_*` layout hints                                                                                                                                                                               |

## 1. In-scope productions

### Lexical primitives

| Construct              | Form                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagram delimiter      | `@startuml [<id>\|"<string>"\|<path>]` … `@enduml`    | The diagram name is optional and may be a bare identifier, quoted string, or path. Real samples use all three forms (`samples/C4_Container Diagram Sample - techtribesjs.puml:1` uses a quoted name). A `.puml` file may contain multiple diagrams; we accept the first and emit an info-issue for subsequent ones (multi-diagram support is out of scope for aact). |
| String literal         | `"..."`                                               | Quoted argument value to a macro.                                                                                                                                                                                                                                                                                                                                    |
| Bare token             | identifier-like `[A-Za-z_][A-Za-z0-9_]*`              | Used as positional macro argument when unquoted.                                                                                                                                                                                                                                                                                                                     |
| Function-call argument | `MacroName(...)` or `FuncName()` as an argument value | C4-PUML stdlib uses inline function calls as argument values: e.g. `Rel(A, B, "x", $index=Index())` (`Index()` at `C4.puml:1723`), or `AddElementTag(..., $shape=RoundedBoxShape())` (`AddElementTag` at `C4.puml:1005`, `RoundedBoxShape()` at `C4.puml:980`). The parser MUST accept function-call expressions as argument values, not just literals.              |
| Named arg              | `$name=value`                                         | C4-PUML named-argument syntax. Known names that the stdlib uses on `Rel*`: `$tags`, `$sprite`, `$link`, `$index`. The parser also accepts **arbitrary unknown named args** and routes them to a verbatim-bag on the AST node — future stdlib extensions (e.g. `C4_Sequence.puml`'s `$rel`) must not crash existing files.                                            |
| Macro call             | `MacroName(arg, arg, ..., $named=value)`              | Comma-separated argument list.                                                                                                                                                                                                                                                                                                                                       |
| Single-line comment    | `' ...`                                               | PlantUML host syntax. Lex consumes; parser skips.                                                                                                                                                                                                                                                                                                                    |
| Block comment          | `/' ... '/`                                           | PlantUML host syntax. Lex consumes; parser skips.                                                                                                                                                                                                                                                                                                                    |
| Block braces           | `{` opens, `}` closes                                 | Used by boundary macros to nest children.                                                                                                                                                                                                                                                                                                                            |
| Preprocessor           | `!include <url\|path>`                                | Inlines another `.puml` file. `!includeurl` is a legacy alias.                                                                                                                                                                                                                                                                                                       |

### Element macros

All element macros use **named-argument defaults**. The C4-PlantUML
reference uses `!unquoted procedure` declarations with `$param=""`
default values — meaning the argument is optional and falls through if
empty. Our parser captures every positional and named argument
verbatim; `toModel` resolves defaults.

#### Context level — Person / System (`C4_Context.puml`)

| Macro signature (quoted verbatim)                                                                         |
| --------------------------------------------------------------------------------------------------------- |
| `Person($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="")`                             |
| `Person_Ext($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="")`                         |
| `System($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="", $baseShape="rectangle")`     |
| `SystemDb($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="")`                           |
| `SystemQueue($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="")`                        |
| `System_Ext($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="", $baseShape="rectangle")` |
| `SystemDb_Ext($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="")`                       |
| `SystemQueue_Ext($alias, $label, $descr="", $sprite="", $tags="", $link="", $type="")`                    |

**Important — `$type` is NOT visual-only on Context elements.** For
Person / System / SystemDb / SystemQueue and their `_Ext` variants,
`$type` slots the architectural **technology** string (rendered as the
stereotype `<<...>>` over the element, equivalent to `$techn` on
Container / Component). The macro body passes `$type` directly to
`$getElementBase(..., $type, ...)` which produces the `//$type//`
rendering — that is the same place `$techn` lands on Container elements.

Therefore in `toModel`:

- Container / Component elements → `Container.technology = $techn`
- Context elements (Person / System / _\_Db / _\_Queue / \*\_Ext) →
  `Container.technology = $type`

`$baseShape` IS visual-only (the underlying PlantUML shape used for
rendering). Opaque for Model.

Note: Context-level elements do **not** have a `$techn` slot — `$type`
fills that role. Container / Component have `$techn` and **no** `$type`.

#### Container level (`C4_Container.puml`)

| Macro signature (quoted verbatim)                                                                             |
| ------------------------------------------------------------------------------------------------------------- |
| `Container($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="", $baseShape="rectangle")`     |
| `ContainerDb($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                           |
| `ContainerQueue($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                        |
| `Container_Ext($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="", $baseShape="rectangle")` |
| `ContainerDb_Ext($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                       |
| `ContainerQueue_Ext($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                    |

#### Component level (`C4_Component.puml`) — identical shape to Container

| Macro signature (quoted verbatim)                                                                             |
| ------------------------------------------------------------------------------------------------------------- |
| `Component($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="", $baseShape="rectangle")`     |
| `ComponentDb($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                           |
| `ComponentQueue($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                        |
| `Component_Ext($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="", $baseShape="rectangle")` |
| `ComponentDb_Ext($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                       |
| `ComponentQueue_Ext($alias, $label, $techn="", $descr="", $sprite="", $tags="", $link="")`                    |

### Boundary macros

Boundaries open a `{ ... }` block; the body holds nested elements and
nested boundaries.

| Macro signature (quoted verbatim)                                      | Notes                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Enterprise_Boundary($alias, $label, $tags="", $link="", $descr = "")` | `C4_Context.puml:436`                                                                                                                                                                                                      |
| `System_Boundary($alias, $label, $tags="", $link="", $descr = "")`     | `C4_Context.puml:446`                                                                                                                                                                                                      |
| `Container_Boundary($alias, $label, $tags="", $link="", $descr = "")`  | `C4_Container.puml:103`                                                                                                                                                                                                    |
| `Boundary($alias, $label, $type="", $tags="", $link="", $descr = "")`  | `C4.puml:1686`. Generic boundary; `$type` is BOTH the architectural kind string AND a styling lookup key. `toModel` reads `$type` to populate `Boundary.kind` (mapping "Enterprise" / "System" / "Container" / arbitrary). |

**No `Component_Boundary` macro.** The C4-PlantUML stdlib does not
define one — verified against the upstream `C4_Component.puml`
(declares only `Component*` element macros, not boundary) and the
README ("the available boundary macros are Boundary, Enterprise_Boundary,
System_Boundary, Container_Boundary"). c4model.com also has no concept
of a component boundary. To group related Components inside a Container,
use `Container_Boundary` — the canonical pattern.

Argument order differs from element macros — `$tags` and `$link` come
**before** `$descr`. Default-value spacing in the stdlib uses `$descr = ""`
(spaces around `=`) for boundaries, unlike `$techn=""` (no spaces) on
elements. Reproduced literally above; semantically irrelevant to the
parser but pinned for position-exact traceability.

### Relationships

The `Rel` family is large but not entirely symmetric. Variants are
defined in two places:

- **Base signature** (`C4.puml:1803`): `Rel($from, $to, $label, $techn="", $descr="", $sprite="", $tags="", $link="")` — **no `$index`**.
- **Dynamic-view override** (`C4_Dynamic.puml:39`): re-declares the same
  signature WITH `$index=""` appended. This override is active only
  when `C4_Dynamic.puml` is included alongside the element macros.

Therefore the parser MUST accept `$index=` as a named argument always
(forward-compatible regardless of which library files the user
included), even though the base C4 macros do not declare it.

| Macro family                                                                                                                                                                                          | Signature                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Rel`, `Rel_D`, `Rel_Down`, `Rel_U`, `Rel_Up`, `Rel_L`, `Rel_Left`, `Rel_R`, `Rel_Right`, `Rel_Back`, `Rel_Back_Neighbor`, `Rel_Neighbor`                                                             | `Rel($from, $to, $label, $techn="", $descr="", $sprite="", $tags="", $link="", [$index=""])` — `$index` slot present only when `C4_Dynamic.puml` is included.                                                                                           |
| `RelIndex`, `RelIndex_Back`, `RelIndex_D`, `RelIndex_Down`, `RelIndex_U`, `RelIndex_Up`, `RelIndex_L`, `RelIndex_Left`, `RelIndex_R`, `RelIndex_Right`, `RelIndex_Neighbor`, `RelIndex_Back_Neighbor` | `RelIndex($e_index, $from, $to, $label, $techn="", $descr="", $sprite="", $tags="", $link="")` — `$e_index` is **mandatory positional** (first arg), not a named default. The `Rel*` family's `$index` is **named-only**. They are not interchangeable. |

Bidirectional variants (`C4.puml:1807-1881`) — NOTE asymmetry with the
`Rel` family: there is NO `BiRel_Back`, NO `BiRel_Back_Neighbor`, and
NO `BiRelIndex` family. BiRel has only the listed 10 variants.

| Macro family                                                                                                                 | Signature                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `BiRel`, `BiRel_Neighbor`, `BiRel_D`, `BiRel_Down`, `BiRel_U`, `BiRel_Up`, `BiRel_L`, `BiRel_Left`, `BiRel_R`, `BiRel_Right` | `BiRel($from, $to, $label, $techn="", $descr="", $sprite="", $tags="", $link="")` |

Direction suffixes (`_D` / `_Down`, `_U` / `_Up`, `_L` / `_Left`,
`_R` / `_Right`, `_Back`, `_Neighbor`) and the `BiRel` prefix are
**layout hints**. The AST captures the direction; `toModel` maps it:

- Plain / directional / `_Neighbor` → one `Relation` entry on the
  source's `relations[]`.
- `_Back` → swap source/destination semantically, then one `Relation`.
- `BiRel*` → two `Relation` entries (one per direction).
- `RelIndex*` → as above, plus `Relation.order = $e_index`.

The C4-PUML `$index=` named argument on plain `Rel` is the modern way
to specify dynamic-view step order (older diagrams use `RelIndex*`);
both populate `Relation.order`. Tracked separately in our adapter
layer (see `plantuml-parser` 0.4 work — closed in v3.0.0-beta.4).

### Layout hints (in-scope for tokenize, out-of-scope for Model)

| Macro                                                                             | Signature                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Lay_D`, `Lay_Down`, `Lay_U`, `Lay_Up`, `Lay_L`, `Lay_Left`, `Lay_R`, `Lay_Right` | `Lay_*($from, $to)` — exactly two args, no defaults (`C4.puml:1922-1946`).                                   |
| `Lay_Distance`                                                                    | `Lay_Distance($from, $to, $distance="0")` (`C4.puml:1953`) — only `Lay_*` macro that takes a third argument. |

Lex recognises; parser passes them through as opaque AST nodes;
`toModel` does not emit them as relations. They are graphical hints,
not architectural relations.

### Preprocessor

| Construct                                                                                                          | Notes                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!include "path"` / `!include <url>`                                                                               | Inlines another `.puml` file. Path resolution: relative to the including file. URLs (e.g. C4-PlantUML library URL) are recognised but **not fetched** — we treat them as marker tokens declaring the dialect, equivalent to "this is C4-PlantUML". |
| `!includeurl <url>`                                                                                                | Legacy alias of `!include` for URL arguments. Modern stdlib and samples use `!include` directly; `!includeurl` is accepted for compatibility but never appears in upstream C4-PlantUML.                                                            |
| `!define`, `!procedure`, `!function`, `!unquoted procedure`, `!unquoted function`, `!endprocedure`, `!endfunction` | Macro definitions inside the input file. Tokenize-ignore — we do not interpret user-defined macros. If a user defines a macro that wraps a C4 element, the AST does not see it. Users should call C4-PUML stdlib macros directly.                  |
| `!if`, `!else`, `!elseif`, `!endif`, `!ifndef`, `!variable_exists`, `!return`, `!global`                           | PlantUML host preprocessor directives. **C4-PlantUML stdlib itself uses these** (e.g. `C4_Dynamic.puml:2`), so a parser that does not tokenize-ignore them will choke on includes of the stdlib. Skip at lex; do not interpret.                    |

## 2. Opaque productions (round-trip via `LoadResult.raw`)

The macros below are part of C4-PlantUML stdlib but carry no
architectural information that rules consume. The parser recognises
them, captures their argument lists, and passes them as opaque nodes
to `LoadResult.raw` for round-trip.

| Macro                                                                                                                                                                                                                                                                             | Notes                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LAYOUT_TOP_DOWN()`, `LAYOUT_LEFT_RIGHT()`, `LAYOUT_LANDSCAPE()`, `LAYOUT_WITH_LEGEND()`, `LAYOUT_AS_SKETCH()`                                                                                                                                                                    | Layout directives (`C4_Container.puml:60`, `C4_Component.puml:65`, `C4_Context.puml:298`, etc.).                                                                                                                             |
| `SHOW_LEGEND($hideStereotype="true", $details=Small())`, `SHOW_FLOATING_LEGEND($alias=LEGEND(), $hideStereotype="true", $details=Small())`, `SHOW_DYNAMIC_LEGEND($alias=LEGEND(), ...)`, `SHOW_ELEMENT_TYPE`, `SHOW_PERSON_SPRITE`, `SHOW_PERSON_PORTRAIT`, `SHOW_PERSON_OUTLINE` | Legend / element-type visibility toggles (`C4.puml:1576-1603`, `C4_Context.puml:335-355`). `Small()` / `LEGEND()` defaults are function calls — see "Function-call argument" lex rule.                                       |
| `HIDE_STEREOTYPE()`                                                                                                                                                                                                                                                               | Visibility toggle (`C4.puml:1436`). No `SHOW_STEREOTYPE_*` family exists — verified absent from stdlib.                                                                                                                      |
| `SetPropertyHeader($col1Name, $col2Name="", $col3Name="", $col4Name="")`                                                                                                                                                                                                          | Column-header declaration for an Element's property table (`C4.puml:1315`).                                                                                                                                                  |
| `AddProperty($col1, $col2="", $col3="", $col4="")`                                                                                                                                                                                                                                | Adds a property row to the next Element (`C4.puml:1350`, declared as `!unquoted function`). Up to four columns matching the count declared by `SetPropertyHeader`. Eventual destination is `Model.containers[*].properties`. |
| `WithoutPropertyHeader()`                                                                                                                                                                                                                                                         | Suppress property header (`C4.puml:1339`).                                                                                                                                                                                   |
| `SET_SKETCH_STYLE`                                                                                                                                                                                                                                                                | Sketch-mode toggle (`C4.puml:1440`).                                                                                                                                                                                         |
| `SetDefaultLegendEntries`, `UpdateLegendTitle`                                                                                                                                                                                                                                    | Legend customisation (`C4.puml:1125, 1130`).                                                                                                                                                                                 |
| `AddElementTag`, `AddRelTag`, `AddBoundaryTag`, `AddNodeTag`, `AddPersonTag`, `AddSystemTag`, `AddContainerTag`, `AddComponentTag`, `AddExternalContainerTag`, `AddExternalComponentTag`, `AddExternalPersonTag`, `AddExternalSystemTag`                                          | Custom tag-style declarations (`C4.puml:1646`, `C4_Container.puml:44, 47`, etc.).                                                                                                                                            |
| `UpdateElementStyle`, `UpdateRelStyle`, `UpdateBoundaryStyle`, `UpdateContainerBoundaryStyle`, `UpdateEnterpriseBoundaryStyle`, `UpdateSystemBoundaryStyle`                                                                                                                       | Style overrides (`C4_Container.puml:51`, `C4_Context.puml:79, 82`).                                                                                                                                                          |
| `skinparam <name> <value>`                                                                                                                                                                                                                                                        | PlantUML host skinparam — not part of C4-PUML but commonly mixed in.                                                                                                                                                         |
| `title`, `caption`, `header`, `footer`                                                                                                                                                                                                                                            | PlantUML diagram chrome.                                                                                                                                                                                                     |

Earlier drafts of this doc listed `WithLegend`, `ShowPropertyHeader`,
and a `SHOW_STEREOTYPE_*` family. **None of these exist in the upstream
stdlib** — they were transcription errors. The real macros are
`LAYOUT_WITH_LEGEND` / `SHOW_LEGEND`, `SetPropertyHeader`, and
`HIDE_STEREOTYPE` respectively.

## 3. Parsed-then-info-issue

`C4_Deployment` macros — recognised so a legal C4-PUML file does not
crash, but emit `ModelIssue` severity=info ("deployment view is
outside aact's C4 scope; ignored").

| Macro                                         | Notes                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Deployment_Node`, `Node`, `Node_L`, `Node_R` | Deployment-tier element.                                                              |
| `Deployment_Node_L`, `Deployment_Node_R`      | Direction-tagged variants.                                                            |
| `Container_Boundary` within a deployment node | Same shape as in container view; only the surrounding context flags it as deployment. |

## 4. Tokenize-ignore (no info issue, no warning)

Native PlantUML syntax that aact never inspects:

- `class`, `interface`, `abstract`, `enum`, `namespace`, `package`,
  `node`, `cloud`, `database`, `frame`, `folder`, `rectangle`,
  `usecase`, `state`, `digraph` and other UML/diagram tokens.
- `note left/right/over of ...` and other note syntax.
- `participant`, `actor`, `boundary` (sequence-diagram), `control`,
  `database`, `collections`, `queue`, `entity` (when not in a C4
  context).
- `<<stereotype>>` markers used inline.
- `together { ... }` grouping.

These are recognised at the lexer level as untyped opaque token
streams up to the next `@enduml` or end of an enclosing block. Their
content is not preserved in `LoadResult.raw` either — they are
PlantUML's domain, not aact's.

## 5. Error recovery

Same approach as the Structurizr parser:

1. Synchronisation tokens at element-macro / boundary / `@startuml`
   boundaries.
2. On parse error: record `ModelIssue` with full range, skip to the
   next sync token, continue.
3. AST nodes whose body contained errors carry `recovered: true`;
   `toModel` skips recovered nodes when building Model.

## 6. Multi-diagram files

A `.puml` file may contain multiple `@startuml ... @enduml` blocks.
Out of scope for aact: we parse the first block and emit an info-issue
for the rest ("multiple diagrams found; using the first").

## 7. Secondary oracles

| Oracle                                     | Use                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PlantUML CLI** (`brew install plantuml`) | Runs the actual PlantUML host. Useful to confirm a given input is a syntactically valid PlantUML file — independent of whether it is _also_ a valid C4 file. We do not currently wire this into the test loop, but it is available for ad-hoc disagreement triage. |
| `.parser-refs/C4-PlantUML/samples/`        | Real-world canonical C4-PUML files (Big Bank plc, message bus, techtribesjs, etc.). The test corpus mines `input → expected Model` pairs from these — but always re-expressed in our fixture style, never copied character-for-character.                          |

## 8. Non-goals

- Full PlantUML syntax fidelity. We do not own the PlantUML grammar;
  we own the C4 macro layer on top.
- User-defined macros that wrap C4 macros. If `MyContainer(name)` is a
  user macro that expands to `Container(name, "...", "...")`, our
  parser sees `MyContainer(...)` and treats it as an unknown call.
  Users should call C4-PUML macros directly.
- Mermaid C4 — separate format, separate phase.
- Sequence-flavour diagrams (`C4_Sequence.puml`, `participant`,
  `actor`, `activate`, `deactivate`). Out of static + dynamic scope;
  files containing them surface parse errors rather than crash.
- PlantUML preprocessor variable references in arg values (e.g.
  `$index-1`, `increment()`, user-defined functions). The
  `samples/C4_Dynamic ... - old format.puml` fixture relies on these
  for step ordering; the modern equivalent uses `$index=Index()` and
  works fine.

### 8.1 PUML preprocessor arithmetic in arg values — stripped

The C4-PUML stdlib lets `$index=Index()-1` evaluate at render time as
`Index() - 1`. Our grammar does not model arithmetic, so a pre-lex
pass strips the `[op N]` tail after any function-call's closing `)`
(length preserved — UTF-16 code units). The strip is safe: `Index()` already
collapses to `Relation.order = undefined` in `toModel`, so the
architectural meaning ("auto-numbering offset, no fixed order") is
preserved verbatim. Pattern: `\)\s*[+\-*/]\s*\d+` → `)            `.

This closes the `samples/C4_Dynamic ... - message bus.puml` fixture
which uses `$index=Index()-1`, `LastIndex()-2`, and `SetIndex(5)-2`.

## 9. Authority precedence

1. C4-PlantUML stdlib (`.parser-refs/C4-PlantUML/`) — the canonical
   signatures.
2. This document — derived from those signatures.
3. AST and tests — derived from this document.

When (1) and this document disagree, update this document and the AST
to match (1).
