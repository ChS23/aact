import type { SourceLocation } from "../../model";
import type { SourceEdit } from "../types";

/**
 * Where the edit's affected source range lives. `replace`/`remove`
 * report their `range`, the two insert kinds their `anchor`.
 * Exposed because CLI / diagnostic consumers need to format the
 * location uniformly without re-matching the discriminant.
 */
export const editLocation = (e: SourceEdit): SourceLocation =>
  "range" in e ? e.range : e.anchor;

/**
 * Pure string splicer for `SourceEdit`s. Edits carry `SourceLocation`
 * source ranges — UTF-16 code-unit offsets, matching JS string
 * semantics (loaders populate them on every Element / Boundary /
 * Relation), so the applier never has to match text patterns or guess
 * which line is meant. Three rules:
 *
 *   1. Edits are applied in *reverse* offset order. That way splicing
 *      earlier offsets never shifts the coordinates of later edits —
 *      the same pattern LSP / VS Code's `TextDocumentEdit` uses.
 *   2. Two edits whose touched ranges overlap conflict. The applier
 *      keeps the first one (in input order) and reports the
 *      subsequent ones as `conflicts` — the CLI surfaces them as
 *      warnings instead of silently dropping a partial edit.
 *   3. Insertion (`insert-after` / `insert-before`) is just a splice
 *      at a single offset with zero-width "range". `content` is
 *      written verbatim — rules emit the newline + indentation they
 *      want; the applier does not interpret formatting.
 *
 * Returns the new content plus structured metadata. The CLI uses
 * `applied` to count successful fixes and `conflicts` to emit
 * diagnostics; library consumers can do the same. The function is
 * agnostic to source format — it works on PUML, Structurizr DSL,
 * Kubernetes YAML, or any other source string the offsets index into.
 */
export interface ApplyEditsResult {
  readonly content: string;
  readonly applied: readonly SourceEdit[];
  readonly conflicts: readonly EditConflict[];
}

export interface EditConflict {
  readonly skipped: SourceEdit;
  readonly conflictsWith: SourceEdit;
}

interface NormalizedEdit {
  readonly edit: SourceEdit;
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

const normalize = (edit: SourceEdit): NormalizedEdit => {
  switch (edit.kind) {
    case "replace": {
      return {
        edit,
        start: edit.range.start.offset,
        end: edit.range.end.offset,
        content: edit.content,
      };
    }
    case "remove": {
      return {
        edit,
        start: edit.range.start.offset,
        end: edit.range.end.offset,
        content: "",
      };
    }
    case "insert-after": {
      return {
        edit,
        start: edit.anchor.end.offset,
        end: edit.anchor.end.offset,
        content: edit.content,
      };
    }
    case "insert-before": {
      return {
        edit,
        start: edit.anchor.start.offset,
        end: edit.anchor.start.offset,
        content: edit.content,
      };
    }
  }
};

const overlaps = (a: NormalizedEdit, b: NormalizedEdit): boolean => {
  // Range edits overlap when their half-open intervals intersect.
  // Pure insertions (zero-width) at the same offset also count as
  // conflicts — applying both would have order-dependent results
  // that the rule author didn't ask for.
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  return a.start < b.end && b.start < a.end;
};

export const applyEdits = (
  source: string,
  edits: readonly SourceEdit[],
): ApplyEditsResult => {
  const normalized = edits.map(normalize);

  // Conflict detection runs against input order (first edit wins).
  // We track which normalized edits actually get applied so we can
  // splice in reverse-offset order independently of the input order.
  const accepted: NormalizedEdit[] = [];
  const conflicts: EditConflict[] = [];
  for (const candidate of normalized) {
    const clashing = accepted.find((acc) => overlaps(acc, candidate));
    if (clashing) {
      conflicts.push({
        skipped: candidate.edit,
        conflictsWith: clashing.edit,
      });
      continue;
    }
    accepted.push(candidate);
  }

  // Reverse offset order keeps earlier slices stable while we splice
  // later parts of the string. Ties break on end-offset (longer range
  // first) so an `insert-after` colocated with the end of a `replace`
  // lands on the *original* offset, not the post-replace one.
  const ordered = [...accepted].toSorted((a, b) => {
    if (b.start !== a.start) return b.start - a.start;
    return b.end - a.end;
  });

  let content = source;
  for (const n of ordered) {
    content = content.slice(0, n.start) + n.content + content.slice(n.end);
  }

  return {
    content,
    applied: accepted.map((n) => n.edit),
    conflicts,
  };
};
