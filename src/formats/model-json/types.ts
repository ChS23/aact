import type { Model } from "../../model";

/**
 * Canonical on-disk shape that `aact generate --format model-json` emits
 * and that the loader treats as the primary input form. Wrapped here so
 * the JSON Schema generator has a single root type that pins the
 * `schemaVersion` literal alongside the Model payload.
 *
 * The `$schema` field is optional in the type but always present on
 * emit — VSCode / Cursor / JetBrains use it to auto-attach the schema
 * to any `*.aact.json` file the user opens without a SchemaStore
 * lookup. Loaders pass it through untouched.
 */
export interface ModelJsonFile {
  /**
   * Pointer to the JSON Schema describing this file. Optional on read
   * (hand-authored files may omit it), always written on emit so editors
   * can pick the schema up automatically.
   */
  readonly $schema?: string;
  /**
   * Version of the canonical contract. Frozen at `1` until aact 3.0.0
   * GA, then additive within `1` (post-GA bumps only on remove/rename).
   */
  readonly schemaVersion: 1;
  readonly model: Model;
}
