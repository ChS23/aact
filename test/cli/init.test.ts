import fs from "node:fs/promises";

import { executeInit, renderInitText } from "../../src/cli/commands/init";
import { buildEnvelope } from "../../src/cli/output";

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
    writeFile: vi.fn(),
  },
}));

const mockAccess = vi.mocked(fs.access);
const mockWriteFile = vi.mocked(fs.writeFile);

const findWrite = (
  fileName: string,
): { path: string; content: string } | undefined => {
  const call = mockWriteFile.mock.calls.find((c) => {
    const target = c[0];
    return typeof target === "string" && target.endsWith(fileName);
  });
  if (!call) return undefined;
  return { path: call[0] as string, content: call[1] as string };
};

describe("executeInit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates aact.config.ts and architecture.puml when neither exists", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    const result = await executeInit();

    expect(result.exitCode).toBe(0);
    expect(result.data.created).toHaveLength(2);
    expect(result.data.skipped).toHaveLength(0);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(findWrite("aact.config.ts")).toBeDefined();
    expect(findWrite("architecture.puml")).toBeDefined();
  });

  it("skips both when both already exist", async () => {
    mockAccess.mockResolvedValue();

    const result = await executeInit();

    expect(result.exitCode).toBe(0);
    expect(result.data.created).toHaveLength(0);
    expect(result.data.skipped).toHaveLength(2);
    expect(result.data.skipped.every((s) => s.reason === "exists")).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("creates only architecture.puml when config already exists", async () => {
    mockAccess.mockImplementation((target: unknown) => {
      if (typeof target === "string" && target.endsWith("aact.config.ts")) {
        return Promise.resolve();
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockWriteFile.mockResolvedValue();

    const result = await executeInit();

    expect(result.data.created).toHaveLength(1);
    expect(result.data.skipped).toHaveLength(1);
    expect(result.data.created[0].kind).toBe("architecture");
    expect(result.data.skipped[0].kind).toBe("config");
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("config template uses type-only import (no runtime require of 'aact')", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await executeInit();

    const content = findWrite("aact.config.ts")?.content ?? "";
    expect(content).toContain('import type { AactConfig } from "aact"');
    expect(content).not.toMatch(/^import\s*{\s*defineConfig\s*}/m);
  });

  it("config template defaults to plantuml source", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await executeInit();

    const content = findWrite("aact.config.ts")?.content ?? "";
    expect(content).toContain('type: "plantuml"');
    expect(content).toContain('path: "./architecture.puml"');
  });

  it("config template enables every documented rule", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await executeInit();

    const content = findWrite("aact.config.ts")?.content ?? "";
    for (const rule of [
      "acl:",
      "acyclic:",
      "apiGateway:",
      "crud:",
      "dbPerService:",
      "cohesion:",
      "stableDependencies:",
      "commonReuse:",
    ]) {
      expect(content).toContain(rule);
    }
  });

  it("architecture template contains an intentional CRUD violation", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await executeInit();

    const content = findWrite("architecture.puml")?.content ?? "";
    expect(content).toContain("@startuml");
    expect(content).toContain("@enduml");
    expect(content).toContain("Container(orders");
    expect(content).toContain("ContainerDb(orders_db");
    expect(content).toMatch(/Rel\(orders,\s*orders_db/);
  });

  it("propagates file write errors", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(executeInit()).rejects.toThrow(/EACCES/);
  });
});

describe("renderInitText", () => {
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

  it("renders Created lines and Next hint when files created", () => {
    const { sink, output } = captureSink();
    renderInitText(
      buildEnvelope({
        command: "init",
        exitCode: 0,
        data: {
          created: [
            { path: "/abs/aact.config.ts", kind: "config" },
            { path: "/abs/architecture.puml", kind: "architecture" },
          ],
          skipped: [],
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );

    const text = output();
    expect(text).toContain("Created aact.config.ts");
    expect(text).toContain("Created architecture.puml");
    expect(text).toContain("aact check");
  });

  it("renders Skipping lines and no Next hint when all skipped", () => {
    const { sink, output } = captureSink();
    renderInitText(
      buildEnvelope({
        command: "init",
        exitCode: 0,
        data: {
          created: [],
          skipped: [
            {
              path: "/abs/aact.config.ts",
              kind: "config",
              reason: "exists",
            },
          ],
        },
        meta: { durationMs: 1, configPath: null, source: null },
      }),
      sink,
    );

    const text = output();
    expect(text).toContain("aact.config.ts already exists");
    expect(text).not.toContain("aact check");
  });
});
