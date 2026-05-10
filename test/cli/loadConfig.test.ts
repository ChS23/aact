vi.mock("c12", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "c12";

import { loadAndValidateConfig } from "../../src/cli/loadConfig";

const mockLoadConfig = vi.mocked(loadConfig);

describe("loadAndValidateConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no config file found", async () => {
    mockLoadConfig.mockResolvedValue({
      config: undefined,
    } as unknown as ReturnType<typeof loadConfig> extends Promise<infer T>
      ? T
      : never);

    await expect(loadAndValidateConfig()).rejects.toThrow(
      "No source configured",
    );
  });

  it("throws on invalid source.type", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "invalid", path: "test.puml" } },
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("throws when source.path is missing", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "plantuml" } },
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("throws on extra fields in strictObject", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {
        source: { type: "plantuml", path: "test.puml" },
        unknownField: true,
      },
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("throws when acl rule contains removed aclSuffix field", async () => {
    mockLoadConfig.mockResolvedValue({
      config: {
        source: { type: "plantuml", path: "test.puml" },
        rules: { acl: { aclSuffix: "_acl" } },
      },
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    await expect(loadAndValidateConfig()).rejects.toThrow();
  });

  it("returns valid config", async () => {
    mockLoadConfig.mockResolvedValue({
      config: { source: { type: "plantuml", path: "test.puml" } },
    } as ReturnType<typeof loadConfig> extends Promise<infer T> ? T : never);

    const result = await loadAndValidateConfig();
    expect(result.source.type).toBe("plantuml");
    expect(result.source.path).toBe("test.puml");
  });
});
