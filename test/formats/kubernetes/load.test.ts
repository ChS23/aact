import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "../../../src/formats/kubernetes/load";

const makeTempDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "aact-k8s-load-"));

const dump = async (path: string, content: string): Promise<void> => {
  await writeFile(path, content);
};

describe("load — end-to-end k8s manifest → Model", () => {
  it("loads a single Deployment with image heuristic", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "app.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: orders-api",
        "  namespace: shop",
        "  annotations:",
        '    aact.description: "Orders REST API"',
        "spec:",
        "  template:",
        "    spec:",
        "      containers:",
        "        - name: api",
        "          image: ghcr.io/shop/orders:v1.2",
        "---",
        "apiVersion: apps/v1",
        "kind: StatefulSet",
        "metadata:",
        "  name: orders-db",
        "  namespace: shop",
        "spec:",
        "  template:",
        "    spec:",
        "      containers:",
        "        - name: db",
        "          image: postgres:16",
      ].join("\n"),
    );

    const { model, issues } = await load(file);
    expect(Object.keys(model.elements).toSorted()).toEqual([
      "orders-api",
      "orders-db",
    ]);
    expect(model.elements["orders-db"].kind).toBe("ContainerDb");
    expect(model.elements["orders-api"].kind).toBe("Container");
    expect(model.elements["orders-api"].description).toBe("Orders REST API");
    expect(model.elements["orders-api"].technology).toBe(
      "ghcr.io/shop/orders:v1.2",
    );
    // Namespace → Boundary
    expect(Object.keys(model.boundaries)).toEqual(["shop"]);
    expect(model.boundaries.shop.elementNames.toSorted()).toEqual([
      "orders-api",
      "orders-db",
    ]);
    expect(issues.filter((i) => i.kind !== "loader-warning")).toEqual([]);
  });

  it("respects aact.skip annotation", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: real",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: debug",
        '  annotations: { aact.skip: "true" }',
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(Object.keys(model.elements)).toEqual(["real"]);
  });

  it("respects skip glob patterns via options", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: orders }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: orders-canary }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file, { skip: ["*-canary"] });
    expect(Object.keys(model.elements)).toEqual(["orders"]);
  });

  it("respects namespace filter", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: a, namespace: prod }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: b, namespace: stage }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file, { namespaces: ["prod"] });
    expect(Object.keys(model.elements)).toEqual(["a"]);
  });

  it("aact.kind annotation overrides inferred kind", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: weird-db",
        "  annotations:",
        "    aact.kind: ContainerDb",
        "spec:",
        "  template:",
        "    spec:",
        "      containers:",
        "        - image: my-custom-store:1",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(model.elements["weird-db"].kind).toBe("ContainerDb");
  });

  it("aact.element annotation renames element", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: orders-deployment-blue",
        "  annotations:",
        "    aact.element: orders",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(Object.keys(model.elements)).toEqual(["orders"]);
  });

  it("aact.tags annotation populates tags", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: api",
        '  annotations: { aact.tags: "tier-1,public,critical" }',
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect([...model.elements.api.tags]).toEqual([
      "tier-1",
      "public",
      "critical",
    ]);
  });

  it("aact.external annotation marks external", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: third-party",
        '  annotations: { aact.external: "true" }',
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(model.elements["third-party"].external).toBe(true);
  });

  it("custom annotations.prefix is honored", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: orders",
        '  annotations: { arch.label: "Orders Service" }',
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file, { annotations: { prefix: "arch" } });
    expect(model.elements.orders.label).toBe("Orders Service");
  });

  it("namespace-less manifests are NOT grouped into a boundary", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: a }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(Object.keys(model.boundaries)).toEqual([]);
  });

  it("ignores non-workload resources (Service, ConfigMap, Secret)", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: v1",
        "kind: Service",
        "metadata: { name: orders-svc }",
        "---",
        "apiVersion: v1",
        "kind: ConfigMap",
        "metadata: { name: config }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: orders }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(Object.keys(model.elements)).toEqual(["orders"]);
  });

  it("loads a directory of multiple manifest files", async () => {
    const dir = await makeTempDir();
    await dump(
      join(dir, "a.yaml"),
      "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: a, namespace: prod }\nspec: { template: { spec: { containers: [{ image: nginx }] } } }",
    );
    await dump(
      join(dir, "b.yaml"),
      "apiVersion: apps/v1\nkind: StatefulSet\nmetadata: { name: b, namespace: prod }\nspec: { template: { spec: { containers: [{ image: postgres }] } } }",
    );
    const { model } = await load(dir);
    expect(Object.keys(model.elements).toSorted()).toEqual(["a", "b"]);
    expect(model.elements.b.kind).toBe("ContainerDb");
  });

  it("rejects Helm-templated file with actionable error", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "tpl.yaml");
    await dump(
      file,
      "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}",
    );
    await expect(load(file)).rejects.toThrow(/helm template/i);
  });

  it("builds relations via Service selector + env-var heuristic", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: api",
        "spec:",
        "  template:",
        "    metadata: { labels: { app: api } }",
        "    spec:",
        "      containers:",
        "        - name: app",
        "          image: ghcr.io/org/api:v1",
        "          env:",
        "            - { name: ORDERS_HOST, value: orders-svc }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: orders",
        "spec:",
        "  template:",
        "    metadata: { labels: { app: orders } }",
        "    spec: { containers: [{ image: ghcr.io/org/orders:v1 }] }",
        "---",
        "apiVersion: v1",
        "kind: Service",
        "metadata: { name: orders-svc }",
        "spec: { selector: { app: orders } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(model.elements.api.relations.map((r) => r.to)).toEqual(["orders"]);
    expect(model.elements.orders.relations).toEqual([]);
  });

  it("honors aact.depends-on annotation over env-var heuristic", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: api",
        '  annotations: { "aact.depends-on": "orders,cache" }',
        "spec:",
        "  template:",
        "    spec:",
        "      containers:",
        "        - image: nginx",
        "          env: [{ name: ORDERS_HOST, value: ignored }]",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: orders }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: cache }",
        "spec: { template: { spec: { containers: [{ image: redis }] } } }",
      ].join("\n"),
    );
    const { model } = await load(file);
    expect(model.elements.api.relations.map((r) => r.to).toSorted()).toEqual([
      "cache",
      "orders",
    ]);
  });

  it("chases kustomization.yaml resources field", async () => {
    const dir = await makeTempDir();
    await dump(
      join(dir, "kustomization.yaml"),
      "resources:\n  - app.yaml\n  - db.yaml",
    );
    await dump(
      join(dir, "app.yaml"),
      "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: api }\nspec: { template: { spec: { containers: [{ image: nginx }] } } }",
    );
    await dump(
      join(dir, "db.yaml"),
      "apiVersion: apps/v1\nkind: StatefulSet\nmetadata: { name: db }\nspec: { template: { spec: { containers: [{ image: postgres }] } } }",
    );
    const { model } = await load(dir);
    expect(Object.keys(model.elements).toSorted()).toEqual(["api", "db"]);
    expect(model.elements.db.kind).toBe("ContainerDb");
  });

  it("flags duplicate element names with loader-warning", async () => {
    const dir = await makeTempDir();
    const file = join(dir, "x.yaml");
    await dump(
      file,
      [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: dup, namespace: a }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "---",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata: { name: dup, namespace: b }",
        "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
      ].join("\n"),
    );
    const { model, issues } = await load(file);
    expect(Object.keys(model.elements)).toEqual(["dup"]);
    expect(
      issues.some(
        (i) => i.kind === "loader-warning" && i.code === "duplicate-element",
      ),
    ).toBe(true);
  });
});
