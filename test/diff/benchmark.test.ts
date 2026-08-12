/**
 * Diff benchmark corpus.
 *
 * Each case in `test/diff/benchmark/<case-name>/` ships three files:
 *
 *   - `baseline.json`  — Raw Model JSON (model-json loader's "raw"
 *                        shape: `{ elements, boundaries,
 *                        rootBoundaryNames, workspace? }`)
 *   - `current.json`   — Same shape, the post-change Model
 *   - `expected.json`  — Hand-written *expected* DiffData. Reflects
 *                        what a "smart" diff should produce — NOT
 *                        a snapshot of current implementation
 *                        output. Failing cases mark gaps in the
 *                        algorithm; passing cases lock the
 *                        contract against regressions.
 *
 * Comparison strategy:
 *
 *   - `action` / `entity` / `address` — strict match.
 *   - `severity` — strict when specified.
 *   - `name` / `previousName` / `from` / `to` — strict when specified.
 *   - `fields[]` — set match by `field` literal; `before`/`after`
 *                  deep-equal when specified.
 *   - `confidenceHint` — `"high"` ⇒ confidence ≥ 0.75, `"low"` ⇒
 *                         confidence < 0.75. Exact confidence
 *                         values are implementation detail and not
 *                         frozen.
 *
 * Any actual change without a matching expected entry counts as
 * unexpected (test fails). Any expected entry without a matching
 * actual change counts as missing (test fails).
 *
 * Known-gap protocol: an `expected.json` carrying `"knownGap": true`
 * documents a case the current algorithm doesn't handle yet. The
 * runner dispatches such cases via `it.fails`, so the suite stays
 * green while the gap is open AND alerts the moment a future PR
 * starts producing the expected output (vitest fails an `it.fails`
 * that actually passes). When that happens, remove the flag.
 */

import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Change, ChangeGroup, DiffData } from "../../src/diff";
import { computeDiff } from "../../src/diff";
import type { Model } from "../../src/model";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.join(HERE, "benchmark");

const BASE = { source: "baseline.json", format: "model-json" } as const;
const CURR = { source: "current.json", format: "model-json" } as const;

interface ExpectedChange {
  readonly entity: "element" | "boundary" | "relation" | "workspace";
  readonly action: "added" | "removed" | "modified" | "renamed" | "moved";
  readonly address: string;
  readonly severity?: "structural" | "semantic" | "cosmetic";
  readonly name?: string;
  readonly previousName?: string;
  readonly from?: string;
  readonly to?: string;
  readonly fields?: ReadonlyArray<{
    readonly field: string;
    readonly before?: unknown;
    readonly after?: unknown;
  }>;
  readonly confidenceHint?: "low" | "high";
}

interface ExpectedDiff {
  readonly description?: string;
  readonly changes: readonly ExpectedChange[];
  readonly groups?: readonly ExpectedGroup[];
  /** When `true`, the current algorithm does not yet meet this
   *  expectation. The runner dispatches the case via `it.fails`.
   *  Remove (or set `false`) when an algorithm PR closes the gap. */
  readonly knownGap?: boolean;
}

interface ExpectedGroup {
  readonly id: string;
  readonly kind?: string;
  readonly title?: string;
  readonly severity?: "structural" | "semantic" | "cosmetic";
  readonly changeAddresses?: readonly string[];
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly confidenceHint?: "low" | "high";
}

const loadJson = async <T>(file: string): Promise<T> => {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as T;
};

const compareValue = (actual: unknown, expected: unknown): boolean => {
  if (expected === undefined) return true;
  return JSON.stringify(actual) === JSON.stringify(expected);
};

const fieldsMatch = (
  actual: Change["fields"] | undefined,
  expected: ExpectedChange["fields"] | undefined,
): string | null => {
  if (!expected) return null;
  const actualFields = actual ?? [];
  for (const exp of expected) {
    const found = actualFields.find((a) => a.field === exp.field);
    if (!found) return `missing field "${exp.field}"`;
    if (!compareValue(found.before, exp.before)) {
      return `field "${exp.field}" before mismatch: got ${JSON.stringify(found.before)}, expected ${JSON.stringify(exp.before)}`;
    }
    if (!compareValue(found.after, exp.after)) {
      return `field "${exp.field}" after mismatch: got ${JSON.stringify(found.after)}, expected ${JSON.stringify(exp.after)}`;
    }
  }
  return null;
};

const confidenceMatches = (
  actual: number | undefined,
  hint: "low" | "high" | undefined,
): string | null => {
  if (!hint) return null;
  if (typeof actual !== "number")
    return `expected confidence (${hint}) but got none`;
  if (hint === "high" && actual < 0.75) {
    return `expected high confidence (≥0.75) but got ${actual.toFixed(2)}`;
  }
  if (hint === "low" && actual >= 0.75) {
    return `expected low confidence (<0.75) but got ${actual.toFixed(2)}`;
  }
  return null;
};

interface MatchResult {
  readonly matched: ReadonlyArray<{ expected: ExpectedChange; actual: Change }>;
  readonly missing: readonly ExpectedChange[];
  readonly extras: readonly Change[];
  readonly mismatches: readonly { address: string; reason: string }[];
}

interface GroupMatchResult {
  readonly missing: readonly ExpectedGroup[];
  readonly extras: readonly ChangeGroup[];
  readonly mismatches: readonly { id: string; reason: string }[];
}

const compareChanges = (
  actual: readonly Change[],
  expected: readonly ExpectedChange[],
): MatchResult => {
  const matched: { expected: ExpectedChange; actual: Change }[] = [];
  const missing: ExpectedChange[] = [];
  const mismatches: { address: string; reason: string }[] = [];
  const matchedActual = new Set<Change>();

  for (const exp of expected) {
    const found = actual.find(
      (a) => !matchedActual.has(a) && a.address === exp.address,
    );
    if (!found) {
      missing.push(exp);
      continue;
    }
    matchedActual.add(found);
    matched.push({ expected: exp, actual: found });

    if (found.entity !== exp.entity) {
      mismatches.push({
        address: exp.address,
        reason: `entity mismatch: got "${found.entity}", expected "${exp.entity}"`,
      });
    }
    if (found.action !== exp.action) {
      mismatches.push({
        address: exp.address,
        reason: `action mismatch: got "${found.action}", expected "${exp.action}"`,
      });
    }
    if (exp.severity && found.severity !== exp.severity) {
      mismatches.push({
        address: exp.address,
        reason: `severity mismatch: got "${found.severity}", expected "${exp.severity}"`,
      });
    }
    if (exp.name !== undefined && "name" in found && found.name !== exp.name) {
      mismatches.push({
        address: exp.address,
        reason: `name mismatch: got "${found.name}", expected "${exp.name}"`,
      });
    }
    if (
      exp.previousName !== undefined &&
      "previousName" in found &&
      found.previousName !== exp.previousName
    ) {
      mismatches.push({
        address: exp.address,
        reason: `previousName mismatch: got "${found.previousName}", expected "${exp.previousName}"`,
      });
    }
    if (exp.from !== undefined && "from" in found && found.from !== exp.from) {
      mismatches.push({
        address: exp.address,
        reason: `from mismatch: got "${found.from}", expected "${exp.from}"`,
      });
    }
    if (exp.to !== undefined && "to" in found && found.to !== exp.to) {
      mismatches.push({
        address: exp.address,
        reason: `to mismatch: got "${found.to}", expected "${exp.to}"`,
      });
    }
    const fieldsErr = fieldsMatch(found.fields, exp.fields);
    if (fieldsErr) {
      mismatches.push({ address: exp.address, reason: fieldsErr });
    }
    const confidence = "confidence" in found ? found.confidence : undefined;
    const confErr = confidenceMatches(confidence, exp.confidenceHint);
    if (confErr) {
      mismatches.push({ address: exp.address, reason: confErr });
    }
  }

  const extras = actual.filter((a) => !matchedActual.has(a));
  return { matched, missing, extras, mismatches };
};

const compareGroups = (
  actual: readonly ChangeGroup[],
  expected: readonly ExpectedGroup[],
): GroupMatchResult => {
  const missing: ExpectedGroup[] = [];
  const mismatches: { id: string; reason: string }[] = [];
  const matchedActual = new Set<ChangeGroup>();

  for (const exp of expected) {
    const found = actual.find((a) => !matchedActual.has(a) && a.id === exp.id);
    if (!found) {
      missing.push(exp);
      continue;
    }
    matchedActual.add(found);

    if (exp.kind !== undefined && found.kind !== exp.kind) {
      mismatches.push({
        id: exp.id,
        reason: `kind mismatch: got "${found.kind}", expected "${exp.kind}"`,
      });
    }
    if (exp.title !== undefined && found.title !== exp.title) {
      mismatches.push({
        id: exp.id,
        reason: `title mismatch: got "${found.title}", expected "${exp.title}"`,
      });
    }
    if (exp.severity !== undefined && found.severity !== exp.severity) {
      mismatches.push({
        id: exp.id,
        reason: `severity mismatch: got "${found.severity}", expected "${exp.severity}"`,
      });
    }
    if (
      exp.changeAddresses !== undefined &&
      !compareValue(found.changeAddresses, exp.changeAddresses)
    ) {
      mismatches.push({
        id: exp.id,
        reason: `changeAddresses mismatch: got ${JSON.stringify(found.changeAddresses)}, expected ${JSON.stringify(exp.changeAddresses)}`,
      });
    }
    if (exp.evidence) {
      for (const [key, value] of Object.entries(exp.evidence)) {
        if (!compareValue(found.evidence?.[key], value)) {
          mismatches.push({
            id: exp.id,
            reason: `evidence.${key} mismatch: got ${JSON.stringify(found.evidence?.[key])}, expected ${JSON.stringify(value)}`,
          });
        }
      }
    }
    const confErr = confidenceMatches(found.confidence, exp.confidenceHint);
    if (confErr) {
      mismatches.push({ id: exp.id, reason: confErr });
    }
  }

  const extras = actual.filter((a) => !matchedActual.has(a));
  return { missing, extras, mismatches };
};

const formatExtras = (extras: readonly Change[]): string =>
  extras
    .map(
      (e) =>
        `  - ${e.entity}/${e.action} @ ${e.address} (severity=${e.severity})`,
    )
    .join("\n");

const formatMissing = (missing: readonly ExpectedChange[]): string =>
  missing.map((e) => `  - ${e.entity}/${e.action} @ ${e.address}`).join("\n");

const formatGroupExtras = (extras: readonly ChangeGroup[]): string =>
  extras.map((g) => `  - ${g.kind} @ ${g.id}`).join("\n");

const formatGroupMissing = (missing: readonly ExpectedGroup[]): string =>
  missing.map((g) => `  - ${g.kind ?? "group"} @ ${g.id}`).join("\n");

const runCase = async (caseName: string): Promise<void> => {
  const dir = path.join(BENCH_DIR, caseName);
  const [baseline, current, expected] = await Promise.all([
    loadJson<Model>(path.join(dir, "baseline.json")),
    loadJson<Model>(path.join(dir, "current.json")),
    loadJson<ExpectedDiff>(path.join(dir, "expected.json")),
  ]);

  const result: DiffData = computeDiff(baseline, current, BASE, CURR);
  const cmp = compareChanges(result.changes, expected.changes);
  const groupCmp =
    expected.groups === undefined
      ? null
      : compareGroups(result.groups ?? [], expected.groups);

  const errors: string[] = [];
  if (cmp.missing.length > 0) {
    errors.push(`Missing expected changes:\n${formatMissing(cmp.missing)}`);
  }
  if (cmp.extras.length > 0) {
    errors.push(`Unexpected actual changes:\n${formatExtras(cmp.extras)}`);
  }
  for (const m of cmp.mismatches) {
    errors.push(`Mismatch @ ${m.address}: ${m.reason}`);
  }
  if (groupCmp) {
    if (groupCmp.missing.length > 0) {
      errors.push(
        `Missing expected groups:\n${formatGroupMissing(groupCmp.missing)}`,
      );
    }
    if (groupCmp.extras.length > 0) {
      errors.push(
        `Unexpected actual groups:\n${formatGroupExtras(groupCmp.extras)}`,
      );
    }
    for (const m of groupCmp.mismatches) {
      errors.push(`Group mismatch @ ${m.id}: ${m.reason}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`[${caseName}] benchmark gaps:\n${errors.join("\n\n")}`);
  }
};

const discoverCases = (): { name: string; knownGap: boolean }[] => {
  const dirs = readdirSync(BENCH_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("case-"))
    .map((e) => e.name)
    .toSorted();
  return dirs.map((name) => {
    const expectedPath = path.join(BENCH_DIR, name, "expected.json");
    const raw = readFileSync(expectedPath, "utf8");
    const expected = JSON.parse(raw) as ExpectedDiff;
    return { name, knownGap: expected.knownGap === true };
  });
};

describe("diff benchmark corpus", () => {
  const cases = discoverCases();

  it("loads at least one case", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  describe("cases", () => {
    for (const { name, knownGap } of cases) {
      // `it.fails` flips the polarity: vitest expects the test to
      // throw. When the algorithm starts producing the expected
      // output, `it.fails` itself fails — the human signal to drop
      // the `knownGap` flag.
      const runner = knownGap ? it.fails : it;
      runner(name, async () => {
        await runCase(name);
      });
    }
  });
});
