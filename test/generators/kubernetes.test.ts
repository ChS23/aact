import YAML from "yaml";

import { generateKubernetes } from "../../src/generators/kubernetes";
import type { ArchitectureModel } from "../../src/model";
import type { Container } from "../../src/model/container";

const makeContainer = (
  overrides: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: overrides.name,
  type: "Container",
  description: "",
  relations: [],
  ...overrides,
});

const makeModel = (containers: Container[]): ArchitectureModel => ({
  boundaries: [],
  allContainers: containers,
});

describe("generateKubernetes", () => {
  it("returns empty array for empty model", () => {
    const model = makeModel([]);
    expect(generateKubernetes(model)).toEqual([]);
  });

  it("generates minimal YAML for container without relations", () => {
    const container = makeContainer({ name: "orders" });
    const model = makeModel([container]);

    const result = generateKubernetes(model);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("orders.yml");
    const parsed = YAML.parse(result[0].content);
    expect(parsed.name).toBe("orders");
    expect(parsed.environment).toBeUndefined();
  });

  it("skips ContainerDb", () => {
    const db = makeContainer({ name: "orders_db", type: "ContainerDb" });
    const svc = makeContainer({ name: "orders" });
    const model = makeModel([db, svc]);

    const result = generateKubernetes(model);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("orders.yml");
  });

  it("skips System_Ext", () => {
    const ext = makeContainer({ name: "ext_gateway", type: "System_Ext" });
    const svc = makeContainer({ name: "orders" });
    const model = makeModel([ext, svc]);

    const result = generateKubernetes(model);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("orders.yml");
  });

  it("generates sync internal BASE_URL with default port", () => {
    const payments = makeContainer({ name: "payments" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: payments }],
    });
    const model = makeModel([orders, payments]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.PAYMENTS_BASE_URL.default).toBe(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      "http://payments:8080",
    );
  });

  it("uses technology as value for sync internal when provided", () => {
    const payments = makeContainer({ name: "payments" });
    const orders = makeContainer({
      name: "orders",
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      relations: [{ to: payments, technology: "http://payments:3000/api" }],
    });
    const model = makeModel([orders, payments]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.PAYMENTS_BASE_URL.default).toBe(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      "http://payments:3000/api",
    );
  });

  it("generates sync external BASE_URL with technology or https", () => {
    const ext = makeContainer({ name: "ext_gateway", type: "System_Ext" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: ext }],
    });
    const model = makeModel([orders, ext]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.EXT_GATEWAY_BASE_URL.default).toBe(
      "https://ext-gateway",
    );
  });

  it("uses technology as value for sync external when provided", () => {
    const ext = makeContainer({ name: "ext_gateway", type: "System_Ext" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: ext, technology: "https://api.external.com" }],
    });
    const model = makeModel([orders, ext]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.EXT_GATEWAY_BASE_URL.default).toBe(
      "https://api.external.com",
    );
  });

  it("generates KAFKA topic for async relation", () => {
    const notifications = makeContainer({ name: "notifications" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: notifications, tags: ["async"] }],
    });
    const model = makeModel([orders, notifications]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.KAFKA_NOTIFICATIONS_TOPIC.default).toBe(
      "notifications",
    );
  });

  it("uses technology as topic for async relation when provided", () => {
    const notifications = makeContainer({ name: "notifications" });
    const orders = makeContainer({
      name: "orders",
      relations: [
        { to: notifications, tags: ["async"], technology: "order-events-v2" },
      ],
    });
    const model = makeModel([orders, notifications]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.KAFKA_NOTIFICATIONS_TOPIC.default).toBe(
      "order-events-v2",
    );
  });

  it("generates PG_CONNECTION_STRING for database relation", () => {
    const db = makeContainer({ name: "orders_db", type: "ContainerDb" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: db }],
    });
    const model = makeModel([orders, db]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.PG_CONNECTION_STRING.default).toBe(
      "postgresql://orders:pass-orders@postgresql:5432/orders",
    );
  });

  it("converts underscores to hyphens in fileName", () => {
    const container = makeContainer({ name: "invoice_repository" });
    const model = makeModel([container]);

    const result = generateKubernetes(model);

    expect(result[0].fileName).toBe("invoice-repository.yml");
  });

  it("converts underscores to hyphens in YAML name", () => {
    const container = makeContainer({ name: "invoice_repository" });
    const model = makeModel([container]);

    const result = generateKubernetes(model);
    const parsed = YAML.parse(result[0].content);

    expect(parsed.name).toBe("invoice-repository");
  });

  it("uses custom defaultPort", () => {
    const payments = makeContainer({ name: "payments" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: payments }],
    });
    const model = makeModel([orders, payments]);

    const result = generateKubernetes(model, { defaultPort: 3000 });
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment.PAYMENTS_BASE_URL.default).toBe(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      "http://payments:3000",
    );
  });

  it("generates all env vars for multiple relations", () => {
    const db = makeContainer({ name: "orders_db", type: "ContainerDb" });
    const payments = makeContainer({ name: "payments" });
    const notifications = makeContainer({ name: "notifications" });
    const ext = makeContainer({ name: "ext_api", type: "System_Ext" });

    const orders = makeContainer({
      name: "orders",
      relations: [
        { to: db },
        { to: payments },
        { to: notifications, tags: ["async"] },
        { to: ext },
      ],
    });
    const model = makeModel([orders, db, payments, notifications, ext]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    expect(parsed.environment).toHaveProperty("PG_CONNECTION_STRING");
    expect(parsed.environment).toHaveProperty("PAYMENTS_BASE_URL");
    expect(parsed.environment).toHaveProperty("KAFKA_NOTIFICATIONS_TOPIC");
    expect(parsed.environment).toHaveProperty("EXT_API_BASE_URL");
  });

  it("sorts env vars by key name", () => {
    const payments = makeContainer({ name: "payments" });
    const billing = makeContainer({ name: "billing" });
    const db = makeContainer({ name: "orders_db", type: "ContainerDb" });

    const orders = makeContainer({
      name: "orders",
      relations: [{ to: payments }, { to: billing }, { to: db }],
    });
    const model = makeModel([orders, payments, billing, db]);

    const result = generateKubernetes(model);
    const ordersOut = result.find((r) => r.fileName === "orders.yml")!;
    const parsed = YAML.parse(ordersOut.content);

    const keys = Object.keys(parsed.environment);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it("uses custom dbConnectionTemplate", () => {
    const db = makeContainer({ name: "orders_db", type: "ContainerDb" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: db }],
    });
    const model = makeModel([orders, db]);

    const result = generateKubernetes(model, {
      dbConnectionTemplate: "mysql://{name}@db:3306/{name}",
    });
    const parsed = YAML.parse(result[0].content);

    expect(parsed.environment.PG_CONNECTION_STRING.default).toBe(
      "mysql://orders@db:3306/orders",
    );
  });

  it("ignores relation to unknown container type", () => {
    const person = makeContainer({ name: "admin", type: "Person" });
    const orders = makeContainer({
      name: "orders",
      relations: [{ to: person }],
    });
    const model = makeModel([orders]);

    const result = generateKubernetes(model);
    const parsed = YAML.parse(result[0].content);

    expect(parsed.environment).toBeUndefined();
  });

  it("excludes Person elements from generated YAML", () => {
    const person = makeContainer({ name: "customer", type: "Person" });
    const orders = makeContainer({ name: "orders" });
    const model = makeModel([person, orders]);

    const result = generateKubernetes(model);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("orders.yml");
  });

  it("excludes System and Component elements (whitelist for Container only)", () => {
    const system = makeContainer({ name: "billing_system", type: "System" });
    const component = makeContainer({
      name: "auth_module",
      type: "Component",
    });
    const orders = makeContainer({ name: "orders" });
    const model = makeModel([system, component, orders]);

    const result = generateKubernetes(model);

    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe("orders.yml");
  });

  it("round-trip: generateKubernetes output can be parsed back", () => {
    const db = makeContainer({ name: "orders_db", type: "ContainerDb" });
    const payments = makeContainer({ name: "payments" });
    const notifications = makeContainer({ name: "notifications" });

    const orders = makeContainer({
      name: "orders",
      relations: [
        { to: db },
        { to: payments },
        { to: notifications, tags: ["async"], technology: "order-events" },
      ],
    });
    const model = makeModel([orders, db, payments, notifications]);

    const outputs = generateKubernetes(model);

    for (const output of outputs) {
      const parsed = YAML.parse(output.content);
      expect(parsed.name).toBeDefined();
      expect(typeof parsed.name).toBe("string");

      if (parsed.environment) {
        for (const [key, value] of Object.entries(parsed.environment)) {
          expect(typeof key).toBe("string");
          expect(value).toHaveProperty("default");
        }
      }
    }
  });
});
