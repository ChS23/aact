vi.mock("consola", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../src/loaders/plantuml/loadPlantumlElements", () => ({
  loadPlantumlElements: vi.fn(),
}));
vi.mock("../../src/loaders/plantuml/mapContainersFromPlantumlElements", () => ({
  mapContainersFromPlantumlElements: vi.fn(),
}));
vi.mock("../../src/loaders/structurizr/loadStructurizrElements", () => ({
  loadStructurizrElements: vi.fn(),
}));

import consola from "consola";

import { loadModel } from "../../src/cli/loadModel";
import type { AactConfig } from "../../src/config";
import { loadPlantumlElements } from "../../src/loaders/plantuml/loadPlantumlElements";
import { mapContainersFromPlantumlElements } from "../../src/loaders/plantuml/mapContainersFromPlantumlElements";
import { loadStructurizrElements } from "../../src/loaders/structurizr/loadStructurizrElements";

const mockLoadPuml = vi.mocked(loadPlantumlElements);
const mockMapPuml = vi.mocked(mapContainersFromPlantumlElements);
const mockLoadStruct = vi.mocked(loadStructurizrElements);

const plantumlConfig: AactConfig = {
  source: { type: "plantuml", path: "./architecture.puml" },
};

const structurizrConfig: AactConfig = {
  source: { type: "structurizr", path: "./workspace.json" },
};

const enoent = (): NodeJS.ErrnoException => {
  const err: NodeJS.ErrnoException = new Error("ENOENT: no such file");
  err.code = "ENOENT";
  return err;
};

describe("loadModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to plantuml loader for type=plantuml", async () => {
    mockLoadPuml.mockResolvedValue([]);
    mockMapPuml.mockReturnValue({ allContainers: [], boundaries: [] });

    await loadModel(plantumlConfig);

    expect(mockLoadPuml).toHaveBeenCalledOnce();
    expect(mockMapPuml).toHaveBeenCalledOnce();
  });

  it("delegates to structurizr loader for type=structurizr", async () => {
    mockLoadStruct.mockResolvedValue({ allContainers: [], boundaries: [] });

    await loadModel(structurizrConfig);

    expect(mockLoadStruct).toHaveBeenCalledOnce();
  });

  it("emits friendly error and exits when plantuml source file is missing", async () => {
    mockLoadPuml.mockRejectedValue(enoent());

    await expect(loadModel(plantumlConfig)).rejects.toThrow();

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Architecture file not found"),
    );
    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("./architecture.puml"),
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("aact.config.ts"),
    );
  });

  it("emits friendly error and exits when structurizr source file is missing", async () => {
    mockLoadStruct.mockRejectedValue(enoent());

    await expect(loadModel(structurizrConfig)).rejects.toThrow();

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Architecture file not found"),
    );
  });

  it("emits friendly error on invalid JSON for structurizr", async () => {
    mockLoadStruct.mockRejectedValue(
      new SyntaxError("Unexpected token } in JSON"),
    );

    await expect(loadModel(structurizrConfig)).rejects.toThrow();

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot parse Structurizr workspace"),
    );
    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("valid JSON"),
    );
  });

  it("emits friendly error on missing model.softwareSystems for structurizr", async () => {
    mockLoadStruct.mockRejectedValue(
      new TypeError(
        "Cannot read properties of undefined (reading 'softwareSystems')",
      ),
    );

    await expect(loadModel(structurizrConfig)).rejects.toThrow();

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid Structurizr workspace"),
    );
  });

  it("re-throws unexpected errors instead of swallowing them", async () => {
    mockLoadPuml.mockRejectedValue(new Error("boom — totally unexpected"));

    await expect(loadModel(plantumlConfig)).rejects.toThrow(
      "boom — totally unexpected",
    );
    expect(consola.error).not.toHaveBeenCalled();
  });
});
