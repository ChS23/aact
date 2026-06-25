/**
 * Implicit tags from the Structurizr tag vocabulary that duplicate a
 * typed Model field: `Element` plus a kind tag (`Person` / `Software
 * System` / `Container` / `Component`) and `External` on elements, and
 * `Relationship` on relations.
 *
 * Each one mirrors a field the Model already carries — `Container` the
 * tag === `kind: "Container"`, `External` === `external: true` — and
 * carries no extra architectural meaning: no rule reads them (rules
 * branch on `kind` / `external`), `analyze` and the viewer use the typed
 * fields, and the Structurizr generator re-derives them from `kind` /
 * `external` on output. The PlantUML, kubernetes and compose loaders set
 * the fields without emitting the tags. Stripping them keeps `Model.tags`
 * to user-authored, architecturally meaningful tags — uniform whether a
 * model loads from `.dsl`, a `workspace.json`, a `./k8s/` directory or a
 * `compose.yml` — and keeps cross-format diffs honest.
 *
 * NOT stripped: `async` (the canonical encoding of an async relation —
 * there's no typed field, and `analyze` / rules read it).
 */
const IMPLICIT_TAGS: ReadonlySet<string> = new Set([
  "Element",
  "Person",
  "Software System",
  "Container",
  "Component",
  "External",
  "Relationship",
]);

/** Drop implicit styling tags; preserve user / domain tags and order. */
export const meaningfulTags = (tags: readonly string[] | undefined): string[] =>
  (tags ?? []).filter((tag) => !IMPLICIT_TAGS.has(tag));
