/**
 * Implicit styling tags from the Structurizr tag vocabulary: `Element`
 * plus a kind tag (`Person` / `Software System` / `Container` /
 * `Component`) on every element, and `Relationship` on every relation.
 *
 * These duplicate the typed `kind` field — `Container` the tag carries
 * the same information as `kind: "Container"` — and carry no extra
 * architectural meaning: no rule reads them, `analyze` and the viewer
 * branch on `kind`, and the Structurizr generator re-derives them from
 * `kind` on output. The PlantUML, kubernetes and compose loaders never
 * produced them. Keeping `Model.tags` free of them makes the contract
 * uniform across formats — the same model loaded from `.dsl`, a
 * `workspace.json`, a `./k8s/` directory or a `compose.yml` carries the
 * same tag set — and keeps cross-format diffs honest.
 *
 * The `external` location tag is deliberately NOT here: it maps to the
 * typed `external` flag but is also a meaningful domain tag users author.
 */
const IMPLICIT_TAGS: ReadonlySet<string> = new Set([
  "Element",
  "Person",
  "Software System",
  "Container",
  "Component",
  "Relationship",
]);

/** Drop implicit styling tags; preserve user / domain tags and order. */
export const meaningfulTags = (tags: readonly string[] | undefined): string[] =>
  (tags ?? []).filter((tag) => !IMPLICIT_TAGS.has(tag));
