import { PassThrough } from "node:stream";

import type { AnalyzeData } from "../../src/cli/commands/analyze";
import {
  executeAnalyze,
  renderAnalyzeText,
} from "../../src/cli/commands/analyze";
import { loadModel } from "../../src/cli/loadModel";
import { buildEnvelope } from "../../src/cli/output";
import type { AactConfig } from "../../src/config";
import { makeModel } from "../helpers/makeModel";
import { stripAnsi } from "../helpers/stripAnsi";

vi.mock("../../src/cli/loadModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/cli/loadModel")
  >("../../src/cli/loadModel");
  return {
    ...actual,
    loadModel: vi.fn(),
  };
});

const mockLoadModel = vi.mocked(loadModel);

const config: AactConfig = {
  source: { type: "plantuml", path: "test.puml" },
};

const testModel = () =>
  makeModel({
    elements: [
      { name: "orders_db", label: "DB", kind: "ContainerDb" },
      {
        name: "svc_a",
        label: "Service A",
        relations: [{ to: "orders_db", technology: "tcp" }],
      },
    ],
    boundaries: [
      {
        name: "project",
        label: "Project",
        elementNames: ["svc_a", "orders_db"],
      },
    ],
  });

const captureSink = (): {
  sink: NodeJS.WritableStream;
  output: () => string;
} => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return {
    sink: stream,
    // Strip ANSI here so assertions are stable across local TTY / CI's
    // GITHUB_ACTIONS-driven colour. renderAnalyzeText uses consola
    // `colors.bold(...)` which leaks `[1m...[22m` mid-token.
    output: () => stripAnsi(Buffer.concat(chunks).toString("utf8")),
  };
};

describe("executeAnalyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AnalysisReport as data with exitCode 0", async () => {
    mockLoadModel.mockResolvedValue({ model: testModel(), issues: [] });

    const result = await executeAnalyze(config);

    expect(result.exitCode).toBe(0);
    expect(result.data).toHaveProperty("elementsCount");
    expect(result.data).toHaveProperty("elementsByKind");
    expect(result.data).toHaveProperty("relationsByStyle");
    expect(result.data).toHaveProperty("databases");
    expect(result.data).toHaveProperty("boundaries");
    expect(result.data).toHaveProperty("fanIn");
    expect(result.data).toHaveProperty("fanOut");
    expect(result.data).toHaveProperty("cycles");
  });

  it("plumbs config.analyze through to analyzeArchitecture", async () => {
    mockLoadModel.mockResolvedValue({
      model: makeModel({
        elements: [
          { name: "svc", relations: [{ to: "broker", technology: "Kafka" }] },
          { name: "broker" },
        ],
      }),
      issues: [],
    });

    const result = await executeAnalyze({
      ...config,
      analyze: { asyncTechnologies: ["kafka"] },
    });

    expect(result.data.relationsByStyle.async).toBe(1);
  });

  it("maps loader issues to diagnostics with stable kinds", async () => {
    mockLoadModel.mockResolvedValue({
      model: testModel(),
      issues: [
        { kind: "duplicate-element-name", name: "orders_db" },
        { kind: "self-relation", element: "svc_a" },
      ],
    });

    const result = await executeAnalyze(config);

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics?.[0]).toMatchObject({
      kind: "model.duplicateElementName",
      severity: "warning",
    });
    expect(result.diagnostics?.[1]).toMatchObject({
      kind: "model.selfRelation",
      severity: "warning",
    });
  });

  it("propagates ToolError from loadModel (source missing) unchanged", async () => {
    const { ToolError } = await import("../../src/cli/output");
    mockLoadModel.mockRejectedValue(
      new ToolError("model.sourceNotFound", "missing", { path: "x.puml" }),
    );

    await expect(executeAnalyze(config)).rejects.toMatchObject({
      kind: "model.sourceNotFound",
    });
  });
});

const sampleData: AnalyzeData = {
  elementsCount: 2,
  elementsByKind: { Container: 1, ContainerDb: 1 },
  databases: { count: 1, consumes: 1 },
  relationsByStyle: { sync: 1, async: 0, unspecified: 0 },
  boundaries: [
    {
      name: "project",
      label: "Project",
      cohesion: 0,
      coupling: 1,
      syncCoupling: 1,
      asyncCoupling: 0,
      unspecifiedCoupling: 0,
      ratio: 0,
      couplingRelations: [{ from: "svc_a", to: "external_x" }],
    },
  ],
  fanIn: [{ name: "orders_db", count: 1 }],
  fanOut: [{ name: "svc_a", count: 1 }],
  cycles: { count: 0, smallest: null },
};

describe("renderAnalyzeText", () => {
  const envelopeFor = (data: AnalyzeData) =>
    buildEnvelope({
      command: "analyze",
      exitCode: 0,
      data,
      meta: { durationMs: 5, configPath: null, source: "test.puml" },
    });

  it("prints element counts and per-kind breakdown", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(envelopeFor(sampleData), sink);
    const text = output();
    expect(text).toContain("Elements: 2");
    expect(text).toMatch(/Container\s+1/);
    expect(text).toMatch(/ContainerDb\s+1/);
  });

  it("prints databases and relations breakdown", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(envelopeFor(sampleData), sink);
    const text = output();
    expect(text).toContain("Databases: 1");
    expect(text).toContain("Relations: 1 (1 sync, 0 async, 0 unspecified)");
  });

  it("prints per-boundary cohesion / coupling / ratio with sync split", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(envelopeFor(sampleData), sink);
    const text = output();
    expect(text).toContain("Project");
    expect(text).toContain("cohesion=0");
    expect(text).toContain("coupling=1 (1 sync)");
    expect(text).toContain("ratio=0.00");
    expect(text).toContain("svc_a → external_x");
  });

  it("renders ratio=n/a when boundary has no edges", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(
      envelopeFor({
        ...sampleData,
        boundaries: [
          {
            ...sampleData.boundaries[0],
            cohesion: 0,
            coupling: 0,
            syncCoupling: 0,
            asyncCoupling: 0,
            unspecifiedCoupling: 0,
            ratio: null,
            couplingRelations: [],
          },
        ],
      }),
      sink,
    );
    expect(output()).toContain("ratio=n/a");
  });

  it("prints fan-out and fan-in hotspots tables", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(envelopeFor(sampleData), sink);
    const text = output();
    expect(text).toContain("Fan-out hotspots:");
    expect(text).toContain("svc_a");
    expect(text).toContain("Fan-in hotspots:");
    expect(text).toContain("orders_db");
  });

  it("omits hotspot sections when both lists are empty", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(
      envelopeFor({ ...sampleData, fanIn: [], fanOut: [] }),
      sink,
    );
    const text = output();
    expect(text).not.toContain("Fan-out hotspots:");
    expect(text).not.toContain("Fan-in hotspots:");
  });

  it("renders cycles count and a shortest example when present", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(
      envelopeFor({
        ...sampleData,
        cycles: { count: 1, smallest: ["a", "b"] },
      }),
      sink,
    );
    const text = output();
    expect(text).toContain("Cycles: 1");
    expect(text).toContain("shortest: a → b");
  });

  it("renders just `Cycles: 0` when no cycles exist", () => {
    const { sink, output } = captureSink();
    renderAnalyzeText(envelopeFor(sampleData), sink);
    expect(output()).toContain("Cycles: 0");
  });
});
