import type { ArchitectureModel, Container } from "../../src/model";

vi.mock("c12", () => ({
  loadConfig: vi.fn(),
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
    info: vi.fn(),
    log: vi.fn(),
  },
}));

import { loadConfig } from "c12";
import consola from "consola";

import { mapContainersFromPlantumlElements } from "../../src/loaders/plantuml/mapContainersFromPlantumlElements";

const mockLoadConfig = vi.mocked(loadConfig);
const mockMapContainers = vi.mocked(mapContainersFromPlantumlElements);

const db: Container = {
  name: "orders_db",
  label: "DB",
  type: "ContainerDb",
  description: "",
  relations: [],
};

const svcA: Container = {
  name: "svc_a",
  label: "Service A",
  type: "Container",
  description: "",
  relations: [{ to: db, technology: "tcp" }],
};

const testModel = (): ArchitectureModel => ({
  boundaries: [
    {
      name: "project",
      label: "Project",
      containers: [svcA, db],
      boundaries: [],
    },
  ],
  allContainers: [svcA, db],
});

const setupConfig = (): void => {
  mockLoadConfig.mockResolvedValue({
    config: {
      source: { type: "plantuml", path: "test.puml" },
    },
  } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);
};

const runAnalyze = async (args: { format?: string } = {}): Promise<void> => {
  const mod = await import("../../src/cli/commands/analyze");
  const command = mod.analyze;
  await (
    command as unknown as {
      run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
    }
  ).run({ args });
};

describe("analyze command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when config source is missing", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {},
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    await expect(runAnalyze()).rejects.toThrow();
  });

  it("outputs text metrics via consola", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(testModel());

    await runAnalyze();

    const infoCalls = vi
      .mocked(consola.info)
      .mock.calls.map((c) => c[0] as string);
    expect(infoCalls.some((c) => c.includes("Elements:"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("Sync API calls:"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("Async API calls:"))).toBe(true);
    expect(infoCalls.some((c) => c.includes("Databases:"))).toBe(true);
  });

  it("outputs json format", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(testModel());
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runAnalyze({ format: "json" });

    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toHaveProperty("elementsCount");
    expect(output).toHaveProperty("syncApiCalls");
    expect(output).toHaveProperty("asyncApiCalls");
    expect(output).toHaveProperty("databases");
    expect(output).toHaveProperty("boundaries");
  });

  it("unknown format falls back to text output", async () => {
    setupConfig();
    mockMapContainers.mockReturnValue(testModel());

    await runAnalyze({ format: "unknown" });

    const infoCalls = vi
      .mocked(consola.info)
      .mock.calls.map((c) => c[0] as string);
    expect(infoCalls.some((c) => c.includes("Elements:"))).toBe(true);
  });

  it("logs coupling relations for boundaries", async () => {
    const extSystem: Container = {
      name: "ext",
      label: "Ext",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svcWithCoupling: Container = {
      name: "svc_coupling",
      label: "Coupled Service",
      type: "Container",
      description: "",
      relations: [{ to: extSystem, technology: "http" }],
    };
    setupConfig();
    mockMapContainers.mockReturnValue({
      boundaries: [
        {
          name: "project",
          label: "Project",
          containers: [svcWithCoupling],
          boundaries: [],
        },
      ],
      allContainers: [svcWithCoupling, extSystem],
    });

    await runAnalyze();

    const logCalls = vi
      .mocked(consola.log)
      .mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((c) => c.includes("svc_coupling"))).toBe(true);
  });
});
