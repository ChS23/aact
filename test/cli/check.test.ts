import type { ArchitectureModel, Container } from "../../src/model";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../src/loaders/plantuml/loadPlantumlElements", () => ({
  loadPlantumlElements: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/loaders/plantuml/mapContainersFromPlantumlElements", () => ({
  mapContainersFromPlantumlElements: vi.fn(),
}));

vi.mock("../../src/loaders/structurizr/loadStructurizrElements", () => ({
  loadStructurizrElements: vi.fn(),
}));

vi.mock("consola", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { readFile, writeFile } from "node:fs/promises";

import { loadConfig } from "c12";
import consola from "consola";

import { mapContainersFromPlantumlElements } from "../../src/loaders/plantuml/mapContainersFromPlantumlElements";
import { loadStructurizrElements } from "../../src/loaders/structurizr/loadStructurizrElements";

const mockLoadConfig = vi.mocked(loadConfig);
const mockMapContainers = vi.mocked(mapContainersFromPlantumlElements);
const mockLoadStructurizr = vi.mocked(loadStructurizrElements);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const externalSystem: Container = {
  name: "ext_system",
  label: "External",
  type: "System_Ext",
  description: "",
  relations: [],
};

const svcB: Container = {
  name: "svc_b",
  label: "Service B",
  type: "Container",
  description: "",
  relations: [],
};

const cleanModel = (): ArchitectureModel => {
  const svcA: Container = {
    name: "svc_a",
    label: "Service A",
    type: "Container",
    description: "",
    relations: [{ to: svcB, technology: "http" }],
  };
  return {
    boundaries: [
      {
        name: "project",
        label: "Project",
        containers: [svcA, svcB],
        boundaries: [],
      },
    ],
    allContainers: [svcA, svcB],
  };
};

const violatingModel = (): ArchitectureModel => ({
  boundaries: [
    {
      name: "project",
      label: "Project",
      containers: [
        {
          name: "my_service",
          label: "My Service",
          type: "Container",
          description: "",
          relations: [{ to: externalSystem }],
        },
        externalSystem,
      ],
      boundaries: [],
    },
  ],
  allContainers: [
    {
      name: "my_service",
      label: "My Service",
      type: "Container",
      description: "",
      relations: [{ to: externalSystem }],
    },
    externalSystem,
  ],
});

const setupConfig = (overrides?: {
  rules?: Record<string, unknown>;
  source?: Record<string, unknown>;
}): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: { type: "plantuml", path: "test.puml" },
      ...overrides,
    },
  } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);
};

const cyclicModel = (): ArchitectureModel => {
  const svcB: Container = {
    name: "svc_b",
    label: "Service B",
    type: "Container",
    description: "",
    relations: [],
  };
  const svcA: Container = {
    name: "svc_a",
    label: "Service A",
    type: "Container",
    description: "",
    relations: [{ to: svcB }],
  };
  Object.assign(svcB, { relations: [{ to: svcA }] });
  return {
    boundaries: [
      {
        name: "project",
        label: "Project",
        containers: [svcA, svcB],
        boundaries: [],
      },
    ],
    allContainers: [svcA, svcB],
  };
};

const runCheck = async (args: Record<string, unknown> = {}): Promise<void> => {
  const mod = await import("../../src/cli/commands/check");
  const command = mod.check;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("check command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when config source is missing", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {},
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    await expect(runCheck()).rejects.toThrow();
  });

  it("passes when no violations found", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(cleanModel());
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCheck({ format: "text" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it("throws when violations found", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(violatingModel());

    await expect(runCheck()).rejects.toThrow();
  });

  it("outputs json format", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(cleanModel());
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCheck({ format: "json" });

    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toHaveProperty("results");
    expect(Array.isArray(output.results)).toBe(true);
  });

  it("outputs github format annotations", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(violatingModel());
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCheck({ format: "github" })).rejects.toThrow();

    const calls = spy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.startsWith("::error"))).toBe(true);
  });

  it("respects rules config disabling acl", async () => {
    setupConfig({ rules: { acl: false } });
    mockMapContainers.mockReturnValue(violatingModel());

    await expect(runCheck()).resolves.toBeUndefined();
  });

  describe("--fix", () => {
    it("reports no violations to fix when model is clean", async () => {
      setupConfig();
      mockMapContainers.mockReturnValue(cleanModel());

      await runCheck({ fix: true });

      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("No violations to fix"),
      );
    });

    it("shows edits without writing in dry-run mode", async () => {
      setupConfig();
      mockMapContainers.mockReturnValue(violatingModel());
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runCheck({ fix: true, "dry-run": true });

      expect(spy).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("applies edits and writes source file", async () => {
      setupConfig();
      const model = violatingModel();
      // First call returns violating model, second call (re-check) returns clean
      mockMapContainers.mockReturnValueOnce(model);
      mockMapContainers.mockReturnValueOnce(cleanModel());

      const pumlSource = [
        'Container(my_service, "My Service")',
        'System_Ext(ext_system, "External System")',
        'Rel(my_service, ext_system, "")',
      ].join("\n");

      mockReadFile.mockResolvedValue(pumlSource);
      mockWriteFile.mockResolvedValue();

      await runCheck({ fix: true });

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const written = mockWriteFile.mock.calls[0][1] as string;
      expect(written).toContain("my_service_acl");
    });

    it("shows summary after applying fixes", async () => {
      setupConfig();
      mockMapContainers.mockReturnValueOnce(violatingModel());
      mockMapContainers.mockReturnValueOnce(cleanModel());

      mockReadFile.mockResolvedValue(
        [
          'Container(my_service, "My Service")',
          'System_Ext(ext_system, "External System")',
          'Rel(my_service, ext_system, "")',
        ].join("\n"),
      );
      mockWriteFile.mockResolvedValue();

      await runCheck({ fix: true });

      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("Applied"),
      );
      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("fix(es)"),
      );
    });

    it("reports remaining violations count after fix", async () => {
      setupConfig();
      // re-check still returns violations
      mockMapContainers.mockReturnValueOnce(violatingModel());
      mockMapContainers.mockReturnValueOnce(violatingModel());

      mockReadFile.mockResolvedValue(
        [
          'Container(my_service, "My Service")',
          'System_Ext(ext_system, "External System")',
          'Rel(my_service, ext_system, "")',
        ].join("\n"),
      );
      mockWriteFile.mockResolvedValue();

      await runCheck({ fix: true });

      expect(consola.success).toHaveBeenCalledWith(
        expect.stringContaining("violation(s) remain"),
      );
    });

    it("throws when violations have no auto-fix available", async () => {
      setupConfig({ rules: { acl: false } });
      mockMapContainers.mockReturnValue(cyclicModel());

      await expect(runCheck({ fix: true })).rejects.toThrow();
      expect(consola.info).toHaveBeenCalledWith(
        expect.stringContaining("No auto-fixes available"),
      );
    });

    describe("structurizr source", () => {
      it("warns and throws when writePath not configured", async () => {
        setupConfig({
          source: { type: "structurizr", path: "workspace.json" },
        });
        mockLoadStructurizr.mockResolvedValue(violatingModel());

        await expect(runCheck({ fix: true })).rejects.toThrow();
        expect(consola.warn).toHaveBeenCalledWith(
          expect.stringContaining("writePath"),
        );
      });

      it("writes to writePath and warns to regenerate", async () => {
        setupConfig({
          source: {
            type: "structurizr",
            path: "workspace.json",
            writePath: "workspace.dsl",
          },
        });
        mockLoadStructurizr.mockResolvedValue(violatingModel());

        const dslSource = [
          'my_service = container "My Service"',
          'ext_system = softwareSystem "External System"',
          'my_service -> ext_system ""',
        ].join("\n");

        mockReadFile.mockResolvedValue(dslSource);
        mockWriteFile.mockResolvedValue();

        await runCheck({ fix: true });

        const writtenPath = mockWriteFile.mock.calls[0][0] as string;
        expect(writtenPath).toContain("workspace.dsl");
        expect(consola.warn).toHaveBeenCalledWith(
          expect.stringContaining("regenerate"),
        );
      });
    });
  });
});
