import type { ModelData } from "../../../src/cli/commands/model";
import { modelSarifAdapter } from "../../../src/cli/commands/modelSarif";
import type { CliEnvelope } from "../../../src/cli/output";
import type { Model, ModelIssue } from "../../../src/model";
import { makeModel } from "../../helpers/makeModel";

const tinyModel = (): Model =>
  makeModel({
    elements: [{ name: "svc_a" }],
    boundaries: [{ name: "ctx", elementNames: ["svc_a"] }],
  });

const envelopeWith = (
  issues: readonly ModelIssue[],
  source = "arch.puml",
): CliEnvelope<ModelData> => ({
  schemaVersion: 1,
  command: "model",
  ok: true,
  exitCode: 0,
  data: { model: tinyModel(), issues },
  diagnostics: [],
  meta: {
    aactVersion: "3.0.0-test",
    durationMs: 1,
    configPath: null,
    source,
  },
});

describe("modelSarifAdapter — top-level shape", () => {
  it("emits SARIF v2.1.0 with informationUri and aactVersion from envelope meta", () => {
    const log = modelSarifAdapter(envelopeWith([]));
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    expect(log.runs).toHaveLength(1);
    const driver = log.runs[0].tool.driver;
    expect(driver.name).toBe("aact");
    expect(driver.version).toBe("3.0.0-test");
    expect(driver.informationUri).toContain("github.com/Byndyusoft/aact");
  });

  it("emits empty results[] and no rule entries when there are no issues", () => {
    const log = modelSarifAdapter(envelopeWith([]));
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].tool.driver.rules).toEqual([]);
  });

  it("declares originalUriBaseIds.SRCROOT pointing at the cwd via pathToFileURL", () => {
    const log = modelSarifAdapter(envelopeWith([]));
    const base = log.runs[0].originalUriBaseIds?.SRCROOT;
    expect(base).toBeDefined();
    expect(base?.uri).toMatch(/^file:\/\//);
    expect(base?.uri.endsWith("/")).toBe(true);
    // pathToFileURL percent-encodes spaces; raw `file://${cwd}/` would not.
    expect(base?.uri).not.toMatch(/ /);
  });
});

describe("modelSarifAdapter — rule catalogue", () => {
  it("emits one rule entry per distinct issue kind, sorted alphabetically", () => {
    const log = modelSarifAdapter(
      envelopeWith([
        { kind: "self-relation", element: "svc_a" },
        { kind: "dangling-relation", from: "svc_a", to: "ghost" },
        { kind: "self-relation", element: "svc_b" },
      ]),
    );
    const ruleIds = (log.runs[0].tool.driver.rules ?? []).map((r) => r.id);
    expect(ruleIds).toEqual(["model.dangling-relation", "model.self-relation"]);
  });

  it("each rule entry carries a non-empty description and a model-validation helpUri", () => {
    const log = modelSarifAdapter(
      envelopeWith([{ kind: "boundary-cycle", path: ["a", "b", "a"] }]),
    );
    const [rule] = log.runs[0].tool.driver.rules ?? [];
    expect(rule.id).toBe("model.boundary-cycle");
    expect(rule.shortDescription?.text.length ?? 0).toBeGreaterThan(0);
    expect(rule.helpUri).toContain("#model-validation");
  });
});

describe("modelSarifAdapter — results mapping", () => {
  it("maps every issue to a result keyed by model.<kind>", () => {
    const issues: readonly ModelIssue[] = [
      { kind: "dangling-relation", from: "svc_a", to: "ghost" },
      { kind: "duplicate-element-name", name: "svc_a" },
    ];
    const log = modelSarifAdapter(envelopeWith(issues));
    expect(log.runs[0].results).toHaveLength(2);
    expect(log.runs[0].results[0].ruleId).toBe("model.dangling-relation");
    expect(log.runs[0].results[1].ruleId).toBe("model.duplicate-element-name");
  });

  it("emits warning-level results (loader issues are warnings, not errors)", () => {
    const log = modelSarifAdapter(
      envelopeWith([{ kind: "self-relation", element: "svc_a" }]),
    );
    expect(log.runs[0].results[0].level).toBe("warning");
  });

  it("renders messages including the offending names for each issue kind", () => {
    const cases: readonly { issue: ModelIssue; needle: RegExp }[] = [
      {
        issue: { kind: "dangling-relation", from: "svc_a", to: "ghost" },
        needle: /svc_a.*ghost/,
      },
      {
        issue: {
          kind: "element-in-boundary-not-in-model",
          element: "svc_a",
          boundary: "ctx",
        },
        needle: /ctx.*svc_a/,
      },
      {
        issue: {
          kind: "boundary-not-in-model",
          parent: "outer",
          child: "inner",
        },
        needle: /outer.*inner/,
      },
      {
        issue: { kind: "boundary-cycle", path: ["a", "b", "a"] },
        needle: /a → b → a/,
      },
      {
        issue: { kind: "duplicate-element-name", name: "svc_a" },
        needle: /svc_a/,
      },
      {
        issue: { kind: "duplicate-boundary-name", name: "ctx" },
        needle: /ctx/,
      },
      {
        issue: { kind: "duplicate-identifier", identifier: "api" },
        needle: /api/,
      },
      {
        issue: { kind: "self-relation", element: "svc_a" },
        needle: /svc_a/,
      },
      {
        issue: { kind: "unknown-kind", element: "weird", raw: "Mystery" },
        needle: /weird.*Mystery/,
      },
      {
        issue: {
          kind: "loader-warning",
          source: "compose",
          code: "version-obsolete",
          message: "version field is obsolete",
        },
        needle: /\[compose:version-obsolete] version field is obsolete/,
      },
    ];
    for (const { issue, needle } of cases) {
      const log = modelSarifAdapter(envelopeWith([issue]));
      expect(log.runs[0].results[0].message.text).toMatch(needle);
    }
  });

  it("falls back to source='unknown' when envelope meta has no source path", () => {
    const log = modelSarifAdapter({
      ...envelopeWith([{ kind: "self-relation", element: "svc_a" }]),
      meta: {
        aactVersion: "3.0.0-test",
        durationMs: 1,
        configPath: null,
        source: null,
      },
    });
    const artifact =
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    expect(artifact.uri).toBe("unknown");
  });

  it("points the artifactLocation at envelope.meta.source for every result", () => {
    const log = modelSarifAdapter(
      envelopeWith(
        [
          { kind: "self-relation", element: "svc_a" },
          { kind: "duplicate-identifier", identifier: "api" },
        ],
        "workspace.dsl",
      ),
    );
    for (const result of log.runs[0].results) {
      expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
        "workspace.dsl",
      );
      expect(result.locations[0].physicalLocation.region).toEqual({
        startLine: 1,
      });
    }
  });
});
