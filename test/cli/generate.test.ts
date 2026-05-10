import type { MockedFunction } from "vitest";

import type { ArchitectureModel } from "../../src/model";
import type { Container } from "../../src/model/container";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/cli/loadModel", () => ({
  loadModel: vi.fn(),
}));

vi.mock("consola", () => ({
  default: {
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

import fs from "node:fs/promises";

import { loadConfig } from "c12";
import consola from "consola";

import { loadModel } from "../../src/cli/loadModel";

const mockLoadConfig = vi.mocked(loadConfig);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockMkdir = vi.mocked(fs.mkdir) as unknown as MockedFunction<
  () => Promise<void>
>;
const mockLoadModel = vi.mocked(loadModel);

const makeContainer = (
  overrides: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: overrides.name,
  type: "Container",
  description: "",
  relations: [],
  ...overrides,
});

const setupConfig = (overrides?: {
  generate?: Record<string, unknown>;
  source?: Record<string, unknown>;
}): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: overrides?.source ?? { type: "plantuml", path: "test.puml" },
      generate: overrides?.generate,
    },
  } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);
};

const setupModel = (
  containers: Container[],
  boundaries: ArchitectureModel["boundaries"] = [],
): void => {
  const model: ArchitectureModel = {
    boundaries,
    allContainers: containers,
  };
  mockLoadModel.mockResolvedValue(model);
};

const runGenerate = async (
  args: { output?: string; format?: string } = {},
): Promise<void> => {
  const mod = await import("../../src/cli/commands/generate");
  const command = mod.generate;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("generate command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("plantuml format (default)", () => {
    it("outputs plantuml to stdout by default", async () => {
      const orders = makeContainer({ name: "orders" });
      setupConfig();
      setupModel([orders]);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      expect(spy).toHaveBeenCalledOnce();
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("@startuml");
      expect(output).toContain("@enduml");
      expect(output).toContain("Container(orders");
    });

    it("outputs plantuml when --format plantuml", async () => {
      setupConfig();
      setupModel([makeContainer({ name: "svc" })]);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate({ format: "plantuml" });

      expect(spy).toHaveBeenCalledOnce();
      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("@startuml");
    });

    it("writes to file when --output is provided", async () => {
      setupConfig();
      setupModel([makeContainer({ name: "svc" })]);
      mockWriteFile.mockResolvedValue();

      await runGenerate({ output: "out.puml" });

      expect(mockWriteFile).toHaveBeenCalledOnce();
      const [filePath, content] = mockWriteFile.mock.calls[0];
      expect(filePath).toBe("out.puml");
      expect(content as string).toContain("@startuml");
      expect(consola.success).toHaveBeenCalled();
    });

    it("passes boundaryLabel from config", async () => {
      setupConfig({ generate: { boundaryLabel: "My Platform" } });
      setupModel([makeContainer({ name: "svc" })]);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain('Boundary(project, "My Platform")');
    });

    it("renders relations in output", async () => {
      const payments = makeContainer({ name: "payments" });
      const orders = makeContainer({
        name: "orders",
        relations: [{ to: payments, technology: "REST" }],
      });
      setupConfig();
      setupModel([orders, payments]);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      const output = spy.mock.calls[0][0] as string;
      expect(output).toContain("Rel(orders, payments");
    });

    it("loads model via loadModel", async () => {
      setupConfig();
      setupModel([makeContainer({ name: "svc" })]);
      vi.spyOn(console, "log").mockImplementation(() => {});

      await runGenerate();

      expect(mockLoadModel).toHaveBeenCalledOnce();
    });
  });

  describe("kubernetes format", () => {
    it("generates kubernetes YAML files to output dir", async () => {
      setupConfig();
      const payments = makeContainer({ name: "payments" });
      const orders = makeContainer({
        name: "orders",
        relations: [{ to: payments }],
      });
      setupModel([orders, payments]);
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes", output: "./k8s" });

      expect(mockMkdir).toHaveBeenCalledWith("./k8s", { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("2 file(s)"),
      );
    });

    it("uses config kubernetes path as default output dir", async () => {
      setupConfig({ generate: { kubernetes: { path: "custom/k8s" } } });
      setupModel([makeContainer({ name: "svc" })]);
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes" });

      expect(mockMkdir).toHaveBeenCalledWith("custom/k8s", { recursive: true });
    });

    it("uses default path when no config and no --output", async () => {
      setupConfig();
      setupModel([makeContainer({ name: "svc" })]);
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes" });

      expect(mockMkdir).toHaveBeenCalledWith(
        "resources/kubernetes/microservices",
        { recursive: true },
      );
    });

    it("throws when no source configured", async () => {
      mockLoadConfig.mockResolvedValue({
        config: {},
      } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

      await expect(runGenerate({ format: "kubernetes" })).rejects.toThrow();
    });

    it("throws for unknown format", async () => {
      setupConfig();

      await expect(runGenerate({ format: "unknown" })).rejects.toThrow(
        "Unknown format: unknown",
      );
    });

    it("writes no files when model has no deployable containers", async () => {
      setupConfig();
      const db = makeContainer({ name: "orders_db", type: "ContainerDb" });
      setupModel([db]);
      mockMkdir.mockResolvedValue();
      mockWriteFile.mockResolvedValue();

      await runGenerate({ format: "kubernetes", output: "./k8s" });

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("0 file(s)"),
      );
    });
  });
});
