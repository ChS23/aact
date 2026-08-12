/**
 * Structurizr DSL generator — emits a `workspace.dsl` from a canonical
 * `Model`. Round-trip target: parse(emit(model)) === model (modulo the
 * deliberate `""` vs `undefined` divergence noted in
 * `parser/grammar.md`).
 *
 * Out of scope (deliberate, see `parser/README.md`):
 *   - Archetype compress (factoring repeated tag sets into aliases)
 *   - Opaque blocks (views / styles / configuration / branding /
 *     terminology / themes / archetypes) — we don't capture inner
 *     content on load, so we can't re-emit it
 *   - `!impliedRelationships` reverse — implied edges were materialised
 *     into `Element.relations` on load
 *   - Deployment family — out of aact's C4 scope
 *   - `extends` workspace beyond the URL string
 *   - `!include` reconstruction
 */

import type { Boundary, Element, Model, Relation } from "../../model";
import { getElement } from "../../model";
import type { FormatOutput } from "../types";
import { STRUCTURIZR_LOCATION_EXTERNAL } from "./types";

const INDENT = "    ";

export interface StructurizrGenerateOptions {
  /** Output filename relative to the output dir. Defaults to `workspace.dsl`. */
  readonly fileName?: string;
}

/**
 * Tags that the reference parser auto-applies on load — `Element` +
 * the kind tag (`Person` / `Software System` / `Container` /
 * `Component`) on every element, and `Relationship` on every relation.
 * Emitting them as explicit `tags "..."` would round-trip
 * to duplicated tags downstream, so strip before emit.
 */
const AUTO_ELEMENT_TAGS = new Set([
  "Element",
  "Person",
  "Software System",
  "Container",
  "Component",
  "Group",
  STRUCTURIZR_LOCATION_EXTERNAL,
]);

const AUTO_RELATION_TAGS = new Set(["Relationship"]);

const ESCAPED_QUOTE = String.raw`\"`;
const quote = (s: string): string => {
  const escaped = s.replaceAll('"', ESCAPED_QUOTE);
  return `"${escaped}"`;
};

/**
 * Map an `Element.kind` (`Person` / `System` / `Container` /
 * `Component`) to the DSL element-kind keyword.
 */
const dslKindForElement = (kind: Element["kind"]): string => {
  switch (kind) {
    case "Person": {
      return "person";
    }
    case "System": {
      return "softwareSystem";
    }
    case "Container":
    case "ContainerDb":
    case "ContainerQueue": {
      return "container";
    }
    case "Component":
    case "ComponentDb":
    case "ComponentQueue": {
      return "component";
    }
  }
};

const dslKindForBoundary = (kind: Boundary["kind"]): string => {
  switch (kind) {
    case "System": {
      return "softwareSystem";
    }
    case "Container": {
      return "container";
    }
    case "Component": {
      return "component";
    }
    case "Enterprise": {
      // Reference removed `enterprise` keyword; closest representation
      // is a softwareSystem boundary. Rules that distinguish enterprise
      // can still tag explicitly, but the emitted DSL stays valid.
      return "softwareSystem";
    }
  }
};

/** Auto-tags depend on element kind (`Container` element carries
 *  the auto `Container` tag, not `Software System`). Strip both the
 *  generic `Element` and the kind-specific tag for a given element. */
const userTagsForElement = (element: Element): readonly string[] => {
  const out: string[] = [];
  for (const tag of element.tags) {
    if (AUTO_ELEMENT_TAGS.has(tag)) continue;
    out.push(tag);
  }
  // Surface the External flag as an explicit `External` tag — the
  // loader (`load.ts:isExternal`) recognises both the location field
  // and the tag.
  if (element.external && !out.includes(STRUCTURIZR_LOCATION_EXTERNAL)) {
    out.unshift(STRUCTURIZR_LOCATION_EXTERNAL);
  }
  return out;
};

const userTagsForBoundary = (boundary: Boundary): readonly string[] =>
  boundary.tags.filter((t) => !AUTO_ELEMENT_TAGS.has(t));

/**
 * Strip the auto `Relationship` tag and surface user tags verbatim.
 * The `async` tag is preserved as-is — the DSL has no body-level
 * `interactionStyle` keyword, so on round-trip the loader recognises
 * the tag (`load.ts:STRUCTURIZR_TAG_ASYNC`) and maps it back to
 * `interactionStyle = "Asynchronous"` in the JSON form. Reference:
 * `STRUCTURIZR_INTERACTION_ASYNC`.
 */
const userTagsForRelation = (relation: Relation): readonly string[] =>
  relation.tags.filter((t) => !AUTO_RELATION_TAGS.has(t));

/** Split `Element` / `Boundary` properties into a regular bag (emit
 *  as `properties { ... }`) and a perspectives list (emit as
 *  `perspectives { ... }`). The `perspective.*` key prefix is the
 *  load-side convention from `load.ts:toProperties`. The `group`
 *  pseudo-property is also stripped — group membership is rendered
 *  via the structured tree, not via properties. */
interface ExtractedProperties {
  readonly regular: Readonly<Record<string, string>>;
  readonly perspectives: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly value?: string;
  }>;
  readonly group?: string;
}

const extractProperties = (
  source: Readonly<Record<string, string>> | undefined,
): ExtractedProperties => {
  const regular: Record<string, string> = {};
  const perspectives: {
    name: string;
    description: string;
    value?: string;
  }[] = [];
  const seenPerspectives = new Set<string>();
  let group: string | undefined;
  if (!source) return { regular, perspectives, group };
  for (const [k, v] of Object.entries(source)) {
    if (k === "group") {
      group = v;
      continue;
    }
    if (k.startsWith("perspective.")) {
      const rest = k.slice("perspective.".length);
      if (rest.endsWith(".value")) continue; // collected via the description key
      if (seenPerspectives.has(rest)) continue;
      seenPerspectives.add(rest);
      const valueKey = `perspective.${rest}.value`;
      perspectives.push({
        name: rest,
        description: v,
        value: source[valueKey],
      });
      continue;
    }
    regular[k] = v;
  }
  return { regular, perspectives, group };
};

interface BodyLineEmitter {
  description?: string;
  technology?: string;
  link?: string;
  tags: readonly string[];
  props: ExtractedProperties;
}

const emitBodyLines = (
  data: BodyLineEmitter,
  depth: number,
): readonly string[] => {
  const lines: string[] = [];
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  // Description on body is only needed when not already serialised as
  // a header positional. The caller decides — we just emit.
  if (data.description) {
    lines.push(`${pad}description ${quote(data.description)}`);
  }
  if (data.technology) {
    lines.push(`${pad}technology ${quote(data.technology)}`);
  }
  if (data.tags.length > 0) {
    lines.push(`${pad}tags ${quote(data.tags.join(","))}`);
  }
  if (data.link) {
    lines.push(`${pad}url ${quote(data.link)}`);
  }
  const regularKeys = Object.keys(data.props.regular);
  if (regularKeys.length > 0) {
    lines.push(`${pad}properties {`);
    for (const k of regularKeys) {
      lines.push(`${inner}${quote(k)} ${quote(data.props.regular[k])}`);
    }
    lines.push(`${pad}}`);
  }
  if (data.props.perspectives.length > 0) {
    lines.push(`${pad}perspectives {`);
    for (const p of data.props.perspectives) {
      const valuePart = p.value === undefined ? "" : ` ${quote(p.value)}`;
      lines.push(`${inner}${p.name} ${quote(p.description)}${valuePart}`);
    }
    lines.push(`${pad}}`);
  }
  return lines;
};

const CONTAINER_KINDS: ReadonlySet<Element["kind"]> = new Set([
  "Container",
  "ContainerDb",
  "ContainerQueue",
]);
const COMPONENT_KINDS: ReadonlySet<Element["kind"]> = new Set([
  "Component",
  "ComponentDb",
  "ComponentQueue",
]);

const emitElement = (element: Element, depth: number): readonly string[] => {
  const pad = INDENT.repeat(depth);
  const keyword = dslKindForElement(element.kind);
  const tags = userTagsForElement(element);
  const props = extractProperties(element.properties);
  // Container / component (and their Db/Queue specialisations) carry
  // technology; person / softwareSystem ignore it on header per the
  // reference grammar.
  const hasTechSlot =
    CONTAINER_KINDS.has(element.kind) || COMPONENT_KINDS.has(element.kind);
  // Group is rendered structurally only if we have a non-empty
  // pseudo-property; otherwise the property bag is empty.
  const needsBody =
    !!element.description ||
    (hasTechSlot && !!element.technology) ||
    tags.length > 0 ||
    !!element.link ||
    Object.keys(props.regular).length > 0 ||
    props.perspectives.length > 0 ||
    props.group !== undefined;
  if (!needsBody) {
    return [`${pad}${element.name} = ${keyword} ${quote(element.label)}`];
  }
  const bodyLines = emitBodyLines(
    {
      description: element.description,
      technology: hasTechSlot ? element.technology : undefined,
      link: element.link,
      tags,
      props,
    },
    depth + 1,
  );
  const groupLine =
    props.group === undefined
      ? []
      : [`${INDENT.repeat(depth + 1)}group ${quote(props.group)}`];
  return [
    `${pad}${element.name} = ${keyword} ${quote(element.label)} {`,
    ...bodyLines,
    ...groupLine,
    `${pad}}`,
  ];
};

const emitBoundary = (
  model: Model,
  boundary: Boundary,
  depth: number,
): readonly string[] => {
  const pad = INDENT.repeat(depth);
  const keyword = dslKindForBoundary(boundary.kind);
  const bodyLines = emitBodyLines(
    {
      description: boundary.description,
      technology: undefined,
      link: boundary.link,
      tags: userTagsForBoundary(boundary),
      props: extractProperties(boundary.properties),
    },
    depth + 1,
  );
  // Children: nested boundaries first, then leaf elements. Order is
  // observable in source-level diffs; this matches typical reference
  // fixtures (the parent declares structure top-to-bottom).
  const nestedBoundaryLines = boundary.boundaryNames.flatMap((sub) => {
    const child = model.boundaries[sub];
    return child ? emitBoundary(model, child, depth + 1) : [];
  });
  const nestedElementLines = boundary.elementNames.flatMap((en) => {
    const child = getElement(model, en);
    return child ? emitElement(child, depth + 1) : [];
  });
  return [
    `${pad}${boundary.name} = ${keyword} ${quote(boundary.label)} {`,
    ...bodyLines,
    ...nestedBoundaryLines,
    ...nestedElementLines,
    `${pad}}`,
  ];
};

const emitRelation = (
  fromName: string,
  relation: Relation,
  depth: number,
): string => {
  const pad = INDENT.repeat(depth);
  const tags = userTagsForRelation(relation);
  const hasDescription = relation.description !== undefined;
  const hasTechnology = relation.technology !== undefined;
  const hasTags = tags.length > 0;
  // Positionals are positional — to set technology we must fill
  // description; to set tags we must fill description + technology.
  // Empty string is a valid placeholder per `ContainerParser.GRAMMAR`
  // — the reference parser tokenises an empty string slot identically.
  const description = hasDescription || hasTechnology || hasTags;
  const technology = hasTechnology || hasTags;
  const parts = [
    fromName,
    "->",
    relation.to,
    ...(description ? [quote(relation.description ?? "")] : []),
    ...(technology ? [quote(relation.technology ?? "")] : []),
    ...(hasTags ? [quote(tags.join(","))] : []),
  ];
  return `${pad}${parts.join(" ")}`;
};

const collectContainedElementNames = (model: Model): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const b of Object.values(model.boundaries)) {
    for (const e of b.elementNames) out.add(e);
  }
  return out;
};

const collectContainedBoundaryNames = (model: Model): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const b of Object.values(model.boundaries)) {
    for (const sub of b.boundaryNames) out.add(sub);
  }
  return out;
};

export const generate = (
  model: Model,
  options?: StructurizrGenerateOptions,
): FormatOutput => {
  const ws = model.workspace;
  // workspace header — name / description positionals + optional `extends`.
  // Positionals are positional: if description is set without name, emit
  // `""` placeholder so the keyword position stays consistent.
  const wsHeader = [
    "workspace",
    ...(ws?.name ? [quote(ws.name)] : []),
    ...(ws?.description
      ? [ws?.name ? quote(ws.description) : `"" ${quote(ws.description)}`]
      : []),
    ...(ws?.extendsTarget ? ["extends", quote(ws.extendsTarget)] : []),
  ].join(" ");

  const containedElements = collectContainedElementNames(model);
  const containedBoundaries = collectContainedBoundaryNames(model);

  const boundaryLines = model.rootBoundaryNames.flatMap((root) => {
    if (containedBoundaries.has(root)) return []; // safety: skip nested
    const b = model.boundaries[root];
    return b ? emitBoundary(model, b, 2) : [];
  });
  const standaloneElementLines = Object.values(model.elements).flatMap((e) =>
    containedElements.has(e.name) ? [] : emitElement(e, 2),
  );
  // Relationships at model scope. Reference accepts cross-scope
  // relations as long as both endpoints are declared, which is
  // guaranteed because every element appears above.
  const relationLines = Object.values(model.elements).flatMap((element) =>
    element.relations.map((r) => emitRelation(element.name, r, 2)),
  );

  const content = [
    `${wsHeader} {`,
    "",
    `${INDENT}model {`,
    ...boundaryLines,
    ...standaloneElementLines,
    ...(relationLines.length > 0 ? ["", ...relationLines] : []),
    `${INDENT}}`,
    "",
    `}`,
    "",
  ].join("\n");

  return {
    files: [{ path: options?.fileName ?? "workspace.dsl", content }],
  };
};
