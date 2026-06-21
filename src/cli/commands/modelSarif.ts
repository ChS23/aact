import { pathToFileURL } from "node:url";

import type { ModelIssue } from "../../model";
import { issueKindMap } from "../loadModel";
import type { SarifAdapter, SarifLog, SarifResult } from "../output";
import type { ModelData } from "./model";

const SARIF_SCHEMA =
  "https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.6.json";
const AACT_INFO_URI = "https://github.com/Byndyusoft/aact";

/**
 * `aact model --sarif` lets agents and CI emit loader-level
 * problems (dangling refs, duplicate ids, unknown kinds) as
 * SARIF results, separate from rule violations. Useful when the
 * model is malformed enough that `aact check` can't even start —
 * the SARIF output still lands in GitHub Code Scanning so
 * reviewers see what's broken about the source itself.
 *
 * Each `ModelIssue` kind gets its own SARIF rule id under the
 * `model.*` namespace, with a one-line description. We don't pull
 * source locations from issues today (most loader-issue variants
 * don't carry one), so results land without `locations[].region` —
 * GH still surfaces them at the file level.
 */
const ISSUE_DESCRIPTIONS: Record<ModelIssue["kind"], string> = {
  "dangling-relation":
    "Relation target name is not in `model.elements` — typo or missing element",
  "element-in-boundary-not-in-model":
    "Boundary references an element name that wasn't loaded",
  "boundary-not-in-model":
    "Boundary references a child boundary that wasn't loaded",
  "boundary-cycle": "Two or more boundaries form a containment cycle",
  "duplicate-element-name":
    "Two elements share the same name — keys are unique",
  "duplicate-boundary-name":
    "Two boundaries share the same name — keys are unique",
  "duplicate-identifier":
    "Two Structurizr DSL identifiers map to the same element",
  "self-relation": "Element has a relation pointing at itself",
  "unknown-kind":
    "Element declares a kind outside the C4 stdlib (Person / System / Container / Component variants)",
  "loader-warning":
    "Format-specific loader emitted a warning (e.g. obsolete field, unsupported feature, malformed input)",
};

const issueMessage = (i: ModelIssue): string => {
  switch (i.kind) {
    case "dangling-relation": {
      return `Relation "${i.from} → ${i.to}" — target not in model`;
    }
    case "element-in-boundary-not-in-model": {
      return `Boundary "${i.boundary}" references element "${i.element}" not in model`;
    }
    case "boundary-not-in-model": {
      return `Boundary "${i.parent}" references child boundary "${i.child}" not in model`;
    }
    case "boundary-cycle": {
      return `Boundary cycle: ${i.path.join(" → ")}`;
    }
    case "duplicate-element-name": {
      return `Duplicate element name "${i.name}"`;
    }
    case "duplicate-boundary-name": {
      return `Duplicate boundary name "${i.name}"`;
    }
    case "duplicate-identifier": {
      return `Duplicate identifier "${i.identifier}" — two distinct elements`;
    }
    case "self-relation": {
      return `Element "${i.element}" has a relation to itself`;
    }
    case "unknown-kind": {
      return `Element "${i.element}" has unknown kind "${i.raw}"`;
    }
    case "loader-warning": {
      return `[${i.source}:${i.code}] ${i.message}`;
    }
  }
};

const issueToResult = (i: ModelIssue, sourceUri: string): SarifResult => ({
  // Same id as `aact model --json`'s `diagnostics[].kind` (the camelCase
  // `DiagnosticKind`), so agents key on one vocabulary across JSON and SARIF.
  ruleId: issueKindMap[i.kind],
  level: "warning",
  message: { text: issueMessage(i) },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: sourceUri },
        region: { startLine: 1 },
      },
    },
  ],
});

export const modelSarifAdapter: SarifAdapter<ModelData> = (envelope) => {
  const sourcePath = envelope.meta.source ?? "unknown";
  const seenKinds = new Set(envelope.data.issues.map((i) => i.kind));
  const rules = [...seenKinds]
    .toSorted((a, b) => a.localeCompare(b))
    .map((kind) => ({
      id: issueKindMap[kind],
      name: issueKindMap[kind],
      shortDescription: { text: ISSUE_DESCRIPTIONS[kind] },
      helpUri: `${AACT_INFO_URI}#model-validation`,
    }));

  const log: SarifLog = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "aact",
            version: envelope.meta.aactVersion,
            informationUri: AACT_INFO_URI,
            rules,
          },
        },
        originalUriBaseIds: {
          SRCROOT: { uri: pathToFileURL(`${process.cwd()}/`).href },
        },
        results: envelope.data.issues.map((i) => issueToResult(i, sourcePath)),
      },
    ],
  };
  return log;
};
