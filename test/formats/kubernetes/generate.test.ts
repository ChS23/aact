import { parseAllDocuments } from "yaml";

import { generate } from "../../../src/formats/kubernetes/generate";
import type { ElementSpec } from "../../helpers/makeModel";
import { makeModel } from "../../helpers/makeModel";

const gen = (elements: ElementSpec[]) => generate(makeModel({ elements }));

const docsOf = (content: string): Record<string, any>[] =>
  parseAllDocuments(content).map((d) => d.toJSON());

const fileFor = (out: ReturnType<typeof generate>, name: string) =>
  out.files.find((f) => f.path === `${name}.yaml`)!;

describe("kubernetes generate — real manifests", () => {
  it("emits nothing for an empty model", () => {
    expect(generate(makeModel({})).files).toEqual([]);
  });

  it("emits a Deployment + Service for a Container (apps/v1)", () => {
    const out = gen([
      { name: "orders-api", kind: "Container", technology: "Node.js" },
    ]);
    const [dep, svc] = docsOf(fileFor(out, "orders-api").content);
    expect(dep.apiVersion).toBe("apps/v1");
    expect(dep.kind).toBe("Deployment");
    expect(dep.metadata.name).toBe("orders-api");
    expect(dep.metadata.annotations["aact.kind"]).toBe("Container");
    expect(dep.metadata.annotations["aact.technology"]).toBe("Node.js");
    expect(dep.spec.template.spec.containers[0].ports[0].containerPort).toBe(
      8080,
    );
    expect(svc.apiVersion).toBe("v1");
    expect(svc.kind).toBe("Service");
    expect(svc.metadata.name).toBe("orders-api-svc");
    expect(svc.spec.selector.app).toBe("orders-api");
  });

  it("emits a StatefulSet with a DB image for ContainerDb", () => {
    const out = gen([
      { name: "orders-db", kind: "ContainerDb", technology: "PostgreSQL" },
    ]);
    const [sts] = docsOf(fileFor(out, "orders-db").content);
    expect(sts.kind).toBe("StatefulSet");
    expect(sts.spec.serviceName).toBe("orders-db-svc");
    expect(sts.spec.template.spec.containers[0].image).toBe("postgres:16");
    expect(sts.spec.template.spec.containers[0].ports[0].containerPort).toBe(
      5432,
    );
    expect(sts.metadata.annotations["aact.kind"]).toBe("ContainerDb");
  });

  it("uses the technology as the image when it looks like one", () => {
    const out = gen([
      { name: "api", kind: "Container", technology: "ghcr.io/shop/api:1.4" },
    ]);
    const [dep] = docsOf(fileFor(out, "api").content);
    expect(dep.spec.template.spec.containers[0].image).toBe(
      "ghcr.io/shop/api:1.4",
    );
  });

  it("turns a relation into a service-referencing env var", () => {
    const out = gen([
      { name: "api", kind: "Container", relations: [{ to: "orders-db" }] },
      { name: "orders-db", kind: "ContainerDb" },
    ]);
    const [dep] = docsOf(fileFor(out, "api").content);
    const env = dep.spec.template.spec.containers[0].env;
    expect(env).toContainEqual({
      name: "ORDERS_DB_URL",
      value: expect.stringContaining("@orders-db-svc:5432"),
    });
  });

  it("points an internal relation at the target's Service DNS", () => {
    const out = gen([
      { name: "api", kind: "Container", relations: [{ to: "billing" }] },
      { name: "billing", kind: "Container" },
    ]);
    const [dep] = docsOf(fileFor(out, "api").content);
    expect(dep.spec.template.spec.containers[0].env).toContainEqual({
      name: "BILLING_URL",
      value: "http://billing-svc:8080",
    });
  });

  it("emits Namespaces from boundaries and stamps metadata.namespace", () => {
    const out = generate(
      makeModel({
        elements: [{ name: "api", kind: "Container" }],
        boundaries: [{ name: "shop", elementNames: ["api"] }],
      }),
    );
    const ns = docsOf(
      out.files.find((f) => f.path === "namespaces.yaml")!.content,
    );
    expect(ns[0]).toMatchObject({
      kind: "Namespace",
      metadata: { name: "shop" },
    });
    const [dep] = docsOf(fileFor(out, "api").content);
    expect(dep.metadata.namespace).toBe("shop");
  });

  it("skips external systems and non-deployable kinds", () => {
    const out = gen([
      { name: "api", kind: "Container" },
      { name: "ext", kind: "System", external: true },
      { name: "user", kind: "Person" },
    ]);
    expect(out.files.map((f) => f.path)).toEqual(["api.yaml"]);
  });

  it("preserves an underscored Model name via aact.element", () => {
    const out = gen([{ name: "orders_api", kind: "Container" }]);
    const [dep] = docsOf(fileFor(out, "orders-api").content);
    expect(dep.metadata.annotations["aact.element"]).toBe("orders_api");
  });

  it("honours a custom defaultPort", () => {
    const out = generate(
      makeModel({ elements: [{ name: "api", kind: "Container" }] }),
      { defaultPort: 3000 },
    );
    const [dep] = docsOf(fileFor(out, "api").content);
    expect(dep.spec.template.spec.containers[0].ports[0].containerPort).toBe(
      3000,
    );
  });

  it("honours a custom dbConnectionTemplate", () => {
    const out = generate(
      makeModel({
        elements: [
          { name: "api", kind: "Container", relations: [{ to: "db" }] },
          { name: "db", kind: "ContainerDb" },
        ],
      }),
      { dbConnectionTemplate: "mysql://root@{service}:3306/{db}" },
    );
    const [dep] = docsOf(fileFor(out, "api").content);
    expect(dep.spec.template.spec.containers[0].env).toContainEqual({
      name: "DB_URL",
      value: "mysql://root@db-svc:3306/db",
    });
  });
});
