import { readFile } from "node:fs/promises";

import type { Boundary, Element, ModelIssue } from "../../model";
import { buildModel } from "../../model";
import type { LoadResult } from "../types";

/**
 * `model-json` loader. Reads a JSON file and normalises three input
 * shapes into a single `LoadResult`:
 *
 *  1. **Canonical** — `{ schemaVersion: 1, model: Model }`. The
 *     shape `aact generate --format model-json` emits. The version
 *     header future-proofs us: if the Model shape evolves
 *     post-GA, future loaders can branch on `schemaVersion` instead
 *     of inferring intent from missing fields.
 *
 *  2. **`CliEnvelope<ModelData>`** — `{ schemaVersion, command,
 *     data: { model, issues } }`. The shape `aact model --json`
 *     emits. Lets users redirect that command's output as a
 *     diff baseline / `aact check` source without re-shaping:
 *     `aact model --json > snap.aact.json && aact check`.
 *     Envelope's `data.issues` is **filtered** to loader-only
 *     kinds (see `LOADER_ONLY_ISSUE_KINDS` below) — graph-property
 *     diagnostics get recomputed from the Model by validateModel,
 *     replaying them from the envelope would double-emit.
 *
 *  3. **Raw `Model`** — `{ elements, boundaries, rootBoundaryNames,
 *     workspace? }`. Hand-authored compatibility shape. The most
 *     fragile (no version header, easy to drift) but easy to write.
 *
 * Detection is by structural keys (no JSON-Schema dependency): try
 * canonical first (`schemaVersion` + `model`), then envelope
 * (`data.model`), then raw (`elements` + `boundaries`). First
 * matching shape wins.
 *
 * **Validation pipeline.** `buildModel` already runs `validateModel`
 * internally (`src/model/build.ts:76`). The loader runs no second
 * validation pass. Envelope's `data.issues` flow through
 * `preIssues` *after* filtering to LOADER_ONLY_ISSUE_KINDS, so the
 * union (preIssues ∪ validateModel) on the result is exactly the
 * issue set the original PUML/DSL load would have produced — with
 * no duplicates for graph-property kinds.
 */

const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

/**
 * Loader-only `ModelIssue` kinds — issues that `validateModel`
 * truly cannot reconstruct from the post-build Model. Replaying
 * recomputable kinds via `preIssues` would just double-emit
 * because `buildModel` runs `validateModel` again.
 *
 * The only safe candidate is **`duplicate-identifier`**: it's
 * Structurizr DSL-specific (two `name = container "X"` statements
 * collide at parse time) and the post-build Model carries no
 * trace — duplicate identifiers normalise to distinct `name`s and
 * the collision is gone. Nothing else makes the cut:
 *
 *   - `unknown-kind` — looks loader-only, but JSON serialisation
 *     does *not* validate the `Element.kind` enum, so a
 *     `"Mystery"` value survives the round-trip on the Model and
 *     validateModel re-emits the issue. Replaying from envelope
 *     would double it.
 *   - `dangling-relation`, `boundary-cycle`, `self-relation`,
 *     `element-in-boundary-not-in-model`, `boundary-not-in-model` —
 *     pure graph properties; validateModel recomputes from the
 *     deserialised Model.
 *   - `duplicate-element-name`, `duplicate-boundary-name` — surfaced
 *     by buildModel itself when the Record write would collide.
 *     Records in JSON can't carry duplicate keys (JSON.parse keeps
 *     the last write), so by the time the loader sees the data the
 *     collision is impossible to detect — but it also can't be
 *     replayed from envelope without lying about the model state.
 */
const LOADER_ONLY_ISSUE_KINDS = new Set<ModelIssue["kind"]>([
  "duplicate-identifier",
]);

const filterLoaderOnlyIssues = (
  issues: readonly ModelIssue[],
): readonly ModelIssue[] =>
  issues.filter((i) => LOADER_ONLY_ISSUE_KINDS.has(i.kind));

interface RawModelInput {
  elements: unknown;
  boundaries: unknown;
  rootBoundaryNames: unknown;
  workspace?: unknown;
}

interface ExtractedShape {
  readonly raw: RawModelInput;
  /** Loader-side issues carried over from the source format. Only
   *  envelope shapes set this — canonical & raw have nowhere to
   *  put pre-issues. */
  readonly preIssues: readonly ModelIssue[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const hasRawModelKeys = (v: Record<string, unknown>): boolean =>
  "elements" in v && "boundaries" in v && "rootBoundaryNames" in v;

const extractShape = (parsed: unknown, source: string): ExtractedShape => {
  if (!isObject(parsed)) {
    throw new SyntaxError(
      `${source}: top-level JSON must be an object, got ${typeof parsed}`,
    );
  }

  // Shape 1 — canonical { schemaVersion, model }
  if ("schemaVersion" in parsed && "model" in parsed && !("data" in parsed)) {
    const version = parsed.schemaVersion;
    if (
      typeof version !== "number" ||
      !SUPPORTED_SCHEMA_VERSIONS.has(version)
    ) {
      throw new SyntaxError(
        `${source}: unsupported schemaVersion ${String(version)} ` +
          `(supported: ${[...SUPPORTED_SCHEMA_VERSIONS].join(", ")})`,
      );
    }
    if (!isObject(parsed.model) || !hasRawModelKeys(parsed.model)) {
      throw new SyntaxError(
        `${source}: canonical model-json requires "model" with ` +
          `"elements" / "boundaries" / "rootBoundaryNames"`,
      );
    }
    return {
      raw: parsed.model as unknown as RawModelInput,
      preIssues: [],
    };
  }

  // Shape 2 — CliEnvelope<ModelData> from `aact model --json`
  if (
    "data" in parsed &&
    isObject(parsed.data) &&
    "model" in parsed.data &&
    isObject(parsed.data.model)
  ) {
    const inner = parsed.data.model;
    if (!hasRawModelKeys(inner)) {
      throw new SyntaxError(
        `${source}: envelope.data.model is missing structural keys`,
      );
    }
    const rawIssues = parsed.data.issues;
    const preIssues: readonly ModelIssue[] = Array.isArray(rawIssues)
      ? filterLoaderOnlyIssues(rawIssues as ModelIssue[])
      : [];
    return {
      raw: inner as unknown as RawModelInput,
      preIssues,
    };
  }

  // Shape 3 — raw Model (hand-authored compat)
  if (hasRawModelKeys(parsed)) {
    return {
      raw: parsed as unknown as RawModelInput,
      preIssues: [],
    };
  }

  throw new SyntaxError(
    `${source}: not a recognised model-json shape. Expected one of:\n` +
      `  - { schemaVersion, model }  (canonical, from aact generate)\n` +
      `  - CliEnvelope<ModelData>    (from aact model --json)\n` +
      `  - raw Model                 ({elements, boundaries, rootBoundaryNames})`,
  );
};

export const load = async (path: string): Promise<LoadResult> => {
  const content = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new SyntaxError(
      `${path}: invalid JSON — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const { raw, preIssues } = extractShape(parsed, path);

  // Model in JSON form has `elements` / `boundaries` as objects keyed
  // by name (matches the `Readonly<Record<string, …>>` runtime shape).
  // `buildModel` expects arrays — flatten before calling. Sorting by
  // name happens inside buildModel itself.
  const elementsArr: readonly Element[] = isObject(raw.elements)
    ? (Object.values(raw.elements) as Element[])
    : [];
  const boundariesArr: readonly Boundary[] = isObject(raw.boundaries)
    ? (Object.values(raw.boundaries) as Boundary[])
    : [];
  const rootNames: readonly string[] = Array.isArray(raw.rootBoundaryNames)
    ? (raw.rootBoundaryNames as readonly string[])
    : [];

  // buildModel runs validateModel internally — calling it again
  // would duplicate dangling-relation / boundary-cycle / unknown-kind
  // / etc. preIssues here carries only the loader-only slice of
  // envelope.data.issues (see LOADER_ONLY_ISSUE_KINDS); everything
  // else gets recomputed from the deserialised Model.
  return buildModel({
    elements: elementsArr,
    boundaries: boundariesArr,
    rootBoundaryNames: rootNames,
    ...(raw.workspace ? { workspace: raw.workspace } : {}),
    preIssues,
  });
};
