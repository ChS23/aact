import type { Model } from "../../model";
import type { FormatOutput } from "../types";

/**
 * `model-json` generator. Emits the canonical format-level shape
 * `{ $schema, schemaVersion: 1, model: Model }` — distinct from
 * `aact model --json` which wraps the same Model in `CliEnvelope`
 * with CLI-level meta (durationMs, command, configPath) and never
 * carries `$schema`.
 *
 * `$schema` is intentional payload, not metadata: VSCode / Cursor /
 * JetBrains / Zed key off it to attach the JSON Schema for
 * autocomplete and validation on `*.aact.json` files (and on any
 * file the user renamed outside that pattern).
 *
 * The Format-API `generate(model)` is a pure function: no access to
 * runtime context, no envelope semantics. So this output is the
 * lean, format-neutral snapshot — suitable for git-committing as
 * a baseline, sharing between tools, or replaying through
 * `aact diff`. Symmetric to `JSON.parse(generate(model)) → load(...)`
 * — the canonical round-trip.
 *
 * `sourceLocation` is preserved on emit when present on the input
 * Model. Consumers that need a "logical only" dump can strip it
 * themselves; we never invent or fabricate the field. When the
 * source was originally PUML/DSL, sourceLocation points at lines
 * in that source — accurate as long as the user keeps the source
 * file around at the same path.
 *
 * **Determinism.** Element / Boundary records are written with keys
 * sorted alphabetically so two generates from the same Model
 * produce byte-identical output. Without this, the `Object.values`
 * insertion order leaks parser quirks into the diff, and
 * `aact diff base.aact.json base.aact.json` would show phantom
 * moves whenever the parser reordered loaders internally.
 */

const sortRecord = <T>(
  record: Readonly<Record<string, T>>,
): Record<string, T> => {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).toSorted((a, b) =>
    a.localeCompare(b),
  )) {
    sorted[key] = record[key];
  }
  return sorted;
};

const normaliseModel = (model: Model): Model => ({
  elements: sortRecord(model.elements),
  boundaries: sortRecord(model.boundaries),
  rootBoundaryNames: model.rootBoundaryNames,
  ...(model.workspace ? { workspace: model.workspace } : {}),
});

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_PATH = "architecture.aact.json";

// Schema hosted in the upstream repo on `main`. The `-v1` suffix
// (AsyncAPI convention) pins the contract by URL: future
// `schemaVersion: 2` lands at `aact-model-v2.json`, so files emitted
// today never start validating against a different shape. URL stays
// valid for the lifetime of the repo — `main` never goes away and
// the file is checked in alongside this code.
//
// SchemaStore submission is a follow-up: once the URL has been live
// on `main` for a release cycle, opening a `SchemaStore/schemastore`
// PR with `fileMatch: ["*.aact.json"]` lets VSCode / JetBrains / Zed
// auto-attach the schema even without the `$schema` field. We keep
// emitting the field regardless — editors that haven't synced the
// catalog, or files renamed outside `*.aact.json`, still resolve it.
const SCHEMA_URL =
  "https://raw.githubusercontent.com/Byndyusoft/aact/main/schemas/aact-model-v1.json";

export const generate = (model: Model): FormatOutput => {
  // `$schema` first so it's the editor's first read — VSCode / Cursor /
  // JetBrains scan the top of the file and attach the schema before
  // they hit Model fields, so autocomplete kicks in even on partial
  // files mid-edit.
  const payload = {
    $schema: SCHEMA_URL,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    model: normaliseModel(model),
  };
  return {
    files: [
      {
        path: DEFAULT_OUTPUT_PATH,
        content: JSON.stringify(payload, undefined, 2) + "\n",
      },
    ],
  };
};
