import type { AnalysisReport, BoundaryAnalysis } from "../../analyze";
import { analyzeArchitecture } from "../../analyze";
import type { AactConfig } from "../../config";
import { issueToDiagnostic, loadModel } from "../loadModel";
import type { Renderer } from "../output";
import { colors } from "../output/colors";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg, jsonArg } from "../sharedArgs";

export type AnalyzeData = AnalysisReport;

/**
 * Exported for unit-testing without going through citty/process.exit.
 * The runner wires this into `cliCommandWithConfig.execute`.
 */
export const executeAnalyze = async (
  config: AactConfig,
): Promise<ExecuteResult<AnalyzeData>> => {
  const { model, issues } = await loadModel(config);
  const { report } = analyzeArchitecture(model, config.analyze);
  return {
    data: report,
    exitCode: 0,
    diagnostics: issues.map(issueToDiagnostic),
  };
};

const formatRatio = (ratio: number | null): string =>
  ratio === null ? "n/a" : ratio.toFixed(2);

const renderBoundaryRow = (b: BoundaryAnalysis): string => {
  const breakdown: string[] = [];
  if (b.syncCoupling > 0) breakdown.push(`${b.syncCoupling} sync`);
  if (b.asyncCoupling > 0) breakdown.push(`${b.asyncCoupling} async`);
  if (b.unspecifiedCoupling > 0) {
    breakdown.push(`${b.unspecifiedCoupling} unspecified`);
  }
  const couplingCell =
    breakdown.length > 0
      ? `coupling=${b.coupling} (${breakdown.join(", ")})`
      : `coupling=${b.coupling}`;
  return (
    `  ${colors.bold(b.label)}: cohesion=${b.cohesion}  ${couplingCell}` +
    `  ratio=${formatRatio(b.ratio)}`
  );
};

export const renderAnalyzeText: Renderer<AnalyzeData> = (envelope, sink) => {
  const { data } = envelope;

  sink.write(colors.bold(`Elements: ${data.elementsCount}\n`));
  const kindEntries = Object.entries(data.elementsByKind).toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [kind, count] of kindEntries) {
    sink.write(`  ${colors.dim(kind.padEnd(16))} ${count}\n`);
  }

  sink.write(
    `\nDatabases: ${data.databases.count} ` +
      `(consumed by ${data.databases.consumes} relation(s))\n`,
  );

  const total =
    data.relationsByStyle.sync +
    data.relationsByStyle.async +
    data.relationsByStyle.unspecified;
  sink.write(
    `\nRelations: ${total} ` +
      `(${data.relationsByStyle.sync} sync, ` +
      `${data.relationsByStyle.async} async, ` +
      `${data.relationsByStyle.unspecified} unspecified)\n`,
  );

  if (data.boundaries.length > 0) {
    sink.write(colors.bold(`\nBoundaries: ${data.boundaries.length}\n`));
    for (const b of data.boundaries) {
      sink.write(renderBoundaryRow(b) + "\n");
      for (const r of b.couplingRelations) {
        sink.write(colors.dim(`    ${r.from} → ${r.to}\n`));
      }
    }
  }

  if (data.fanOut.length > 0) {
    sink.write(colors.bold("\nFan-out hotspots:\n"));
    for (const it of data.fanOut) {
      sink.write(`  ${it.name.padEnd(24)} ${it.count}\n`);
    }
  }
  if (data.fanIn.length > 0) {
    sink.write(colors.bold("\nFan-in hotspots:\n"));
    for (const it of data.fanIn) {
      sink.write(`  ${it.name.padEnd(24)} ${it.count}\n`);
    }
  }

  sink.write(colors.bold(`\nCycles: ${data.cycles.count}\n`));
  if (data.cycles.smallest) {
    sink.write(colors.dim(`  shortest: ${data.cycles.smallest.join(" → ")}\n`));
  }
};

export const analyze = cliCommandWithConfig({
  name: "analyze",
  meta: { name: "analyze", description: "Analyze architecture metrics" },
  args: { ...configArg, ...jsonArg },
  renderText: renderAnalyzeText,
  execute: (_ctx, config) => executeAnalyze(config),
});
