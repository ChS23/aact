import fs from "node:fs/promises";

import type { MockedFunction } from "vitest";

import type { GenerateData } from "../../src/cli/commands/generate";
import {
  executeGenerate,
  renderGenerateText,
} from "../../src/cli/commands/generate";
import { loadModel } from "../../src/cli/loadModel";
import { buildEnvelope } from "../../src/cli/output";
import type { AactConfig } from "../../src/config";
import type { Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

vi.mock("../../src/cli/loadModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/cli/loadModel")
  >("../../src/cli/loadModel");
  return { ...actual, loadModel: vi.fn() };
});

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
  },
}));

const mockLoadModel = vi.mocked(loadModel);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockMkdir = vi.mocked(fs.mkdir) as unknown as MockedFunction<
  () => Promise<void>
>;
const mockStat = vi.mocked(fs.stat) as unknown as MockedFunction<
  () => Promise<{ isDirectory: () => boolean }>
>;

const baseConfig: AactConfig = {
  source: { type: "plantuml", path: "test.puml" },
};

const setupModel = (model: Model): void => {
  mockLoadModel.mockResolvedValue({ model, issues: [] });
};

const captureStdout = (): { restore: () => void; output: () => string } => {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  };
  return {
    restore: () => {
      process.stdout.write = original;
    },
    output: () => chunks.join(""),
  };
};

describe("executeGenerate — plantuml (single-file)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams to stdout when no --output (UNIX default)", async () => {
    setupModel(makeModel({ elements: [{ name: "orders" }] }));
    const capture = captureStdout();
    try {
      const result = await executeGenerate(baseConfig, {});

      expect(result.exitCode).toBe(0);
      expect(result.stdoutClaimed).toBe(true);
      expect(result.data.outputSink).toBe("stdout");
      expect(result.data.outputPath).toBeNull();
      expect(capture.output()).toContain("@startuml");
    } finally {
      capture.restore();
    }
  });

  it("streams to stdout when --output - (explicit sentinel)", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));
    const capture = captureStdout();
    try {
      const result = await executeGenerate(baseConfig, { output: "-" });

      expect(result.exitCode).toBe(0);
      expect(result.stdoutClaimed).toBe(true);
      expect(result.data.outputSink).toBe("stdout");
    } finally {
      capture.restore();
    }
  });

  it("writes to file when --output path", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, { output: "out.puml" });

    expect(result.data.outputSink).toBe("file");
    expect(result.data.outputPath).toBe("out.puml");
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [filePath, content] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe("out.puml");
    expect(content as string).toContain("@startuml");
    expect(result.stdoutClaimed).toBeUndefined();
  });

  it("writes into the directory when --output has a trailing slash", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));
    mockStat.mockRejectedValue(new Error("ENOENT"));
    mockMkdir.mockResolvedValue();
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, { output: "./k8s/" });

    expect(result.data.outputSink).toBe("directory");
    expect(result.data.outputPath).toBe("./k8s/");
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [filePath] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe("k8s/architecture.puml");
  });

  it("writes into the directory when --output is an existing directory", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockMkdir.mockResolvedValue();
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, { output: "out" });

    expect(result.data.outputSink).toBe("directory");
    const [filePath] = mockWriteFile.mock.calls[0];
    expect(filePath).toBe("out/architecture.puml");
  });

  it("keeps file sink when --output is a non-existing plain path", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));
    mockStat.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, { output: "out.puml" });

    expect(result.data.outputSink).toBe("file");
    expect(result.data.outputPath).toBe("out.puml");
  });

  it("errors when --json + stdout sink would collide", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));

    await expect(
      executeGenerate(baseConfig, { json: true }),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "config.outputCollidesWithJson",
    });
  });

  it("errors when --json --output - (explicit stdout) collides", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));

    await expect(
      executeGenerate(baseConfig, { json: true, output: "-" }),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "config.outputCollidesWithJson",
    });
  });

  it("--json + --output <file> works without collision", async () => {
    setupModel(makeModel({ elements: [{ name: "svc" }] }));
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, {
      json: true,
      output: "x.puml",
    });

    expect(result.exitCode).toBe(0);
    expect(result.data.outputSink).toBe("file");
    expect(result.stdoutClaimed).toBeUndefined();
  });
});

describe("executeGenerate — kubernetes (multi-file)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes to directory via --output", async () => {
    setupModel(
      makeModel({
        elements: [
          { name: "orders", relations: [{ to: "payments" }] },
          { name: "payments" },
        ],
      }),
    );
    mockMkdir.mockResolvedValue();
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, {
      format: "kubernetes",
      output: "./k8s",
    });

    expect(result.exitCode).toBe(0);
    expect(result.data.outputSink).toBe("directory");
    expect(result.data.outputPath).toBe("./k8s");
    expect(result.data.files.length).toBeGreaterThanOrEqual(2);
    expect(mockMkdir).toHaveBeenCalledWith("./k8s", { recursive: true });
  });

  it("uses config.generate.kubernetes.path when --output omitted", async () => {
    setupModel(makeModel({ elements: [{ name: "a" }, { name: "b" }] }));
    mockMkdir.mockResolvedValue();
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(
      {
        ...baseConfig,
        generate: { kubernetes: { path: "custom/k8s" } },
      },
      { format: "kubernetes" },
    );

    expect(result.data.outputPath).toBe("custom/k8s");
    expect(mockMkdir).toHaveBeenCalledWith("custom/k8s", { recursive: true });
  });

  it("--output - errors for multi-file", async () => {
    setupModel(makeModel({ elements: [{ name: "a" }, { name: "b" }] }));

    await expect(
      executeGenerate(baseConfig, { format: "kubernetes", output: "-" }),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "config.missingOutputPath",
    });
  });
});

describe("executeGenerate — error cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ToolError format.unknown for unknown format", async () => {
    setupModel(makeModel({}));
    await expect(
      executeGenerate(baseConfig, { format: "totally-fake" }),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "format.unknown",
    });
  });

  it("emits format.emptyOutput diagnostic when generator produces no files", async () => {
    setupModel(
      makeModel({
        elements: [{ name: "orders_db", kind: "ContainerDb" }],
      }),
    );
    mockMkdir.mockResolvedValue();
    mockWriteFile.mockResolvedValue();

    const result = await executeGenerate(baseConfig, {
      format: "kubernetes",
      output: "./k8s",
    });

    expect(result.exitCode).toBe(0);
    expect(result.data.outputSink).toBe("none");
    expect(
      result.diagnostics?.some((d) => d.kind === "format.emptyOutput"),
    ).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("renderGenerateText", () => {
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

  const sampleEnvelope = (data: GenerateData) =>
    buildEnvelope<GenerateData>({
      command: "generate",
      exitCode: 0,
      data,
      meta: { durationMs: 1, configPath: null, source: "test.puml" },
    });

  it("writes 'Written to X' for file sink", () => {
    const { sink, output } = captureSink();
    renderGenerateText(
      sampleEnvelope({
        formatName: "plantuml",
        outputSink: "file",
        outputPath: "out.puml",
        files: [{ path: "out.puml", bytes: 1024 }],
      }),
      sink,
    );
    expect(output()).toContain("Written to out.puml");
  });

  it("writes 'Generated N files in X' for directory sink", () => {
    const { sink, output } = captureSink();
    renderGenerateText(
      sampleEnvelope({
        formatName: "kubernetes",
        outputSink: "directory",
        outputPath: "./k8s",
        files: [
          { path: "a.yaml", bytes: 100 },
          { path: "b.yaml", bytes: 100 },
        ],
      }),
      sink,
    );
    expect(output()).toContain("Generated 2 file(s) in ./k8s");
  });

  it("writes brief confirmation for stdout sink", () => {
    const { sink, output } = captureSink();
    renderGenerateText(
      sampleEnvelope({
        formatName: "plantuml",
        outputSink: "stdout",
        outputPath: null,
        files: [{ path: "<stdout>", bytes: 512 }],
      }),
      sink,
    );
    expect(output()).toContain("plantuml");
    expect(output()).toContain("512 bytes");
  });

  it("writes warning for none sink", () => {
    const { sink, output } = captureSink();
    renderGenerateText(
      sampleEnvelope({
        formatName: "kubernetes",
        outputSink: "none",
        outputPath: null,
        files: [],
      }),
      sink,
    );
    expect(output()).toContain("no files");
  });
});
