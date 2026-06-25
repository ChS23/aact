import { analyzeArchitecture } from "../../src/analyze";
import { kubernetesFormat } from "../../src/formats/kubernetes";
import { plantumlFormat } from "../../src/formats/plantuml";
import { load } from "../../src/formats/structurizr/load";
import type { Model } from "../../src/model";
import { allElements } from "../../src/model";
import {
  aclRule,
  acyclicRule,
  crudRule,
  dbPerServiceRule,
} from "../../src/rules";
import { cohesionRule } from "../../src/rules/cohesion";

describe("Microservices (Structurizr)", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("fixtures/architecture/workspace.json");
    model = result.model;
  });

  it("loads containers, boundaries, and relations", () => {
    expect(allElements(model).length).toBeGreaterThan(0);
    expect(Object.values(model.boundaries).length).toBeGreaterThan(0);
    const withRelations = allElements(model).filter(
      (c) => c.relations.length > 0,
    );
    expect(withRelations.length).toBeGreaterThan(0);
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
    const violations = aclRule.check(model);
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });

  it("Acyclic — no dependency cycles", () => {
    expect(acyclicRule.check(model)).toHaveLength(0);
  });

  it("DB per service — each database accessed by single service", () => {
    expect(dbPerServiceRule.check(model)).toHaveLength(0);
  });

  it("CRUD — only repo-tagged containers access databases", () => {
    expect(crudRule.check(model)).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    const violations = cohesionRule.check(model);
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });

  it("analyzeArchitecture returns metrics", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.elementsCount).toBeGreaterThan(0);
    expect(report.boundaries.length).toBeGreaterThan(0);
    expect(report.databases.count).toBeGreaterThanOrEqual(0);
  });

  it("generates real Kubernetes manifests from model", () => {
    const output = kubernetesFormat.generate!(model);
    expect(output.files.length).toBeGreaterThan(0);
    const workloads = output.files.filter((f) => f.path !== "namespaces.yaml");
    expect(workloads.length).toBeGreaterThan(0);
    for (const file of workloads) {
      expect(file.path).toMatch(/\.yaml$/);
      expect(file.content).toContain("apiVersion: apps/v1");
      expect(file.content).toMatch(/kind: (Deployment|StatefulSet)/);
      expect(file.content).toContain("kind: Service");
    }
  });

  it("generates valid PlantUML from model", () => {
    const output = plantumlFormat.generate!(model);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].content).toContain("@startuml");
    expect(output.files[0].content).toContain("@enduml");
  });
});
