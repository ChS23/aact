import type {
  BoundaryChange,
  Change,
  ChangeGroup,
  DiffData,
  ElementChange,
  RelationChange,
  WorkspaceChange,
} from "../../../diff";
import type { Renderer } from "../../output";
import { colors } from "../../output/colors";
import { formatDisplayPath } from "../../output/hyperlinks";

/**
 * Text renderer for `aact diff`. Glyph convention `+ / - / ~` after
 * NDepend's DSM diff and `jd`'s patch output. Cosmetic-only changes
 * collapse into a single `+N cosmetic changes` summary line — agents
 * skimming the output for structural impact aren't drowned by
 * label-only renames.
 *
 * Three-column-ish layout: glyph + entity + name, then a free-form
 * change description. We don't try to right-align columns the way
 * `aact check` does — diff entries are heterogeneous (elements,
 * relations, boundaries, workspace) and a single padded column
 * across all of them ends up worse than per-entry framing.
 */

const glyphFor = (action: Change["action"]): string => {
  switch (action) {
    case "added": {
      return colors.green("+");
    }
    case "removed": {
      return colors.red("-");
    }
    case "renamed":
    case "moved":
    case "modified": {
      return colors.yellow("~");
    }
  }
};

const formatFieldValue = (v: unknown): string => {
  if (v === undefined || v === null) return "—";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};

const fieldSummary = (change: Change): string => {
  if (change.fields.length === 0) return "";
  const parts = change.fields.map((f) => {
    if (f.added || f.removed) {
      const bits: string[] = [];
      if (f.added && f.added.length > 0) bits.push(`+[${f.added.join(", ")}]`);
      if (f.removed && f.removed.length > 0)
        bits.push(`-[${f.removed.join(", ")}]`);
      return `${f.field} ${bits.join(" ")}`;
    }
    return `${f.field}: ${formatFieldValue(f.before)} → ${formatFieldValue(f.after)}`;
  });
  return parts.join("; ");
};

const renderElementLine = (c: ElementChange): string => {
  const glyph = glyphFor(c.action);
  const label = colors.bold(c.name.padEnd(28));
  switch (c.action) {
    case "renamed": {
      const conf = c.confidence
        ? colors.dim(` (confidence ${c.confidence.toFixed(2)})`)
        : "";
      const extras = c.fields.length > 0 ? `; ${fieldSummary(c)}` : "";
      return `  ${glyph} ${colors.dim("Element ")}${label} ${c.previousName} → ${c.name}${extras}${conf}`;
    }
    case "moved": {
      const boundaryField = c.fields.find((f) => f.field === "boundary");
      return `  ${glyph} ${colors.dim("Element ")}${label} moved: ${formatFieldValue(boundaryField?.before)} → ${formatFieldValue(boundaryField?.after)}`;
    }
    case "added":
    case "removed": {
      const kindCell = colors.dim(`(${c.kind})`);
      return `  ${glyph} ${colors.dim("Element ")}${label} ${kindCell}`;
    }
    case "modified": {
      return `  ${glyph} ${colors.dim("Element ")}${label} ${fieldSummary(c)}`;
    }
  }
};

const renderBoundaryLine = (c: BoundaryChange): string => {
  const glyph = glyphFor(c.action);
  const label = colors.bold(c.name.padEnd(28));
  switch (c.action) {
    case "renamed": {
      const conf = c.confidence
        ? colors.dim(` (confidence ${c.confidence.toFixed(2)})`)
        : "";
      const extras = c.fields.length > 0 ? `; ${fieldSummary(c)}` : "";
      return `  ${glyph} ${colors.dim("Boundary")} ${label} ${c.previousName} → ${c.name}${extras}${conf}`;
    }
    case "added":
    case "removed": {
      const kindCell = colors.dim(`(${c.kind})`);
      return `  ${glyph} ${colors.dim("Boundary")} ${label} ${kindCell}`;
    }
    case "moved":
    case "modified": {
      return `  ${glyph} ${colors.dim("Boundary")} ${label} ${fieldSummary(c)}`;
    }
  }
};

const renderRelationLine = (c: RelationChange): string => {
  const glyph = glyphFor(c.action);
  const arrow = colors.bold(`${c.from} → ${c.to}`);
  switch (c.action) {
    case "added":
    case "removed": {
      const tech = c.technology ? colors.dim(` (${c.technology})`) : "";
      return `  ${glyph} ${colors.dim("Relation")} ${arrow}${tech}`;
    }
    case "modified": {
      return `  ${glyph} ${colors.dim("Relation")} ${arrow}  ${fieldSummary(c)}`;
    }
    case "renamed":
    case "moved": {
      // Relations don't currently emit these actions; future-proofing.
      return `  ${glyph} ${colors.dim("Relation")} ${arrow}  ${fieldSummary(c)}`;
    }
  }
};

const renderWorkspaceLine = (c: WorkspaceChange): string => {
  const glyph = glyphFor(c.action);
  return `  ${glyph} ${colors.dim("Workspace")} ${fieldSummary(c)}`;
};

const renderChange = (c: Change): string => {
  switch (c.entity) {
    case "element": {
      return renderElementLine(c);
    }
    case "boundary": {
      return renderBoundaryLine(c);
    }
    case "relation": {
      return renderRelationLine(c);
    }
    case "workspace": {
      return renderWorkspaceLine(c);
    }
  }
};

const renderGroup = (g: ChangeGroup): string => {
  const conf = colors.dim(` (confidence ${g.confidence.toFixed(2)})`);
  return `  ${colors.cyan("~")} ${colors.dim("Group   ")} ${colors.bold(g.title)}${conf}`;
};

export const renderDiffText: Renderer<DiffData> = (envelope, sink) => {
  const { data } = envelope;

  // Header: provenance + headline. `source` is either an absolute file
  // path (loaded via the format registry), a git-ref string like
  // `HEAD:arch.puml`, or a stdin label `<stdin:baseline>`. formatDisplayPath
  // only relativises actual absolute paths and passes everything else
  // through verbatim, so git refs and stdin labels stay readable.
  sink.write(
    colors.dim(
      `aact diff ${formatDisplayPath(data.baseline.source)} ${formatDisplayPath(data.current.source)}\n\n`,
    ),
  );
  sink.write(`  ${data.summary.headline}\n\n`);

  if (data.changes.length === 0) {
    sink.write(colors.green("  No structural changes.\n"));
    return;
  }

  if (data.groups && data.groups.length > 0) {
    for (const group of data.groups) {
      sink.write(renderGroup(group) + "\n");
    }
    sink.write("\n");
  }

  // Structural + semantic shown in full; cosmetic collapsed into a
  // tail line so PR-review output stays readable.
  const visible = data.changes.filter((c) => c.severity !== "cosmetic");
  const cosmeticCount = data.changes.length - visible.length;

  for (const c of visible) {
    sink.write(renderChange(c) + "\n");
  }

  if (cosmeticCount > 0) {
    const verb = cosmeticCount === 1 ? "change" : "changes";
    sink.write(
      "\n" +
        colors.dim(
          `  + ${cosmeticCount} cosmetic ${verb} (use --json to see all)\n`,
        ),
    );
  }

  sink.write(
    "\n" +
      colors.dim(
        `  ${data.summary.bySeverity.structural} structural / ${data.summary.bySeverity.semantic} semantic / ${data.summary.bySeverity.cosmetic} cosmetic\n`,
      ),
  );
};
