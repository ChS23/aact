import { loadConfig } from "c12";
import { runCommand } from "citty";

import {
  executeRuleExplain,
  executeRuleList,
  renderRuleExplainText,
  renderRuleListText,
  rule,
} from "../../src/cli/commands/rule";
import { buildEnvelope } from "../../src/cli/output";
import { defineRule } from "../../src/rules/types";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

const mockLoadConfig = vi.mocked(loadConfig);

const mockNoConfig = (): void => {
  mockLoadConfig.mockResolvedValue({} as never);
};

const mockConfig = (config: Record<string, unknown>): void => {
  mockLoadConfig.mockResolvedValue({ config });
};

describe("executeRuleList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all built-ins as disabled (opt-in) when no config", async () => {
    mockNoConfig();
    const result = await executeRuleList({});

    expect(result.exitCode).toBe(0);
    expect(result.data.rules.length).toBeGreaterThan(0);
    expect(result.data.rules.every((r) => r.source === "built-in")).toBe(true);
    // Built-in rules are opt-in: silent until named in config.rules.
    expect(result.data.rules.every((r) => !r.enabled)).toBe(true);
    expect(result.data.summary.enabled).toBe(0);
  });

  it("marks a built-in enabled when config opts it in", async () => {
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      rules: { crud: true, acl: { tag: "acl" } },
    });
    const result = await executeRuleList({});
    const byName = (n: string) => result.data.rules.find((r) => r.ruleId === n);
    // `true` and an options object both opt a built-in in; unmentioned stays off.
    expect(byName("crud")?.enabled).toBe(true);
    expect(byName("acl")?.enabled).toBe(true);
    expect(byName("cohesion")?.enabled).toBe(false);
  });

  it("includes custom rules from config alongside built-ins", async () => {
    const myRule = defineRule({
      name: "noLegacy",
      description: "no legacy tag allowed",
      check: () => [],
    });
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      customRules: [myRule],
    });

    const result = await executeRuleList({});

    const noLegacy = result.data.rules.find((r) => r.ruleId === "noLegacy");
    expect(noLegacy).toBeDefined();
    expect(noLegacy?.source).toBe("custom");
    expect(noLegacy?.enabled).toBe(true);
    expect(noLegacy?.hasFix).toBe(false);
  });

  it("marks rule as disabled via rules.<name>: false", async () => {
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      rules: { acl: false },
    });

    const result = await executeRuleList({});

    const acl = result.data.rules.find((r) => r.ruleId === "acl");
    expect(acl?.enabled).toBe(false);
  });

  it("marks rule with fix capability as hasFix: true", async () => {
    mockNoConfig();
    const result = await executeRuleList({});
    const acl = result.data.rules.find((r) => r.ruleId === "acl");
    expect(acl?.hasFix).toBe(true);
  });

  it("propagates ToolError for broken config (no silent fallback)", async () => {
    mockConfig({
      source: { type: "not-a-known-format", path: "x.puml" },
    });
    await expect(executeRuleList({})).rejects.toMatchObject({
      name: "ToolError",
    });
  });

  it("falls back to built-ins on missing config (empty c12 result)", async () => {
    mockLoadConfig.mockResolvedValue({ config: {} });
    const result = await executeRuleList({});
    expect(result.exitCode).toBe(0);
    expect(result.data.rules.every((r) => r.source === "built-in")).toBe(true);
  });
});

describe("renderRuleListText", () => {
  const captureSink = (): {
    sink: NodeJS.WritableStream;
    output: () => string;
  } => {
    const chunks: Buffer[] = [];
    const sink: Partial<NodeJS.WritableStream> = {
      write: (chunk: string | Uint8Array) => {
        chunks.push(Buffer.from(chunk));
        return true;
      },
    };
    return {
      sink: sink as NodeJS.WritableStream,
      output: () => Buffer.concat(chunks).toString("utf8"),
    };
  };

  it("renders both Built-in and Custom groups", () => {
    const { sink, output } = captureSink();
    renderRuleListText(
      buildEnvelope({
        command: "rule list",
        exitCode: 0,
        data: {
          rules: [
            {
              ruleId: "acl",
              description: "ACL",
              source: "built-in",
              enabled: true,
              hasFix: true,
            },
            {
              ruleId: "noLegacy",
              description: "no legacy",
              source: "custom",
              enabled: true,
              hasFix: false,
            },
          ],
          summary: { enabled: 2, total: 2 },
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );

    const text = output();
    expect(text).toContain("Built-in");
    expect(text).toContain("acl");
    expect(text).toContain("Custom");
    expect(text).toContain("noLegacy");
    expect(text).toContain("2/2 rules enabled");
  });

  it("skips Custom group when no custom rules present", () => {
    const { sink, output } = captureSink();
    renderRuleListText(
      buildEnvelope({
        command: "rule list",
        exitCode: 0,
        data: {
          rules: [
            {
              ruleId: "acl",
              description: "ACL",
              source: "built-in",
              enabled: true,
              hasFix: true,
            },
          ],
          summary: { enabled: 1, total: 1 },
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );

    const text = output();
    expect(text).toContain("Built-in");
    expect(text).not.toContain("Custom");
  });
});

describe("executeRuleExplain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rationale, examples and ADR path for a built-in rule", async () => {
    mockNoConfig();
    const result = await executeRuleExplain({ _: ["crud"] });
    expect(result.exitCode).toBe(0);
    expect(result.data.ruleId).toBe("crud");
    expect(result.data.source).toBe("built-in");
    // Built-in rules are opt-in — with no config crud is disabled, but
    // `rule explain` still surfaces its rationale/examples/ADR.
    expect(result.data.enabled).toBe(false);
    expect(result.data.hasFix).toBe(true);
    expect(result.data.rationale).toMatch(/repo/i);
    expect(result.data.examples?.length).toBeGreaterThanOrEqual(2);
    expect(result.data.examples?.some((e) => e.label === "good")).toBe(true);
    expect(result.data.examples?.some((e) => e.label === "bad")).toBe(true);
    expect(result.data.adrPath).toBe("ADRs/Database per CRUD-service.md");
    // helpUri points at the rule's ADR on GitHub (encoded path).
    // The README-anchor form (`#crud`) was a dead link.
    expect(result.data.helpUri).toBe(
      "https://github.com/Byndyusoft/aact/blob/main/ADRs/Database%20per%20CRUD-service.md",
    );
  });

  it("marks enabled=false when config disables the rule", async () => {
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      rules: { acyclic: false },
    });
    const result = await executeRuleExplain({ _: ["acyclic"] });
    expect(result.data.enabled).toBe(false);
  });

  it("returns custom-rule metadata when the rule comes from config.customRules", async () => {
    const myRule = defineRule({
      name: "noLegacy",
      description: "Containers must not carry legacy tag",
      rationale: "Legacy tag marks deprecated code; surface it in linting.",
      examples: [
        { label: "bad", source: 'Container(x, "X", $tags="legacy")' },
        { label: "good", source: 'Container(x, "X")' },
      ],
      check: () => [],
    });
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      customRules: [myRule],
    });
    const result = await executeRuleExplain({ _: ["noLegacy"] });
    expect(result.data.source).toBe("custom");
    expect(result.data.rationale).toMatch(/legacy/i);
    // Custom rules don't get the upstream helpUri.
    expect(result.data.helpUri).toBeUndefined();
  });

  it("throws a tool error when no rule name is given", async () => {
    mockNoConfig();
    await expect(executeRuleExplain({ _: [] })).rejects.toMatchObject({
      kind: "config.invalidSchema",
    });
  });

  it("throws config.unknownRule for an unknown name and lists known rules", async () => {
    mockNoConfig();
    await expect(
      executeRuleExplain({ _: ["doesNotExist"] }),
    ).rejects.toMatchObject({
      kind: "config.unknownRule",
    });
  });

  it("appends config custom-rule names to the known-rules list in the unknown error", async () => {
    // Custom rules registered in config must surface in the
    // "Known rules: …" hint so users discover their own rules.
    const myRule = defineRule({
      name: "noLegacy",
      description: "no legacy tag",
      check: () => [],
    });
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      customRules: [myRule],
    });
    await expect(
      executeRuleExplain({ _: ["doesNotExist"] }),
    ).rejects.toMatchObject({
      kind: "config.unknownRule",
      message: expect.stringContaining("noLegacy"),
    });
  });

  it("omits optional fields from envelope when the rule has no rationale/examples/adr", async () => {
    const minimal = defineRule({
      name: "minimal",
      description: "no extras",
      check: () => [],
    });
    mockConfig({
      source: { type: "plantuml", path: "x.puml" },
      customRules: [minimal],
    });
    const result = await executeRuleExplain({ _: ["minimal"] });
    expect(result.data.rationale).toBeUndefined();
    expect(result.data.examples).toBeUndefined();
    expect(result.data.adrPath).toBeUndefined();
  });
});

describe("renderRuleExplainText", () => {
  const captureSink = (): {
    sink: NodeJS.WritableStream;
    output: () => string;
  } => {
    let captured = "";
    const sink = {
      write: (chunk: string): boolean => {
        captured += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    return { sink, output: () => captured };
  };

  it("renders rationale, examples (with good/bad markers) and ADR section", () => {
    const { sink, output } = captureSink();
    renderRuleExplainText(
      buildEnvelope({
        command: "rule explain",
        exitCode: 0,
        data: {
          ruleId: "crud",
          description: "DB only through repo",
          source: "built-in",
          enabled: true,
          hasFix: true,
          rationale: "Why this rule.",
          examples: [
            { label: "bad", source: "Rel(a, db)", note: "direct access" },
            { label: "good", source: "Rel(a, repo)" },
          ],
          adrPath: "ADRs/Database per CRUD-service.md",
          helpUri:
            "https://github.com/Byndyusoft/aact/blob/main/ADRs/Database%20per%20CRUD-service.md",
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );
    const text = output();
    expect(text).toContain("crud");
    expect(text).toContain("Why this rule.");
    expect(text).toContain("bad");
    expect(text).toContain("good");
    expect(text).toContain("Rel(a, db)");
    expect(text).toContain("ADRs/Database per CRUD-service.md");
    expect(text).toContain(
      "github.com/Byndyusoft/aact/blob/main/ADRs/Database%20per%20CRUD-service.md",
    );
  });

  it("omits sections that have no data", () => {
    const { sink, output } = captureSink();
    renderRuleExplainText(
      buildEnvelope({
        command: "rule explain",
        exitCode: 0,
        data: {
          ruleId: "minimal",
          description: "no extras",
          source: "custom",
          enabled: true,
          hasFix: false,
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );
    const text = output();
    expect(text).not.toContain("Rationale");
    expect(text).not.toContain("Examples");
    expect(text).not.toContain("ADR");
    expect(text).not.toContain("See also");
  });

  it("word-wraps a long rationale across multiple lines", () => {
    // Each word is short, but together they exceed the 78-col wrap
    // width — exercising the wrap branch in `wrapPrefixed`. The full
    // rationale must survive (no words dropped) split over >1 line.
    const longRationale = Array.from({ length: 30 }, (_, i) => `word${i}`).join(
      " ",
    );
    const { sink, output } = captureSink();
    renderRuleExplainText(
      buildEnvelope({
        command: "rule explain",
        exitCode: 0,
        data: {
          ruleId: "wrappy",
          description: "wraps",
          source: "built-in",
          enabled: true,
          hasFix: false,
          rationale: longRationale,
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );
    const text = output();
    expect(text).toContain("Rationale");
    // First and last words both present despite the wrap.
    expect(text).toContain("word0");
    expect(text).toContain("word29");
    // The rationale body spans more than a single rendered line.
    const rationaleBody = text.slice(text.indexOf("Rationale"));
    const wrappedLines = rationaleBody
      .split("\n")
      .filter((l) => l.includes("word"));
    expect(wrappedLines.length).toBeGreaterThan(1);
  });

  it("word-wraps a long example note across multiple lines", () => {
    const longNote = Array.from({ length: 30 }, (_, i) => `note${i}`).join(" ");
    const { sink, output } = captureSink();
    renderRuleExplainText(
      buildEnvelope({
        command: "rule explain",
        exitCode: 0,
        data: {
          ruleId: "notey",
          description: "notes",
          source: "built-in",
          enabled: true,
          hasFix: false,
          examples: [{ label: "bad", source: "Rel(a, db)", note: longNote }],
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );
    const text = output();
    expect(text).toContain("note0");
    expect(text).toContain("note29");
    const noteLines = text.split("\n").filter((l) => l.includes("note"));
    expect(noteLines.length).toBeGreaterThan(1);
  });
});

describe("rule command (citty subcommand dispatch)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  const capturedStdout = (): string =>
    stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");

  it("`rule list` renders the built-in rule table and exits 0", async () => {
    mockNoConfig();
    await runCommand(rule, { rawArgs: ["list"] });
    expect(exitSpy).toHaveBeenCalledWith(0);
    const out = capturedStdout();
    expect(out).toContain("Built-in");
    expect(out).toContain("rules enabled");
  });

  it("`rule explain <name>` renders a built-in rule's rationale and exits 0", async () => {
    mockNoConfig();
    await runCommand(rule, { rawArgs: ["explain", "crud"] });
    expect(exitSpy).toHaveBeenCalledWith(0);
    const out = capturedStdout();
    expect(out).toContain("crud");
    expect(out).toContain("Rationale");
  });

  it("`rule explain <unknown>` surfaces the unknown-rule error and exits 2", async () => {
    mockNoConfig();
    await runCommand(rule, { rawArgs: ["explain", "doesNotExist"] });
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
