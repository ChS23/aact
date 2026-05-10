vi.mock("consola", () => ({
  default: {
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fs from "node:fs/promises";

import consola from "consola";

const mockAccess = vi.mocked(fs.access);
const mockWriteFile = vi.mocked(fs.writeFile);

const runInit = async (): Promise<void> => {
  const mod = await import("../../src/cli/commands/init");
  const command = mod.init;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args: {} });
};

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

describe("init command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates aact.config.ts and architecture.puml when neither exists", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(findWrite("aact.config.ts")).toBeDefined();
    expect(findWrite("architecture.puml")).toBeDefined();
    expect(consola.success).toHaveBeenCalledWith("Created aact.config.ts");
    expect(consola.success).toHaveBeenCalledWith("Created architecture.puml");
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("aact check"),
    );
  });

  it("skips both when both already exist", async () => {
    mockAccess.mockResolvedValue();

    await runInit();

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining("aact.config.ts already exists"),
    );
    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining("architecture.puml already exists"),
    );
    expect(consola.info).not.toHaveBeenCalled();
  });

  it("creates only architecture.puml when config already exists", async () => {
    mockAccess.mockImplementation(((target: unknown) => {
      if (typeof target === "string" && target.endsWith("aact.config.ts")) {
        return Promise.resolve();
      }
      return Promise.reject(new Error("ENOENT"));
    }) as unknown as typeof fs.access);
    mockWriteFile.mockResolvedValue();

    await runInit();

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(findWrite("architecture.puml")).toBeDefined();
  });

  it("config template uses type-only import (no runtime require of 'aact')", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    const content = findWrite("aact.config.ts")?.content ?? "";
    expect(content).toContain('import type { AactConfig } from "aact"');
    expect(content).not.toMatch(/import\s*{\s*defineConfig\s*}/);
  });

  it("config template defaults to plantuml source", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    const content = findWrite("aact.config.ts")?.content ?? "";
    expect(content).toContain('type: "plantuml"');
    expect(content).toContain('path: "./architecture.puml"');
  });

  it("config template enables every documented rule", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

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

  it("architecture template contains an intentional CRUD violation runnable by checkCrud", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue();

    await runInit();

    const content = findWrite("architecture.puml")?.content ?? "";
    expect(content).toContain("@startuml");
    expect(content).toContain("@enduml");
    expect(content).toContain("Container(orders");
    expect(content).toContain("ContainerDb(orders_db");
    expect(content).toMatch(/Rel\(orders,\s*orders_db/);
  });

  it("throws when file write fails", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(runInit()).rejects.toThrow();
  });
});
