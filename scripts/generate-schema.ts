/**
 * Build the JSON Schema for the canonical model-json file from TS types.
 *
 * Run via `pnpm schema:gen`. CI verifies the checked-in schema is
 * up-to-date with `git diff --exit-code schemas/` after running the
 * generator, so the schema can never drift from `ModelJsonFile`.
 *
 * Pin to draft-07: SchemaStore + VSCode have the most reliable support
 * there, and the model surface doesn't need anything newer (no
 * `unevaluatedProperties`, no `$dynamicRef`, etc.). Draft can be
 * bumped after the schema lands on SchemaStore and we know the
 * downstream tooling story.
 *
 * `createGenerator(config)` is the documented entry point — the
 * `createProgram / createParser / createFormatter / SchemaGenerator`
 * quartet exists but each factory expects a `CompletedConfig`, not the
 * partial `Config` we ship here. Going through the public façade keeps
 * typecheck clean.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Config } from "ts-json-schema-generator";
import { createGenerator } from "ts-json-schema-generator";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(repoRoot, "schemas", "aact-model-v1.json");

const config: Config = {
  path: path.join(repoRoot, "src/formats/model-json/types.ts"),
  tsconfig: path.join(repoRoot, "tsconfig.json"),
  type: "ModelJsonFile",
  // $id matches the GitHub raw URL the emitter writes into every
  // file. SchemaStore submission can happen later; until then `main`
  // hosts the schema directly. The `-v1` suffix (AsyncAPI convention)
  // pins the contract by URL: future `schemaVersion: 2` lands at
  // `aact-model-v2.json` so existing files never start validating
  // against a different shape.
  schemaId:
    "https://raw.githubusercontent.com/Byndyusoft/aact/main/schemas/aact-model-v1.json",
  topRef: false,
  expose: "export",
  jsDoc: "extended",
  // Allow unknown properties. The model surface evolves additively under
  // `schemaVersion: 1` — new optional fields must not make files written by
  // a newer aact fail validation against the published `-v1` schema. With
  // `additionalProperties: false` the schema URL would become a hidden
  // version gate (every field add forces `-v2`), contradicting the additive
  // contract. Breaking shape changes still move to `aact-model-v2.json`.
  additionalProperties: true,
};

const schema = createGenerator(config).createSchema(config.type);
const json = JSON.stringify(schema, undefined, 2) + "\n";
writeFileSync(outputPath, json, "utf8");

// One-shot build script: direct console output is the point.
console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
