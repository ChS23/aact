export {
  detectFormatFromPath,
  DiffInputError,
  type DiffInputErrorKind,
  loadBaseline,
  type LoadBaselineInput,
  type LoadBaselineResult,
} from "./baseline";
export { computeDiff, DEFAULT_RENAME_THRESHOLD } from "./computeDiff";
export type {
  BoundaryChange,
  Change,
  ChangeAction,
  ChangeGroup,
  ChangeSeverity,
  DiffData,
  DiffOptions,
  DiffSide,
  DiffSummary,
  ElementChange,
  FieldChange,
  FieldKind,
  JsonPatchOp,
  RelationChange,
  WorkspaceChange,
} from "./types";
