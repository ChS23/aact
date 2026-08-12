/**
 * C4-PlantUML AST → `Model` lowerer.
 *
 * Walks the typed `FileNode` produced by `visitor.ts` and emits a
 * fully-populated `Model` (containers, boundaries, root boundary
 * names) plus a list of `ModelIssue`s. Anchors every Model node to a
 * `SourceLocation` carried from the AST `range` field, so downstream
 * diagnostics, terminal OSC8 links, and AST-based fixes resolve to
 * the user's original `.puml` bytes.
 *
 * Responsibilities (mapped from grammar.md §1.x):
 *
 *   - Element macros → `Container`. Disambiguates Context family
 *     (`Person`/`System`/…) from Container/Component family by
 *     positional layout — Context macros lack a `$techn` slot;
 *     `$type` on Context carries technology instead.
 *   - Boundary macros → `Boundary`, with `kind` decoded from the
 *     macro name (or `$type` for generic `Boundary`). Children are
 *     collected from the nested statement list.
 *   - Relation macros → `Relation` entries pushed onto the source
 *     container's `relations[]`. Handles:
 *       * `Rel_Back*` swap (semantically `Rel(to, from)`)
 *       * `BiRel*` expansion to TWO Relation entries (one per
 *         direction)
 *       * `RelIndex*` first positional → `Relation.order`
 *       * `$index=` named arg on plain `Rel` → `Relation.order`
 *       * `$tags` / `$link` / `$sprite` named args
 *   - Layout macros → ignored (no Model effect; AST captures them
 *     only for round-trip via `LoadResult.raw` once we expose that).
 *   - Multiple diagrams → only the first reaches us (preParse stripped
 *     the rest and emitted an info-issue).
 *
 * Out of scope here (handled elsewhere or deliberately not modelled):
 *   - `LAYOUT_*`/`HIDE_*`/`SHOW_*` and other opaque macros —
 *     pre-stripped before lex.
 *   - `Deployment_Node`/`Node` blocks — pre-stripped with info-issue.
 *   - `!include`/`!define`/…  preprocessor — pre-stripped before lex.
 *   - PlantUML native syntax — pre-stripped before lex.
 */

import type {
  Boundary,
  BoundaryKind,
  Element,
  ElementKind,
  ModelIssue,
  Relation,
  SourceLocation,
} from "../../../model";
import { buildModel } from "../../../model";
import { parseBoundaryMacro, parseC4MacroKind } from "../../_shared/c4Mapping";
import { parseCsvTags } from "../../_shared/tags";
import type { LoadResult } from "../../types";
import type {
  ArgumentValue,
  BoundaryMacro,
  DiagramStatement,
  ElementMacro,
  FileNode,
  NamedArg,
  RelationMacro,
} from "./ast";
import type { SimpleConstants } from "./preParse";

// ── Argument-extraction helpers ─────────────────────────────────────

/**
 * String view of an argument value. StringLiteral → unescaped value;
 * bare identifier → identifier text; FunctionCallValue → undefined
 * (toModel handles function calls case-by-case where they carry
 * Model semantics, e.g. `Index()`).
 */
const argString = (
  value: ArgumentValue | undefined,
  constants?: SimpleConstants,
): string | undefined => {
  if (!value) return undefined;
  if (value.kind === "string") return value.value;
  if (value.kind === "bareToken") {
    return constants?.get(value.value) ?? value.value;
  }
  return undefined;
};

/** Find a named arg by name; returns its value or undefined. */
const namedValue = (
  args: readonly NamedArg[],
  name: string,
): ArgumentValue | undefined => args.find((a) => a.name === name)?.value;

/** First defined string among the candidates. */
const coalesceString = (
  constants: SimpleConstants | undefined,
  ...candidates: (ArgumentValue | string | undefined)[]
): string | undefined => {
  for (const c of candidates) {
    if (c === undefined) continue;
    if (typeof c === "string") return c;
    const s = argString(c, constants);
    if (s !== undefined) return s;
  }
  return undefined;
};

/**
 * `$index=` value coercion. Accepts `$index=3` (bare), `$index="3"`
 * (quoted), or `$index=Index()` (sentinel call meaning "use diagram-
 * level auto-increment"). Returns `undefined` for non-numeric or
 * `Index()` — `Index()` is a presentation-only auto-numbering hint
 * and carries no architectural meaning we can persist in the Model.
 *
 * Reference: `C4_Dynamic.puml:39-72` re-declares `Rel` to add
 * `$index=""`; `Index()` is a helper that returns an incrementing
 * counter at PUML render time.
 */
const coerceOrder = (
  value: ArgumentValue | undefined,
  constants?: SimpleConstants,
): number | undefined => {
  if (!value) return undefined;
  if (value.kind === "functionCallValue") return undefined; // `Index()`
  const s = argString(value, constants);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// ── Element family layout ──────────────────────────────────────────

const CONTEXT_FAMILY: ReadonlySet<string> = new Set([
  "Person",
  "Person_Ext",
  "System",
  "SystemDb",
  "SystemQueue",
  "System_Ext",
  "SystemDb_Ext",
  "SystemQueue_Ext",
]);

interface ElementSlots {
  /** technology lives here on this family. */
  readonly techIndex: number;
  readonly descrIndex: number;
  readonly spriteIndex: number;
  readonly tagsIndex: number;
  readonly linkIndex: number;
  /** Which named-arg key carries technology — `techn` (Container/
   *  Component family) or `type` (Context family). */
  readonly techNamedKey: "techn" | "type";
}

/**
 * Positional layout per element family. Indices match the stdlib
 * macro signatures verbatim:
 *
 *   Context     : (alias, label, descr, sprite, tags, link, type, baseShape)
 *                                  2       3      4     5     6
 *   Container   : (alias, label, techn, descr, sprite, tags, link, baseShape)
 *                                  2     3       4      5     6
 */
const slotsFor = (macroName: string): ElementSlots => {
  if (CONTEXT_FAMILY.has(macroName)) {
    return {
      techIndex: 6,
      descrIndex: 2,
      spriteIndex: 3,
      tagsIndex: 4,
      linkIndex: 5,
      techNamedKey: "type",
    };
  }
  return {
    techIndex: 2,
    descrIndex: 3,
    spriteIndex: 4,
    tagsIndex: 5,
    linkIndex: 6,
    techNamedKey: "techn",
  };
};

// ── Builders ────────────────────────────────────────────────────────

const buildElement = (
  macro: ElementMacro,
  constants?: SimpleConstants,
): { element: Element; kind: ElementKind } | undefined => {
  const kindInfo = parseC4MacroKind(macro.macroName);
  if (!kindInfo) return undefined;
  const slots = slotsFor(macro.macroName);

  const alias = argString(macro.positionals[0], constants);
  const label = argString(macro.positionals[1], constants) ?? "";
  if (!alias) return undefined; // malformed — visitor's `recovered` would catch this

  const technology = coalesceString(
    constants,
    namedValue(macro.namedArgs, slots.techNamedKey),
    macro.positionals[slots.techIndex],
  );
  const description =
    coalesceString(
      constants,
      namedValue(macro.namedArgs, "descr"),
      macro.positionals[slots.descrIndex],
    ) ?? "";
  const sprite = coalesceString(
    constants,
    namedValue(macro.namedArgs, "sprite"),
    macro.positionals[slots.spriteIndex],
  );
  const tagsRaw = coalesceString(
    constants,
    namedValue(macro.namedArgs, "tags"),
    macro.positionals[slots.tagsIndex],
  );
  const link = coalesceString(
    constants,
    namedValue(macro.namedArgs, "link"),
    macro.positionals[slots.linkIndex],
  );

  const element: Element = {
    name: alias,
    label,
    kind: kindInfo.kind,
    external: kindInfo.external,
    description,
    technology,
    tags: parseCsvTags(tagsRaw),
    sprite,
    relations: [],
    link,
    properties: systemShapeProperties(macro.macroName),
    sourceLocation: macro.range,
  };
  return { element, kind: kindInfo.kind };
};

const systemShapeProperties = (
  macroName: string,
): Readonly<Record<string, string>> | undefined => {
  if (
    macroName === "SystemDb" ||
    macroName === "SystemDb_Ext" ||
    macroName === "SystemQueue" ||
    macroName === "SystemQueue_Ext"
  ) {
    return { "plantuml.macro": macroName };
  }
  return undefined;
};

interface BoundaryBuildResult {
  readonly boundary: Boundary;
  readonly elementNames: readonly string[];
  readonly childBoundaryNames: readonly string[];
}

const buildBoundary = (
  macro: BoundaryMacro,
  childContainerNames: readonly string[],
  childBoundaryNames: readonly string[],
  constants?: SimpleConstants,
): BoundaryBuildResult | undefined => {
  const alias = argString(macro.positionals[0], constants);
  const label = argString(macro.positionals[1], constants) ?? "";
  if (!alias) return undefined;

  // Generic `Boundary` has an extra `$type` slot at index 2 before
  // tags/link/descr; named boundaries push everything one slot left.
  const isGeneric = macro.macroName === "Boundary";
  const typeIdx = isGeneric ? 2 : -1;
  const tagsIdx = isGeneric ? 3 : 2;
  const linkIdx = isGeneric ? 4 : 3;
  const descrIdx = isGeneric ? 5 : 4;

  // Decode boundary kind. For generic `Boundary` the `$type` arg
  // controls it: "Enterprise"/"System"/"Container"/anything-else.
  let kind: BoundaryKind = parseBoundaryMacro(macro.macroName);
  if (isGeneric) {
    const typeStr =
      coalesceString(
        constants,
        namedValue(macro.namedArgs, "type"),
        typeIdx >= 0 ? macro.positionals[typeIdx] : undefined,
      ) ?? "";
    switch (typeStr) {
      case "Enterprise": {
        kind = "Enterprise";
        break;
      }
      case "Container": {
        kind = "Container";
        break;
      }
      case "Component": {
        kind = "Component";
        break;
      }
      default: {
        kind = "System";
      }
    }
  }

  const tagsRaw = coalesceString(
    constants,
    namedValue(macro.namedArgs, "tags"),
    macro.positionals[tagsIdx],
  );
  const link = coalesceString(
    constants,
    namedValue(macro.namedArgs, "link"),
    macro.positionals[linkIdx],
  );
  const description = coalesceString(
    constants,
    namedValue(macro.namedArgs, "descr"),
    macro.positionals[descrIdx],
  );

  const boundary: Boundary = {
    name: alias,
    label,
    kind,
    description,
    tags: parseCsvTags(tagsRaw),
    elementNames: childContainerNames,
    boundaryNames: childBoundaryNames,
    link,
    sourceLocation: macro.range,
  };
  return {
    boundary,
    elementNames: childContainerNames,
    childBoundaryNames,
  };
};

interface RelationEmit {
  readonly from: string;
  readonly relation: Relation;
}

/**
 * Lower a relation macro to one or two `RelationEmit`s (BiRel doubles
 * up). Returns the empty array when `from`/`to` are missing — the
 * preParse + visitor pipeline should reject those upstream, but we
 * never produce `dangling` entries from here.
 */
const buildRelations = (
  macro: RelationMacro,
  constants?: SimpleConstants,
): RelationEmit[] => {
  const from0 = argString(macro.positionals[0], constants);
  const to0 = argString(macro.positionals[1], constants);
  if (!from0 || !to0) return [];

  // Rel_Back* swaps semantically: `Rel_Back(a, b, "x")` means "b → a".
  const from = macro.back ? to0 : from0;
  const to = macro.back ? from0 : to0;

  const label = argString(macro.positionals[2], constants) ?? "";
  // After alias/alias/label, the Rel signature shape is identical to
  // Container's `(techn, descr, sprite, tags, link)`.
  const technology = coalesceString(
    constants,
    namedValue(macro.namedArgs, "techn"),
    macro.positionals[3],
  );
  const c4Descr = coalesceString(
    constants,
    namedValue(macro.namedArgs, "descr"),
    macro.positionals[4],
  );
  const tagsRaw = coalesceString(
    constants,
    namedValue(macro.namedArgs, "tags"),
    macro.positionals[6],
  );
  const sprite = coalesceString(
    constants,
    namedValue(macro.namedArgs, "sprite"),
    macro.positionals[5],
  );
  const link = coalesceString(
    constants,
    namedValue(macro.namedArgs, "link"),
    macro.positionals[7],
  );

  // RelIndex* — `$e_index` (mandatory first positional, lifted into
  // `indexPositional` by visitor). `Rel*` accepts named `$index=N`.
  const order = macro.indexPositional
    ? coerceOrder(macro.indexPositional, constants)
    : coerceOrder(namedValue(macro.namedArgs, "index"), constants);

  const base: Relation = {
    to,
    description: label || undefined,
    technology,
    tags: parseCsvTags(tagsRaw),
    sprite,
    link,
    properties: c4Descr ? { "plantuml.descr": c4Descr } : undefined,
    order,
    sourceLocation: macro.range,
  };

  if (macro.bidirectional) {
    // Two directed relations — one each way. Same metadata on both;
    // generators that round-trip BiRel collapse them back.
    const back: Relation = {
      ...base,
      to: from,
      sourceLocation: macro.range,
    };
    return [
      { from, relation: base },
      { from: to, relation: back },
    ];
  }
  return [{ from, relation: base }];
};

// ── Tree walk ───────────────────────────────────────────────────────

interface WalkAcc {
  readonly elements: Map<string, Element>;
  readonly boundaries: Boundary[];
  readonly rootBoundaryNames: string[];
  readonly pendingRelations: RelationEmit[];
  readonly issues: ModelIssue[];
  readonly constants?: SimpleConstants;
}

/**
 * Walk a statement list. `parentBoundary` is the enclosing boundary,
 * or undefined at diagram top-level. Returns the names of immediate
 * children (containers + boundaries) for the caller to slot into the
 * enclosing boundary's name lists.
 */
const walkStatements = (
  statements: readonly DiagramStatement[],
  acc: WalkAcc,
  parentBoundary?: BoundaryMacro,
): { elementNames: string[]; boundaryNames: string[] } => {
  const elementNames: string[] = [];
  const boundaryNames: string[] = [];

  for (const stmt of statements) {
    switch (stmt.kind) {
      case "elementMacro": {
        const built = buildElement(stmt, acc.constants);
        if (built) {
          // Collision detection happens in buildModel — we accept
          // overwrite semantics here and let the build layer report
          // duplicate-element-name issues.
          acc.elements.set(built.element.name, built.element);
          elementNames.push(built.element.name);
        }
        break;
      }
      case "boundaryMacro": {
        // Recurse first to collect children, then build the boundary
        // with their names.
        const childResult = walkStatements(stmt.children, acc, stmt);
        const built = buildBoundary(
          stmt,
          childResult.elementNames,
          childResult.boundaryNames,
          acc.constants,
        );
        if (built) {
          acc.boundaries.push(built.boundary);
          boundaryNames.push(built.boundary.name);
          if (!parentBoundary) {
            acc.rootBoundaryNames.push(built.boundary.name);
          }
        }
        break;
      }
      case "relationMacro": {
        acc.pendingRelations.push(...buildRelations(stmt, acc.constants));
        break;
      }
      case "layoutMacro":
      case "opaqueMacroCall":
      case "infoIssueMacroCall":
      case "include":
      case "preprocessorTokenIgnore": {
        // No Model effect.
        break;
      }
    }
  }

  return { elementNames, boundaryNames };
};

// ── Public entry ────────────────────────────────────────────────────

export interface PumlToModelResult extends LoadResult {
  /** Workspace metadata is always undefined for PUML — the format
   *  has no workspace concept; included for API symmetry. */
  readonly workspaceLocation?: SourceLocation;
}

export interface PumlToModelOptions {
  /** Properties extracted from `SetPropertyHeader` / `AddProperty`
   *  prefixes by `preParse`, keyed by the 1-based target-macro line.
   *  Empty / omitted leaves `Element.properties` /
   *  `Relation.properties` untouched on the output Model. */
  readonly attachedProperties?: ReadonlyMap<
    number,
    Readonly<Record<string, string>>
  >;
  readonly simpleConstants?: SimpleConstants;
}

const lookupProperties = (
  loc: SourceLocation | undefined,
  attached: PumlToModelOptions["attachedProperties"],
): Readonly<Record<string, string>> | undefined =>
  loc && attached ? attached.get(loc.start.line) : undefined;

/**
 * Attach `AddProperty` rows extracted by preParse to elements,
 * boundaries, and per-element relations by matching the target
 * macro's 1-based start line. Returns a new Model when any node
 * picked up properties; the input Model is reused unchanged
 * otherwise so the no-properties path stays allocation-free.
 */
const attachPropertiesToModel = (
  model: ReturnType<typeof buildModel>["model"],
  attached: PumlToModelOptions["attachedProperties"],
): ReturnType<typeof buildModel>["model"] => {
  if (!attached || attached.size === 0) return model;

  let changed = false;
  const elements: Record<string, (typeof model.elements)[string]> = {};
  for (const [name, el] of Object.entries(model.elements)) {
    let next = el;
    const elProps = lookupProperties(el.sourceLocation, attached);
    if (elProps) {
      next = { ...next, properties: { ...next.properties, ...elProps } };
      changed = true;
    }
    const newRels = el.relations.map((r) => {
      const relProps = lookupProperties(r.sourceLocation, attached);
      return relProps
        ? { ...r, properties: { ...r.properties, ...relProps } }
        : r;
    });
    if (newRels.some((r, i) => r !== el.relations[i])) {
      next = { ...next, relations: newRels };
      changed = true;
    }
    elements[name] = next;
  }

  const boundaries: Record<string, (typeof model.boundaries)[string]> = {};
  for (const [name, b] of Object.entries(model.boundaries)) {
    const bProps = lookupProperties(b.sourceLocation, attached);
    if (bProps) {
      boundaries[name] = { ...b, properties: { ...b.properties, ...bProps } };
      changed = true;
    } else {
      boundaries[name] = b;
    }
  }

  return changed ? { ...model, elements, boundaries } : model;
};

/**
 * Lower a `FileNode` AST to a `Model`. PUML has no workspace concept,
 * so `Model.workspace` is left undefined. We process only the first
 * diagram (preParse stripped the rest already).
 */
export const toModel = (
  file: FileNode,
  options: PumlToModelOptions = {},
): PumlToModelResult => {
  const acc: WalkAcc = {
    elements: new Map(),
    boundaries: [],
    rootBoundaryNames: [],
    pendingRelations: [],
    issues: [],
    constants: options.simpleConstants,
  };
  const diagram = file.diagrams[0];
  if (diagram) {
    walkStatements(diagram.statements, acc);
  }

  // Apply pending relations to their source containers. A relation
  // whose source isn't a known container is left dangling —
  // `validateModel` (called from `buildModel`) surfaces it as a
  // dangling-relation issue with full source context.
  for (const emit of acc.pendingRelations) {
    const source = acc.elements.get(emit.from);
    if (!source) {
      acc.issues.push({
        kind: "loader-warning",
        source: "plantuml",
        code: "relationship-source-not-resolved",
        message: `Relationship source "${emit.from}" is not declared; relation to "${emit.relation.to}" was ignored.`,
        element: emit.from,
      });
      continue;
    }
    acc.elements.set(emit.from, {
      ...source,
      relations: [...source.relations, emit.relation],
    });
  }

  const built = buildModel({
    elements: [...acc.elements.values()],
    boundaries: acc.boundaries,
    rootBoundaryNames: acc.rootBoundaryNames,
    preIssues: acc.issues,
  });

  return {
    model: attachPropertiesToModel(built.model, options.attachedProperties),
    issues: built.issues,
  };
};
