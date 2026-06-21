import type {
  CheckData,
  CheckViolation,
} from "../../../src/cli/commands/check";
import { checkSarifAdapter } from "../../../src/cli/commands/checkSarif";
import type { CliEnvelope } from "../../../src/cli/output";
import { ruleRegistry } from "../../../src/rules/registry";

const envelopeWith = (
  violations: readonly CheckViolation[],
): CliEnvelope<CheckData> => ({
  schemaVersion: 1,
  command: "check",
  ok: violations.length === 0,
  exitCode: violations.length === 0 ? 0 : 1,
  data: {
    mode: "check",
    violations,
    suggestedFixes: [],
    summary: { failed: 0, passed: 0, total: 0 },
    rules: [],
  },
  diagnostics: [],
  meta: {
    aactVersion: "3.0.0-test",
    durationMs: 1,
    configPath: null,
    source: "arch.puml",
  },
});

const baseViolation: CheckViolation = {
  ruleId: "crud",
  target: "orders",
  targetKind: "element",
  message: "directly accesses database orders_db",
  severity: "error",
  sourceLocation: {
    file: "/abs/arch.puml",
    start: { line: 13, col: 1, offset: 200 },
    end: { line: 13, col: 37, offset: 236 },
  },
};

describe("checkSarifAdapter — top-level shape", () => {
  it("emits SARIF v2.1.0 with informationUri and aactVersion from envelope meta", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    expect(log.runs).toHaveLength(1);
    const driver = log.runs[0].tool.driver;
    expect(driver.name).toBe("aact");
    expect(driver.version).toBe("3.0.0-test");
    expect(driver.informationUri).toContain("github.com/Byndyusoft/aact");
  });

  it("lists every built-in rule in tool.driver.rules with description + helpUri", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    const rules = log.runs[0].tool.driver.rules ?? [];
    expect(rules).toHaveLength(ruleRegistry.length);
    const acl = rules.find((r) => r.id === "acl");
    expect(acl?.name).toBe("acl");
    expect(acl?.shortDescription?.text).toMatch(/ACL/);
    expect(acl?.helpUri).toContain("#acl");
  });
});

describe("checkSarifAdapter — results mapping", () => {
  it("maps a violation to a SARIF result with level=error and ruleIndex resolved", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    const [result] = log.runs[0].results;
    expect(result.ruleId).toBe("crud");
    expect(result.level).toBe("error");
    expect(result.ruleIndex).toBe(
      ruleRegistry.findIndex((r) => r.name === "crud"),
    );
    expect(result.message.text).toContain("orders");
    expect(result.message.text).toContain("orders_db");
  });

  it("encodes sourceLocation as a full physicalLocation.region", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    const region = log.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region).toEqual({
      startLine: 13,
      startColumn: 1,
      endLine: 13,
      endColumn: 37,
    });
  });

  it("uses artifactLocation.uri from the violation's sourceLocation.file", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    expect(
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
    ).toBe("/abs/arch.puml");
  });

  it("falls back to startLine=1 / uri='unknown' when violation has no sourceLocation", () => {
    const withoutLoc: CheckViolation = {
      ruleId: "acl",
      target: "svc",
      targetKind: "element",
      message: "no location",
      severity: "error",
    };
    const log = checkSarifAdapter(envelopeWith([withoutLoc]));
    const [result] = log.runs[0].results;
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "unknown",
    );
    expect(result.locations[0].physicalLocation.region).toEqual({
      startLine: 1,
    });
  });

  it("carries targetKind into properties for boundary-level violations", () => {
    const boundaryViolation: CheckViolation = {
      ...baseViolation,
      ruleId: "cohesion",
      target: "checkout",
      targetKind: "boundary",
      message: "boundary coupling > cohesion",
    };
    const log = checkSarifAdapter(envelopeWith([boundaryViolation]));
    expect(log.runs[0].results[0].properties).toEqual({
      targetKind: "boundary",
    });
  });

  it("omits ruleIndex for unknown (custom-rule) ids but keeps ruleId", () => {
    const customViolation: CheckViolation = {
      ...baseViolation,
      ruleId: "acmeBcIsolation",
    };
    const log = checkSarifAdapter(envelopeWith([customViolation]));
    const [result] = log.runs[0].results;
    expect(result.ruleId).toBe("acmeBcIsolation");
    expect(result.ruleIndex).toBeUndefined();
  });

  it("emits a stable partialFingerprint (rule+target+message hashed, location-agnostic)", () => {
    // Pin: shifting the source location must NOT change the fingerprint.
    // GitHub Code Scanning uses fingerprints to keep alerts continuous
    // across edits.
    const moved: CheckViolation = {
      ...baseViolation,
      sourceLocation: {
        file: "/abs/arch.puml",
        start: { line: 99, col: 1, offset: 9000 },
        end: { line: 99, col: 37, offset: 9036 },
      },
    };
    const a = checkSarifAdapter(envelopeWith([baseViolation]));
    const b = checkSarifAdapter(envelopeWith([moved]));
    expect(a.runs[0].results[0].partialFingerprints).toEqual(
      b.runs[0].results[0].partialFingerprints,
    );
  });

  it("returns an empty results[] when there are no violations", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    expect(log.runs[0].results).toEqual([]);
  });
});

describe("checkSarifAdapter — repo-relative artifact URIs", () => {
  it("declares originalUriBaseIds.SRCROOT pointing at the cwd", () => {
    const log = checkSarifAdapter(envelopeWith([]));
    const base = log.runs[0].originalUriBaseIds?.SRCROOT;
    expect(base).toBeDefined();
    expect(base?.uri).toMatch(/^file:\/\/\//);
    expect(base?.uri.endsWith("/")).toBe(true);
  });

  it("relativizes paths inside cwd and tags them with uriBaseId=SRCROOT", () => {
    const insideCwd: CheckViolation = {
      ...baseViolation,
      sourceLocation: {
        file: `${process.cwd()}/architecture.puml`,
        start: { line: 1, col: 1, offset: 0 },
        end: { line: 1, col: 1, offset: 0 },
      },
    };
    const log = checkSarifAdapter(envelopeWith([insideCwd]));
    const artifact =
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    expect(artifact.uri).toBe("architecture.puml");
    expect(artifact.uriBaseId).toBe("SRCROOT");
  });

  it("keeps absolute paths absolute when source lives outside cwd (no uriBaseId)", () => {
    // baseViolation.sourceLocation.file = "/abs/arch.puml" — outside cwd
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    const artifact =
      log.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    expect(artifact.uri).toBe("/abs/arch.puml");
    expect(artifact.uriBaseId).toBeUndefined();
  });

  it("encodes SRCROOT via pathToFileURL (handles spaces / non-ascii / windows drive)", () => {
    // Naive `file://${root}` would emit `file:///path with spaces/` —
    // technically invalid (spaces are not URI-safe). `pathToFileURL`
    // percent-encodes correctly. We assert the URI starts with `file://`
    // and contains no literal space character.
    const log = checkSarifAdapter(envelopeWith([]));
    const base = log.runs[0].originalUriBaseIds?.SRCROOT;
    expect(base?.uri).toMatch(/^file:\/\//);
    expect(base?.uri).not.toMatch(/ /);
  });
});

describe("checkSarifAdapter — relatedLocations mapping", () => {
  it("maps Violation.relatedLocations to SarifResult.relatedLocations with messages", () => {
    const v: CheckViolation = {
      ...baseViolation,
      relatedLocations: [
        {
          sourceLocation: {
            file: "/abs/arch.puml",
            start: { line: 30, col: 1, offset: 600 },
            end: { line: 30, col: 25, offset: 624 },
          },
          message: "accessor: orders_repo",
        },
      ],
    };
    const log = checkSarifAdapter(envelopeWith([v]));
    const related = log.runs[0].results[0].relatedLocations;
    expect(related).toBeDefined();
    expect(related).toHaveLength(1);
    expect(related?.[0].physicalLocation.region).toEqual({
      startLine: 30,
      startColumn: 1,
      endLine: 30,
      endColumn: 25,
    });
    expect(related?.[0].message?.text).toBe("accessor: orders_repo");
  });

  it("omits relatedLocations on the SARIF result when none are present on the violation", () => {
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    expect(log.runs[0].results[0].relatedLocations).toBeUndefined();
  });

  it("renders a related location without `message` as a physicalLocation-only SARIF location", () => {
    const v: CheckViolation = {
      ...baseViolation,
      relatedLocations: [
        {
          sourceLocation: {
            file: "/abs/arch.puml",
            start: { line: 40, col: 1, offset: 800 },
            end: { line: 40, col: 10, offset: 809 },
          },
        },
      ],
    };
    const log = checkSarifAdapter(envelopeWith([v]));
    const [related] = log.runs[0].results[0].relatedLocations ?? [];
    expect(related?.message).toBeUndefined();
    expect(related?.physicalLocation.region?.startLine).toBe(40);
  });
});

describe("checkSarifAdapter — partialFingerprints", () => {
  it("emits both primaryLocationLineHash and aactViolationHash with the same value", () => {
    // `primaryLocationLineHash` is the conventional key GitHub Code
    // Scanning uses for alert deduplication. `aactViolationHash` is
    // our namespaced sibling for multi-tool SARIF workflows.
    const log = checkSarifAdapter(envelopeWith([baseViolation]));
    const fp = log.runs[0].results[0].partialFingerprints;
    expect(fp).toBeDefined();
    expect(fp?.primaryLocationLineHash).toBeDefined();
    expect(fp?.aactViolationHash).toBeDefined();
    expect(fp?.primaryLocationLineHash).toBe(fp?.aactViolationHash);
  });

  it("partialFingerprints stay stable across runs (deterministic on same input)", () => {
    const a = checkSarifAdapter(envelopeWith([baseViolation]));
    const b = checkSarifAdapter(envelopeWith([baseViolation]));
    expect(a.runs[0].results[0].partialFingerprints).toEqual(
      b.runs[0].results[0].partialFingerprints,
    );
  });
});
