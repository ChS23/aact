import { loadConfig } from "c12";

import { executeCheck } from "../../src/cli/commands/check";
import { loadAndValidateConfig } from "../../src/cli/loadConfig";
import { loadModel } from "../../src/cli/loadModel";
import type { AactConfig } from "../../src/config";
import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { loadFormat } from "../../src/formats/registry";
import type { Format } from "../../src/formats/types";
import type { Model } from "../../src/model";
import type { RuleDefinition } from "../../src/rules/types";
import { defineRule } from "../../src/rules/types";
import { makeModel } from "../helpers/makeModel";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../src/cli/loadModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/cli/loadModel")
  >("../../src/cli/loadModel");
  return {
    ...actual,
    loadModel: vi.fn(),
  };
});

vi.mock("../../src/formats/registry", () => ({
  loadFormat: vi.fn(),
  knownFormatNames: () => ["plantuml", "structurizr", "kubernetes"],
}));

const mockLoadConfig = vi.mocked(loadConfig);
const mockLoadModel = vi.mocked(loadModel);
const mockLoadFormat = vi.mocked(loadFormat);

const fakeFormat = (name = "plantuml"): Format => ({
  name,
  load: vi.fn(),
  fix: { syntax: plantumlSyntax },
});

const cleanModel = (): Model =>
  makeModel({
    elements: [{ name: "svc_a" }, { name: "svc_b" }],
    boundaries: [{ name: "project", elementNames: ["svc_a", "svc_b"] }],
  });

const taggedModel = (): Model =>
  makeModel({
    elements: [{ name: "svc_a", tags: ["legacy"] }, { name: "svc_b" }],
    boundaries: [{ name: "project", elementNames: ["svc_a", "svc_b"] }],
  });

interface LegacyTagOptions {
  readonly tag?: string;
}

// Custom rule: container с тэгом "legacy" не разрешён
const noLegacyRule = defineRule({
  name: "noLegacy",
  description: "Containers must not carry legacy tag",
  check(model: Model, options?: LegacyTagOptions) {
    const tag = options?.tag ?? "legacy";
    return Object.values(model.elements)
      .filter((c) => c.tags.includes(tag))
      .map((c) => ({
        target: c.name,
        targetKind: "element" as const,
        message: `tagged "${tag}"`,
      }));
  },
});

// Custom rule с fix capability
const noLegacyWithFixRule = defineRule({
  name: "noLegacyFix",
  description: "Containers must not carry legacy tag (with fix)",
  check(model: Model, options?: LegacyTagOptions) {
    const tag = options?.tag ?? "legacy";
    return Object.values(model.elements)
      .filter((c) => c.tags.includes(tag))
      .map((c) => ({
        target: c.name,
        targetKind: "element" as const,
        message: `tagged "${tag}"`,
      }));
  },
  fix({ violations }) {
    return violations.map((v) => ({
      ruleId: "noLegacyFix",
      description: `Remove legacy tag from ${v.target}`,
      edits: [],
    }));
  },
});

const setupConfig = (config: Record<string, unknown>): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: { type: "plantuml", path: "test.puml" },
      ...config,
    },
  });
};

const buildConfig = (overrides: Partial<AactConfig> = {}): AactConfig => ({
  source: { type: "plantuml", path: "test.puml" },
  ...overrides,
});

describe("defineRule", () => {
  it("returns the same rule object (identity)", () => {
    const rule: RuleDefinition = {
      name: "x",
      description: "y",
      check: () => [],
    };
    expect(defineRule(rule)).toBe(rule);
  });
});

describe("loadAndValidateConfig — customRules shape validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts valid customRules array", async () => {
    setupConfig({ customRules: [noLegacyRule] });
    const { config } = await loadAndValidateConfig();
    expect(config.customRules).toHaveLength(1);
    expect(config.customRules?.[0]?.name).toBe("noLegacy");
  });

  it("throws when customRules entry missing name", async () => {
    setupConfig({
      customRules: [{ description: "d", check: () => [] }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/missing "name"/);
  });

  it("throws when customRules entry has empty name", async () => {
    setupConfig({
      customRules: [{ name: "", description: "d", check: () => [] }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/missing "name"/);
  });

  it("throws when customRules entry missing description", async () => {
    setupConfig({
      customRules: [{ name: "x", check: () => [] }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/description/);
  });

  it("throws when customRules entry missing check", async () => {
    setupConfig({
      customRules: [{ name: "x", description: "d" }],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/check/);
  });

  it("throws when customRules entry has non-function fix", async () => {
    setupConfig({
      customRules: [
        { name: "x", description: "d", check: () => [], fix: "not a fn" },
      ],
    });
    await expect(loadAndValidateConfig()).rejects.toThrow(/fix/);
  });

  it("throws when customRules entry is not an object", async () => {
    setupConfig({ customRules: ["string-not-object"] });
    await expect(loadAndValidateConfig()).rejects.toThrow(/RuleDefinition/);
  });

  it("accepts looseObject extra keys in rules (for custom rule names)", async () => {
    setupConfig({
      customRules: [noLegacyRule],
      rules: { noLegacy: { tag: "legacy" } },
    });
    const { config } = await loadAndValidateConfig();
    expect(config.rules).toBeDefined();
  });
});

describe("executeCheck — customRules integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFormat.mockResolvedValue(fakeFormat());
  });

  it("runs custom rule and reports violations", async () => {
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });

    const result = await executeCheck(
      buildConfig({ customRules: [noLegacyRule] }),
      {},
    );

    expect(result.exitCode).toBe(1);
    const noLegacy = result.data.violations.find(
      (v) => v.ruleId === "noLegacy",
    );
    expect(noLegacy).toBeDefined();
    expect(noLegacy?.target).toBe("svc_a");
  });

  it("auto-enables customRules without rules.<name> entry", async () => {
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });

    const result = await executeCheck(
      buildConfig({ customRules: [noLegacyRule] }),
      {},
    );

    expect(result.data.violations.some((v) => v.ruleId === "noLegacy")).toBe(
      true,
    );
  });

  it("disables custom rule via rules.<name>: false", async () => {
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });

    const result = await executeCheck(
      buildConfig({
        customRules: [noLegacyRule],
        rules: { noLegacy: false, acl: false, acyclic: false },
      }),
      {},
    );

    expect(result.data.violations.some((v) => v.ruleId === "noLegacy")).toBe(
      false,
    );
  });

  it("passes options from rules.<name> to custom rule check", async () => {
    const captured: { tag?: string }[] = [];
    const captureRule = defineRule({
      name: "captureTag",
      description: "captures options",
      check(_model: Model, options?: { tag?: string }) {
        captured.push(options ?? {});
        return [];
      },
    });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    await executeCheck(
      buildConfig({
        customRules: [captureRule],
        rules: { captureTag: { tag: "deprecated" } },
      }),
      {},
    );

    expect(captured[0]?.tag).toBe("deprecated");
  });

  it("throws when custom rule name collides with built-in", async () => {
    const collide = defineRule({
      name: "acl",
      description: "collides",
      check: () => [],
    });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    await expect(
      executeCheck(buildConfig({ customRules: [collide] }), {}),
    ).rejects.toThrow(/conflicts with existing built-in/);
  });

  it("throws when two customRules share name", async () => {
    const a = defineRule({ name: "dup", description: "a", check: () => [] });
    const b = defineRule({ name: "dup", description: "b", check: () => [] });
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    await expect(
      executeCheck(buildConfig({ customRules: [a, b] }), {}),
    ).rejects.toThrow(/conflicts with existing custom/);
  });

  it("emits config.unknownRule diagnostic for unknown rule names", async () => {
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    const result = await executeCheck(
      buildConfig({ rules: { typoRule: true } }),
      {},
    );

    expect(
      result.diagnostics?.some(
        (d) =>
          d.kind === "config.unknownRule" && d.message.includes('"typoRule"'),
      ),
    ).toBe(true);
  });

  it("does not emit unknownRule diagnostic when entry IS a customRule", async () => {
    mockLoadModel.mockResolvedValue({ model: cleanModel(), issues: [] });

    const result = await executeCheck(
      buildConfig({
        customRules: [noLegacyRule],
        rules: { noLegacy: { tag: "legacy" } },
      }),
      {},
    );

    expect(
      result.diagnostics?.some(
        (d) =>
          d.kind === "config.unknownRule" && d.message.includes('"noLegacy"'),
      ),
    ).toBe(false);
  });

  it("collects fixes from custom rule with fix capability in dry-run", async () => {
    mockLoadModel.mockResolvedValue({ model: taggedModel(), issues: [] });

    const result = await executeCheck(
      buildConfig({ customRules: [noLegacyWithFixRule] }),
      { "dry-run": true },
    );

    expect(
      result.data.suggestedFixes.some((f) => f.ruleId === "noLegacyFix"),
    ).toBe(true);
    expect(result.data.mode).toBe("dry-run");
  });
});
