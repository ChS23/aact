import { computeDiff } from "../../src/diff";
import { kubernetesFormat } from "../../src/formats/kubernetes";
import { load as loadStructurizr } from "../../src/formats/structurizr/load";
import type { Model } from "../../src/model";
import { crudRule } from "../../src/rules";

const ARCH = "examples/kubernetes-drift/architecture.dsl";
const K8S = "examples/kubernetes-drift/k8s";

describe("kubernetes-drift — architecture vs deployed cluster", () => {
  let arch: Model;
  let cluster: Model;

  beforeAll(async () => {
    arch = (await loadStructurizr(ARCH)).model;
    cluster = (await kubernetesFormat.load!(K8S)).model;
  });

  it("intended architecture is clean (no CRUD violation)", () => {
    expect(crudRule.check(arch)).toHaveLength(0);
  });

  it("deployed cluster violates CRUD — orders-api hits the DB directly", () => {
    const violations = crudRule.check(cluster);
    expect(violations.some((v) => v.target === "orders-api")).toBe(true);
  });

  it("the cluster resolves relations through differently-named Services", () => {
    // env `…@billing-repo-svc` / Service `billing-svc` → workload names.
    expect(cluster.elements["orders-api"]?.relations.map((r) => r.to)).toEqual(
      expect.arrayContaining(["orders-db", "billing-service"]),
    );
    expect(
      cluster.elements["billing-service"]?.relations.map((r) => r.to),
    ).toEqual(["billing-repo"]);
  });

  describe("diff surfaces exactly the intended drift", () => {
    let changes: ReturnType<typeof computeDiff>["changes"];

    beforeAll(() => {
      changes = computeDiff(
        arch,
        cluster,
        { source: ARCH, format: "structurizr" },
        { source: K8S, format: "kubernetes" },
      ).changes;
    });

    it("orders-repo is missing from the cluster", () => {
      expect(
        changes.some(
          (c) =>
            c.entity === "element" &&
            c.action === "removed" &&
            c.name === "orders-repo",
        ),
      ).toBe(true);
    });

    it("metrics-collector is deployed but not designed", () => {
      expect(
        changes.some(
          (c) =>
            c.entity === "element" &&
            c.action === "added" &&
            c.name === "metrics-collector",
        ),
      ).toBe(true);
    });

    it("orders-api → orders-db is a new direct edge", () => {
      expect(
        changes.some(
          (c) =>
            c.entity === "relation" &&
            c.action === "added" &&
            c.from === "orders-api" &&
            c.to === "orders-db",
        ),
      ).toBe(true);
    });

    it("billing-db drifted from PostgreSQL to MySQL", () => {
      const change = changes.find(
        (c) => c.entity === "element" && c.name === "billing-db",
      );
      const tech = change?.fields.find((f) => f.field === "technology");
      expect(tech?.before).toBe("PostgreSQL");
      expect(tech?.after).toBe("MySQL");
    });

    it("no implicit tag or styling noise leaks into the diff", () => {
      const tagChanges = changes.flatMap((c) =>
        "fields" in c ? c.fields.filter((f) => f.field === "tags") : [],
      );
      expect(tagChanges).toHaveLength(0);
    });
  });
});
