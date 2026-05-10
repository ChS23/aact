import {
  loadMicroserviceDeployConfigs,
  mapFromConfigs,
} from "../../src/loaders/kubernetes";

describe("Kubernetes Loader", () => {
  it("loads deploy configs from YAML files", async () => {
    const configs = await loadMicroserviceDeployConfigs();
    expect(configs.length).toBeGreaterThan(0);
  });

  it("assigns fileName from file path", async () => {
    const configs = await loadMicroserviceDeployConfigs();
    expect(configs.every((c) => c.fileName)).toBe(true);
  });

  it("parses environment variables", async () => {
    const configs = await loadMicroserviceDeployConfigs();
    const invoiceRepo = configs.find((c) => c.name === "invoice-repository");
    expect(invoiceRepo?.environment).toHaveProperty("PG_CONNECTION_STRING");
  });

  it("maps and sorts configs", async () => {
    const raw = await loadMicroserviceDeployConfigs();
    const mapped = mapFromConfigs(raw);

    expect(mapped.length).toBe(raw.length);

    const names = mapped.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("normalizes names (replaces dashes with underscores)", async () => {
    const raw = await loadMicroserviceDeployConfigs();
    const mapped = mapFromConfigs(raw);

    for (const config of mapped) {
      expect(config.name).not.toContain("-");
    }
  });

  it("extracts sections from environment", async () => {
    const raw = await loadMicroserviceDeployConfigs();
    const mapped = mapFromConfigs(raw);
    const bff = mapped.find((c) => c.name === "bff");

    expect(bff).toBeDefined();
    expect(bff!.sections.length).toBeGreaterThan(0);
  });
});
