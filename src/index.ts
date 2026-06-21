// Library API barrel. Anything re-exported here is public surface
// (schemaVersion 1 contract for the `--json` envelope shape, plus
// the rule / format / model primitives library users compose into
// their own tests). Everything else under `src/` is internal and
// may change without a major bump.

export * from "./analyze";
export * from "./config";
export {
  type BoundaryChange,
  type Change,
  type ChangeAction,
  type ChangeGroup,
  type ChangeSeverity,
  computeDiff,
  DEFAULT_RENAME_THRESHOLD,
  type DiffData,
  type DiffOptions,
  type DiffSide,
  type DiffSummary,
  type ElementChange,
  type FieldChange,
  type FieldKind,
  type JsonPatchOp,
  type RelationChange,
  type WorkspaceChange,
} from "./diff";
export { knownFormatNames, loadFormat } from "./formats/registry";
// Format objects, exported directly for library users and examples — the
// same shape `loadFormat` resolves dynamically. Mirrors the rules surface
// (`aclRule`, `crudRule`, …): `loadFormat` for registry / dynamic use,
// direct objects for static imports.
export { composeFormat } from "./formats/compose";
export { kubernetesFormat } from "./formats/kubernetes";
export { modelJsonFormat } from "./formats/model-json";
export { plantumlFormat } from "./formats/plantuml";
export { structurizrFormat } from "./formats/structurizr";
export {
  canFix,
  canGenerate,
  canLoad,
  type FixableFormat,
  type FixCapability,
  type Format,
  type FormatOutput,
  type FormatSyntax,
  type GeneratableFormat,
  type LoadableFormat,
  type LoadResult,
  type RelationDeclOptions,
} from "./formats/types";
export * from "./model";
export * from "./rules";

// CLI envelope contract — consumers parsing `aact <command> --json`
// output type-check `envelope.data` against the per-command shape.
// schemaVersion bumps are reserved for breaking renames/removals;
// additive changes ship without a bump.
export type {
  CliEnvelope,
  CommandResult,
  Diagnostic,
  DiagnosticKind,
  EnvelopeMeta,
  ExitCode,
  OutputMode,
  Renderer,
  Reporter,
  RuleMetadata,
} from "./cli/output";

// SARIF v2.1.0 surface — for consumers integrating `aact <command>
// --sarif` output and for tooling that builds custom `SarifAdapter`s
// against the same envelope.
export type {
  SarifAdapter,
  SarifArtifactLocation,
  SarifInvocation,
  SarifLevel,
  SarifLocation,
  SarifLog,
  SarifMessage,
  SarifNotification,
  SarifPhysicalLocation,
  SarifRegion,
  SarifReportingDescriptor,
  SarifResult,
  SarifRun,
  SarifTool,
  SarifToolDriver,
} from "./cli/output";

// Per-command `--json` data shapes. `envelope.data` is typed as one
// of these depending on `envelope.command`. AnalysisReport (the
// `analyze` shape) is already exported via the analyze barrel above.
export type {
  CheckData,
  CheckFixesApplied,
  CheckMode,
  CheckSummary,
  CheckViolation,
} from "./cli/commands/check";
export {
  loadBaseline,
  type LoadBaselineInput,
  type LoadBaselineResult,
} from "./cli/commands/diff/baseline";
export type {
  GenerateData,
  GeneratedFileInfo,
  GenerateOutputSink,
} from "./cli/commands/generate";
export type {
  InitCreated,
  InitData,
  InitFileKind,
  InitSkipped,
} from "./cli/commands/init";
export type { ModelData } from "./cli/commands/model";
export type {
  RuleExampleInfo,
  RuleExplainData,
  RuleListData,
  RuleListSummary,
} from "./cli/commands/rule";
export type {
  InstallPlan,
  SkillAction,
  SkillData,
  SkillPlanResult,
} from "./cli/commands/skill";
export type { ViewData } from "./cli/commands/view";
