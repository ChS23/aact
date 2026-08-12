/**
 * Self-sufficient C4 Model for aact. Covers full PlantUML / Mermaid C4 /
 * Structurizr DSL API surface — round-trip без потерь данных для всех
 * популярных C4-as-code инструментов.
 *
 * Scope (намеренно): Solution Architect — C4 Static (L1/L2/L3) + System
 * Landscape + Dynamic. НЕ покрывается: Deployment view (System Architect /
 * kube-score territory), ArchiMate, UML, BPMN.
 *
 * Performance: Record<string, T> вместо Map<string, T> — на масштабе aact
 * (30-300 elements) V8 inline cache даёт ~1ns lookup, Map ~50ns. Плюс
 * JSON.stringify работает нативно, console.log показывает tree.
 *
 * Naming: `Element` is aact's universal aggregator for any C4 abstraction
 * (Person / Software System / Container / Component). The literal value
 * `kind: "Container"` still refers to the C4 level-2 concept (deployable
 * runtime unit). Using `Element` as the wrapper type avoids the
 * collision that aact's earlier `Container` interface had with the C4
 * `Container` level.
 */

/** C4 element kinds. Полный stdlib набор. */
export type ElementKind =
  | "Person"
  | "System"
  | "Container"
  | "ContainerDb"
  | "ContainerQueue"
  | "Component"
  | "ComponentDb"
  | "ComponentQueue";

/**
 * Boundary types сохраняются для round-trip без шумного diff'а в git.
 * PlantUML stdlib дает `System_Boundary` / `Container_Boundary` /
 * `Enterprise_Boundary` (плюс generic `Boundary(name, label, $type=…)`,
 * где `$type` подставляется в один из них). `aact generate` обязан
 * вернуть тот же ключ.
 *
 * `"Component"` — model-level kind для случая, когда Structurizr или
 * generic `Boundary($type="Component")` помечает scope как
 * component-level. Stdlib не имеет `Component_Boundary` макроса, поэтому
 * `aact generate` для PUML падает обратно в `Container_Boundary` —
 * это документированная потеря fidelity на этой паре направлений.
 */
export type BoundaryKind = "System" | "Container" | "Component" | "Enterprise";

/**
 * A position within a source file. 1-based for `line` and `col` (matches
 * editor conventions and OSC8 terminal-link expectations).
 *
 * `offset` is a 0-based **UTF-16 code unit** index into the source string
 * — the same unit `String.prototype.slice` / `charCodeAt` operate on,
 * which is also what chevrotain emits (`token.startOffset` /
 * `endOffset`) and what LSP uses by default (`positionEncoding:
 * "utf-16"`). It is **not** a UTF-8 byte offset, despite the field name.
 * Non-ASCII content (cyrillic, emoji, CJK) round-trips correctly
 * through `applyEdits` because both producer and consumer use the
 * same unit; consumers that need byte / codepoint offsets must
 * convert themselves.
 *
 * All three are mandatory. If a position is not known, the enclosing
 * `SourceLocation` must be omitted entirely (it is optional on each
 * Model node) — never fabricated with placeholder values.
 */
export interface SourcePosition {
  readonly line: number;
  readonly col: number;
  /** 0-based offset in UTF-16 code units (JS string index). */
  readonly offset: number;
}

/**
 * A range within a source file: `start` and `end` `SourcePosition`s plus
 * the `file` they belong to. `end` is the position **after** the last
 * character of the parsed construct (half-open interval, matching
 * chevrotain and LSP conventions).
 *
 * The chevrotain parser populates this on every Element / Boundary /
 * Relation node it emits. Regex-based loaders may omit it entirely —
 * the field is optional on each Model node. When present, the range
 * must be complete (no partial fills); the new shape exists precisely
 * so that diagnostics, terminal-link OSC8, and AST-based fixes have
 * full information.
 */
export interface SourceLocation {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/**
 * Связь между двумя elements. `to` — имя целевого element (name-ref),
 * не объектная ссылка — это рвёт Element↔Relation цикл, делает Model
 * сериализуемой и упрощает test fixtures (`to: "elementB"` вместо ref'а).
 */
export interface Relation {
  /** Имя целевого element. Lookup через `model.elements[rel.to]` или helper `targetOf(model, rel)`. */
  readonly to: string;
  /** Описание/label. PlantUML `Rel(from, to, label, ...)`, Structurizr `rel.description`. */
  readonly description?: string;
  /** Технология. PlantUML `Rel(..., ?techn, ...)`, Structurizr `rel.technology`. */
  readonly technology?: string;
  /** Tags всегда массив (пустой если нет тегов) — убирает `?.includes()` шум в правилах. */
  readonly tags: readonly string[];
  /** Sprite. PlantUML/Mermaid `Rel(..., ?sprite, ...)`. */
  readonly sprite?: string;
  /** Sequence number для Dynamic diagrams. PlantUML `$index=Index()`, Structurizr dynamic step. */
  readonly order?: number;
  /** $link для clickable diagrams. */
  readonly link?: string;
  /** Structurizr relation properties + perspectives (через `perspective.<name>` prefix). */
  readonly properties?: Readonly<Record<string, string>>;
  /** Foundation для terminal-link OSC8. Заполняется loader'ом где возможно. */
  readonly sourceLocation?: SourceLocation;
}

/**
 * A C4 element: Person, Software System, Container, or Component. `kind` —
 * typed union, не stringly. `external` — orthogonal flag (не отдельный
 * `System_Ext` kind), покрывает все 8 `_Ext` вариантов PlantUML/Mermaid
 * одним полем.
 *
 * The interface name `Element` is aact's universal aggregator for any C4
 * abstraction. `kind: "Container"` still refers to the C4 level-2 concept
 * (deployable runtime unit) — keeping these vocabularies separate at the
 * interface and literal levels avoids the collision aact's earlier
 * `Container` interface had with C4's `Container` level.
 */
export interface Element {
  /** Уникальное имя — ключ в `model.elements`. PlantUML alias / Structurizr `structurizr.dsl.identifier`. */
  readonly name: string;
  /** Human-readable label. PlantUML `Container(alias, label, ...)`. */
  readonly label: string;
  /** Типизированный C4 kind. Compile-error на typo. */
  readonly kind: ElementKind;
  /** Внешний element (System_Ext, Container_Ext etc.). Orthogonal к kind. */
  readonly external: boolean;
  readonly description: string;
  /** C4 technology — Structurizr `cont.technology`, PlantUML `Container(alias, label, ?techn, ...)`. */
  readonly technology?: string;
  /** Tags всегда массив, не optional — убирает `?.includes()` в правилах. */
  readonly tags: readonly string[];
  /** PlantUML/Mermaid `?sprite` — отдельно от tags (раньше попадал в tags). */
  readonly sprite?: string;
  /** Исходящие relations. Целевые elements — name-refs (`relation.to`). */
  readonly relations: readonly Relation[];
  /** $link для clickable diagrams. */
  readonly link?: string;
  /** Structurizr arbitrary properties (включая archetype name + perspectives через `perspective.<name>` prefix). */
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

/**
 * Структурная граница. `elementNames` и `boundaryNames` — name-refs, не
 * object-refs (как в `Relation.to`) — делает Model сериализуемой и упрощает
 * test fixtures.
 */
export interface Boundary {
  readonly name: string;
  readonly label: string;
  readonly kind: BoundaryKind;
  /** PlantUML Boundary `?descr`, Structurizr softwareSystem.description. */
  readonly description?: string;
  readonly tags: readonly string[];
  /** Имена elements внутри этой границы. Lookup через `model.elements[name]`. */
  readonly elementNames: readonly string[];
  /** Имена вложенных boundaries. Lookup через `model.boundaries[name]`. */
  readonly boundaryNames: readonly string[];
  readonly link?: string;
  /** Structurizr softwareSystem properties (archetypes etc.). */
  readonly properties?: Readonly<Record<string, string>>;
  readonly sourceLocation?: SourceLocation;
}

/**
 * Корневая Model. Record-based для O(1) lookup'ов на масштабе aact и native
 * JSON-сериализации. Все поля readonly — после loader-фазы модель immutable.
 */
export interface Model {
  readonly elements: Readonly<Record<string, Element>>;
  readonly boundaries: Readonly<Record<string, Boundary>>;
  /** Корневые boundaries — top-level в рендере. Все остальные boundary вложены через `boundaryNames`. */
  readonly rootBoundaryNames: readonly string[];
  /**
   * Workspace-level metadata: name, description, extends target. Optional —
   * formats that don't carry workspace headers (e.g. PUML) leave it
   * undefined; Structurizr DSL / JSON populate it from `workspace
   * "name" "description" extends "..."` headers. Reference parsers
   * expose this via `Workspace.getName()` / `getExtends()` etc.
   *
   * Workspace `properties { … }` blocks and `version` fields are
   * intentionally NOT surfaced here — they're Structurizr-specific
   * authoring concerns (style overrides, layout hints) that don't
   * affect linting. If a future rule needs them, extend the type.
   */
  readonly workspace?: WorkspaceMetadata;
}

export interface WorkspaceMetadata {
  readonly name?: string;
  readonly description?: string;
  readonly extendsTarget?: string;
}
