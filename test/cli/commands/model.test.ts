import { PassThrough } from "node:stream";

import { executeModel, renderModelText } from "../../../src/cli/commands/model";
import { loadModel } from "../../../src/cli/loadModel";
import { buildEnvelope } from "../../../src/cli/output";
import type { AactConfig } from "../../../src/config";
import type { Model, ModelIssue } from "../../../src/model";
import { makeModel } from "../../helpers/makeModel";
import { stripAnsi } from "../../helpers/stripAnsi";

vi.mock("../../../src/cli/loadModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/cli/loadModel")
  >("../../../src/cli/loadModel");
  return {
    ...actual,
    loadModel: vi.fn(),
  };
});

const mockLoadModel = vi.mocked(loadModel);

const config: AactConfig = {
  source: { type: "plantuml", path: "test.puml" },
};

const flatModel = (): Model =>
  makeModel({
    elements: [
      { name: "svc_a", relations: [{ to: "svc_b", technology: "http" }] },
      { name: "svc_b", relations: [{ to: "orders_db", technology: "tcp" }] },
      { name: "orders_db", kind: "ContainerDb" },
    ],
    boundaries: [
      {
        name: "checkout",
        kind: "System",
        elementNames: ["svc_a", "svc_b", "orders_db"],
      },
    ],
  });

const nestedModel = (): Model =>
  makeModel({
    elements: [{ name: "leaf_svc" }],
    boundaries: [
      { name: "outer", kind: "System", boundaryNames: ["inner"] },
      { name: "inner", kind: "Container", elementNames: ["leaf_svc"] },
    ],
    rootBoundaryNames: ["outer"],
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
    output: () => Buffer.concat(chunks).toString("utf8"),
  };
};

describe("executeModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ModelData with the loaded Model and issues", async () => {
    const model = flatModel();
    mockLoadModel.mockResolvedValue({ model, issues: [] });

    const result = await executeModel(config);

    expect(result.exitCode).toBe(0);
    expect(result.data.model).toBe(model);
    expect(result.data.issues).toEqual([]);
  });

  it("propagates loader issues as data.issues and maps them to diagnostics", async () => {
    const issues: ModelIssue[] = [
      { kind: "dangling-relation", from: "svc_a", to: "ghost" },
      { kind: "unknown-kind", element: "weird", raw: "Mystery" },
    ];
    mockLoadModel.mockResolvedValue({ model: flatModel(), issues });

    const result = await executeModel(config);

    expect(result.data.issues).toEqual(issues);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics?.[0]).toMatchObject({
      kind: "model.danglingRelation",
      severity: "warning",
    });
    expect(result.diagnostics?.[1]).toMatchObject({
      kind: "model.unknownKind",
      severity: "warning",
    });
  });

  it("returns exitCode 0 even with loader issues (model command never fails)", async () => {
    // `aact model` is read-only inspection — issues are surfaced but
    // never gate the exit code, otherwise agents can't introspect a
    // broken model to diagnose what's wrong.
    mockLoadModel.mockResolvedValue({
      model: flatModel(),
      issues: [{ kind: "self-relation", element: "svc_a" }],
    });

    const result = await executeModel(config);

    expect(result.exitCode).toBe(0);
  });
});

describe("renderModelText", () => {
  const renderEnvelope = (
    model: Model,
    issues: readonly ModelIssue[] = [],
  ): string => {
    const envelope = buildEnvelope({
      command: "model",
      exitCode: 0,
      data: { model, issues },
      meta: { durationMs: 1, configPath: null, source: "arch.puml" },
    });
    const { sink, output } = captureSink();
    renderModelText(envelope, sink);
    // ANSI bold/dim escapes from consola wrap labels mid-token (e.g.
    // `[1mBoundaries: [22m2`) when running where colour is auto-detected
    // (CI's GITHUB_ACTIONS or a real TTY). Strip at the assertion boundary
    // so the SUT keeps its production styling.
    return stripAnsi(output());
  };

  it("prints element counts grouped by kind", () => {
    const out = renderEnvelope(flatModel());
    expect(out).toContain("Elements: 3");
    expect(out).toMatch(/Container\s+2/);
    expect(out).toMatch(/ContainerDb\s+1/);
  });

  it("prints the boundary tree with nested children indented", () => {
    const out = renderEnvelope(nestedModel());
    expect(out).toContain("Boundaries: 2");
    // Outer boundary at indent 2, inner nested at indent 4.
    expect(out).toMatch(/^ {2}outer/m);
    expect(out).toMatch(/^ {4}inner/m);
  });

  it("prints the relation count summed across elements", () => {
    const out = renderEnvelope(flatModel());
    expect(out).toContain("Relations: 2");
  });

  it("prints workspace metadata when present (Structurizr models)", () => {
    const model = flatModel();
    const withWorkspace: Model = {
      ...model,
      workspace: {
        name: "Checkout system",
        description: "Demo workspace",
      },
    };
    const out = renderEnvelope(withWorkspace);
    expect(out).toContain("Workspace:");
    expect(out).toContain("Checkout system");
    expect(out).toContain("Demo workspace");
  });

  it("omits the Workspace section when model.workspace is undefined", () => {
    const out = renderEnvelope(flatModel());
    expect(out).not.toContain("Workspace:");
  });

  it("prints the workspace extends target when present", () => {
    const model = flatModel();
    const extending: Model = {
      ...model,
      workspace: { extendsTarget: "shared/base.dsl" },
    };
    const out = renderEnvelope(extending);
    expect(out).toContain("Workspace:");
    expect(out).toContain("shared/base.dsl");
  });

  it("skips dangling boundary references in the tree without crashing", () => {
    // rootBoundary lists a child boundary that isn't in model.boundaries —
    // possible during a loader bug or partial reads. Tree renderer must
    // tolerate it silently (the missing-boundary issue is surfaced
    // separately as a ModelIssue).
    const model: Model = {
      ...nestedModel(),
      boundaries: {
        outer: nestedModel().boundaries.outer,
        // `inner` deliberately absent — outer.boundaryNames still
        // references it.
      },
      rootBoundaryNames: ["outer"],
    };
    const out = renderEnvelope(model);
    expect(out).toContain("outer");
    expect(out).not.toContain("inner");
  });

  it("surfaces a loader-issues banner when issues is non-empty", () => {
    const out = renderEnvelope(flatModel(), [
      { kind: "self-relation", element: "svc_a" },
    ]);
    expect(out).toContain("Loader issues: 1");
  });

  it("does not surface the loader-issues banner when issues is empty", () => {
    const out = renderEnvelope(flatModel());
    expect(out).not.toContain("Loader issues:");
  });
});
