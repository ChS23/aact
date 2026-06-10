import type { AactConfig } from "../../config";
import type {
  Boundary,
  Element,
  ElementKind,
  Model,
  ModelIssue,
} from "../../model";
import { allBoundaries, allElements } from "../../model";
import { issueToDiagnostic, loadModel } from "../loadModel";
import type { Renderer } from "../output";
import { colors } from "../output/colors";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg, jsonArg, sarifArg } from "../sharedArgs";
import { modelSarifAdapter } from "./modelSarif";

/**
 * `aact model` data shape. Mirrors the loader's natural output —
 * the normalized `Model` plus the loader-side issues that didn't
 * crash the build (dangling refs, duplicate ids, unknown kinds).
 *
 * Designed for agents: instead of reading raw PUML / Structurizr
 * DSL and parsing it themselves, an agent calls `aact model --json`
 * and reasons about a stable, frozen, validated graph. Same Model
 * shape the rule engine sees, so any agent decision is consistent
 * with what `aact check` would say.
 */
export interface ModelData {
  readonly model: Model;
  readonly issues: readonly ModelIssue[];
}

export const executeModel = async (
  config: AactConfig,
): Promise<ExecuteResult<ModelData>> => {
  const { model, issues } = await loadModel(config);
  return {
    data: { model, issues },
    exitCode: 0,
    diagnostics: issues.map(issueToDiagnostic),
  };
};

const countByKind = (
  elements: readonly Element[],
): ReadonlyMap<ElementKind, number> => {
  const out = new Map<ElementKind, number>();
  for (const e of elements) out.set(e.kind, (out.get(e.kind) ?? 0) + 1);
  return out;
};

const countRelations = (elements: readonly Element[]): number =>
  elements.reduce((n, e) => n + e.relations.length, 0);

const boundaryTreeLine = (
  b: Boundary,
  model: Model,
  indent: string,
): readonly string[] => {
  const kindLabel = colors.dim(`(${b.kind})`);
  const lines: string[] = [
    `${indent}${colors.bold(b.name)} ${kindLabel} ` +
      `— ${b.elementNames.length} element(s), ${b.boundaryNames.length} nested`,
  ];
  for (const childName of b.boundaryNames) {
    const child = model.boundaries[childName];
    if (child) lines.push(...boundaryTreeLine(child, model, indent + "  "));
  }
  return lines;
};

export const renderModelText: Renderer<ModelData> = (envelope, sink) => {
  const { model, issues } = envelope.data;
  const elements = allElements(model);
  const boundaries = allBoundaries(model);
  const kinds = countByKind(elements);
  const relations = countRelations(elements);

  if (model.workspace) {
    const w = model.workspace;
    sink.write(colors.bold("Workspace:") + "\n");
    if (w.name) sink.write(`  name:        ${w.name}\n`);
    if (w.description) sink.write(`  description: ${w.description}\n`);
    if (w.extendsTarget) sink.write(`  extends:     ${w.extendsTarget}\n`);
    sink.write("\n");
  }

  sink.write(colors.bold("Elements: ") + `${elements.length}\n`);
  for (const [kind, count] of [...kinds.entries()].toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    sink.write(`  ${colors.dim(kind.padEnd(16))} ${count}\n`);
  }
  sink.write(colors.bold("Boundaries: ") + `${boundaries.length}\n`);
  for (const root of model.rootBoundaryNames) {
    const b = model.boundaries[root];
    if (b)
      for (const line of boundaryTreeLine(b, model, "  "))
        sink.write(line + "\n");
  }
  sink.write(colors.bold("Relations: ") + `${relations}\n`);

  if (issues.length > 0) {
    sink.write(
      "\n" +
        colors.yellow(`Loader issues: ${issues.length}`) +
        " (see diagnostics on stderr for detail)\n",
    );
  }
};

export const model = cliCommandWithConfig({
  name: "model",
  meta: {
    name: "model",
    description:
      "Print the normalized Model (text summary, --json for full graph, --sarif for issues)",
  },
  args: { ...configArg, ...jsonArg, ...sarifArg },
  renderText: renderModelText,
  sarifAdapter: modelSarifAdapter,
  execute: (_ctx, config) => executeModel(config),
});
